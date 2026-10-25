/**
 * Tests for "Save as Dossier" — createDossierFromProject service + API endpoint.
 *
 * Uses in-memory SQLite and temp directories for file operations.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from './helpers/test-db.js';
import type Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

let testDb: Database.Database;
let tempProjectRoot: string;

// Mock the db module to use our test database
vi.mock('../db/index.js', () => {
  return {
    prepare: (sql: string) => {
      return testDb.prepare(sql);
    },
    getDb: () => testDb,
  };
});

// Import after mocking
import {
  createDossierFromProject,
  getDossier,
  getDossierForProject,
} from '../services/dossier.js';
import { dossiersRouter } from '../routes/dossiers.js';

function setupTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      progress TEXT,
      error TEXT,
      started_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_project_phase ON tasks(project_id, phase);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      project_id TEXT,
      event_type TEXT NOT NULL,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type, timestamp);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dossiers (
      id TEXT PRIMARY KEY,
      competitor_name TEXT NOT NULL,
      industry TEXT,
      description TEXT,
      source_project_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_refreshed_at TEXT,
      confidence_rating TEXT,
      research_word_count INTEGER DEFAULT 0,
      artifact_count INTEGER DEFAULT 0,
      root_path TEXT NOT NULL,
      change_log TEXT DEFAULT '[]',
      FOREIGN KEY (source_project_id) REFERENCES projects(id)
    );
    CREATE INDEX IF NOT EXISTS idx_dossiers_competitor ON dossiers(competitor_name);
    CREATE INDEX IF NOT EXISTS idx_dossiers_status ON dossiers(status);
    CREATE INDEX IF NOT EXISTS idx_dossiers_source ON dossiers(source_project_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dossier_projects (
      dossier_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      relationship TEXT NOT NULL DEFAULT 'source',
      linked_at TEXT NOT NULL,
      PRIMARY KEY (dossier_id, project_id),
      FOREIGN KEY (dossier_id) REFERENCES dossiers(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
  `);

  try {
    db.exec('ALTER TABLE projects ADD COLUMN dossier_id TEXT');
  } catch { /* column may already exist */ }
}

// Use a proper v4 UUID that passes Zod's strict UUID validation
let PROJECT_ID: string;

function insertCompleteProject(db: Database.Database, rootPath: string) {
  db.prepare(`
    INSERT INTO projects (id, name, root_path, status, created_at, updated_at)
    VALUES (?, ?, ?, 'complete', datetime('now'), datetime('now'))
  `).run(PROJECT_ID, 'Test Project', rootPath);
}

function createProjectFiles(rootPath: string) {
  // Create project directories with files
  for (const dir of ['collaboration', 'research', 'verification', 'analysis', 'artifacts']) {
    const dirPath = join(rootPath, dir);
    mkdirSync(dirPath, { recursive: true });
    writeFileSync(join(dirPath, `${dir}-output.md`), `# ${dir} content\n\nSome words here for testing.`);
  }
  // Add an exports subdirectory with a file
  mkdirSync(join(rootPath, 'artifacts', 'exports'), { recursive: true });
  writeFileSync(join(rootPath, 'artifacts', 'exports', 'report.pptx'), 'fake pptx content');
}

describe('Save as Dossier — createDossierFromProject', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    testDb = createTestDb();
    setupTables(testDb);
    tempProjectRoot = mkdtempSync(join(tmpdir(), 'strategos-test-'));
    PROJECT_ID = randomUUID();

    app = express();
    app.use(express.json());
    app.use('/api/dossiers', dossiersRouter);
  });

  afterEach(() => {
    testDb.close();
    try { rmSync(tempProjectRoot, { recursive: true, force: true }); } catch {}
  });

  // =========================================================================
  // SERVICE FUNCTION TESTS
  // =========================================================================

  it('creates dossier with all files copied', () => {
    createProjectFiles(tempProjectRoot);
    insertCompleteProject(testDb, tempProjectRoot);

    const result = createDossierFromProject(PROJECT_ID, {
      competitorName: 'Acme Corp',
      industry: 'SaaS',
    });

    expect(result.dossier).toBeDefined();
    expect(result.dossier.competitorName).toBe('Acme Corp');
    expect(result.dossier.industry).toBe('SaaS');
    expect(result.dossier.sourceProjectId).toBe(PROJECT_ID);
    // Should have copied files from all 4 directories + exports subdir
    expect(result.filesCopied.length).toBeGreaterThanOrEqual(4);
    expect(result.filesCopied).toContain('research-output.md');
    expect(result.filesCopied).toContain('analysis-output.md');
    expect(result.filesCopied).toContain('report.pptx');
    expect(result.warnings).toHaveLength(0);
  });

  it('returns warnings for missing directories', () => {
    // Create project root with only research dir
    mkdirSync(join(tempProjectRoot, 'research'), { recursive: true });
    writeFileSync(join(tempProjectRoot, 'research', 'data.md'), 'content');
    insertCompleteProject(testDb, tempProjectRoot);

    const result = createDossierFromProject(PROJECT_ID, {
      competitorName: 'Beta Inc',
    });

    expect(result.dossier).toBeDefined();
    expect(result.filesCopied).toContain('data.md');
    // Should have warnings for missing collaboration, verification, analysis, artifacts
    expect(result.warnings.length).toBeGreaterThanOrEqual(4);
    expect(result.warnings.some(w => w.includes('collaboration'))).toBe(true);
    expect(result.warnings.some(w => w.includes('verification'))).toBe(true);
    expect(result.warnings.some(w => w.includes('analysis'))).toBe(true);
    expect(result.warnings.some(w => w.includes('artifacts'))).toBe(true);
  });

  it('sets cached metrics correctly', () => {
    createProjectFiles(tempProjectRoot);
    insertCompleteProject(testDb, tempProjectRoot);

    const result = createDossierFromProject(PROJECT_ID, {
      competitorName: 'Gamma Corp',
    });

    // Research file has content -> word count should be > 0
    expect(result.dossier.researchWordCount).toBeGreaterThan(0);
    // Artifacts dir has at least one file
    expect(result.dossier.artifactCount).toBeGreaterThan(0);
  });

  it('creates junction table entry', () => {
    createProjectFiles(tempProjectRoot);
    insertCompleteProject(testDb, tempProjectRoot);

    const result = createDossierFromProject(PROJECT_ID, {
      competitorName: 'Delta LLC',
    });

    const row = testDb.prepare(
      'SELECT * FROM dossier_projects WHERE dossier_id = ? AND project_id = ?'
    ).get(result.dossier.id, PROJECT_ID) as any;

    expect(row).toBeDefined();
    expect(row.relationship).toBe('source');
  });

  it('sets last_refreshed_at', () => {
    createProjectFiles(tempProjectRoot);
    insertCompleteProject(testDb, tempProjectRoot);

    const result = createDossierFromProject(PROJECT_ID, {
      competitorName: 'Epsilon Inc',
    });

    expect(result.dossier.lastRefreshedAt).not.toBeNull();
  });

  it('appends creation event to change log', () => {
    createProjectFiles(tempProjectRoot);
    insertCompleteProject(testDb, tempProjectRoot);

    const result = createDossierFromProject(PROJECT_ID, {
      competitorName: 'Zeta Corp',
    });

    expect(result.dossier.changeLog).toHaveLength(1);
    expect(result.dossier.changeLog[0].type).toBe('created');
    expect(result.dossier.changeLog[0].sourceProjectId).toBe(PROJECT_ID);
  });

  // =========================================================================
  // API ENDPOINT TESTS
  // =========================================================================

  it('returns 409 for duplicate save', async () => {
    createProjectFiles(tempProjectRoot);
    insertCompleteProject(testDb, tempProjectRoot);

    // First save — should succeed
    const first = await request(app)
      .post(`/api/dossiers/from-project/${PROJECT_ID}`)
      .send({ competitorName: 'Eta Corp' });
    expect(first.status).toBe(201);

    // Second save — should conflict
    const second = await request(app)
      .post(`/api/dossiers/from-project/${PROJECT_ID}`)
      .send({ competitorName: 'Eta Corp' });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already exists/);
    expect(second.body.dossierId).toBeDefined();
  });

  it('returns 404 for nonexistent project', async () => {
    const fakeId = randomUUID();
    const res = await request(app)
      .post(`/api/dossiers/from-project/${fakeId}`)
      .send({ competitorName: 'Theta Inc' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 400 for non-complete project', async () => {
    // Insert project with 'researching' status
    testDb.prepare(`
      INSERT INTO projects (id, name, root_path, status, created_at, updated_at)
      VALUES (?, ?, ?, 'researching', datetime('now'), datetime('now'))
    `).run(PROJECT_ID, 'Incomplete Project', tempProjectRoot);

    const res = await request(app)
      .post(`/api/dossiers/from-project/${PROJECT_ID}`)
      .send({ competitorName: 'Iota Labs' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not complete/i);
  });

  it('returns 400 for empty competitorName', async () => {
    createProjectFiles(tempProjectRoot);
    insertCompleteProject(testDb, tempProjectRoot);

    const res = await request(app)
      .post(`/api/dossiers/from-project/${PROJECT_ID}`)
      .send({ competitorName: '' });

    expect(res.status).toBe(400);
  });
});
