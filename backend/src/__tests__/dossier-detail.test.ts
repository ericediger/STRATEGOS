/**
 * Dossier Detail, File Manifest & Content Tests (Session 32).
 *
 * Tests cover: enriched detail with linked projects, file manifest,
 * file content retrieval, path traversal prevention, and status change logs.
 *
 * Uses in-memory SQLite + temp directories with real filesystem operations.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from './helpers/test-db.js';
import type Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

let testDb: Database.Database;
let testDossiersRoot: string;

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
  createDossier,
  getDossier,
  linkProject,
  updateDossierWithStatus,
  getDossierWithLinkedProjects,
  getDossierFileManifest,
  getDossierFileContent,
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

function insertTestProject(db: Database.Database, id: string, name: string) {
  db.prepare(`
    INSERT INTO projects (id, name, root_path, status, created_at, updated_at)
    VALUES (?, ?, '/tmp/test', 'complete', datetime('now'), datetime('now'))
  `).run(id, name);
}

/**
 * Create a dossier with a real temp directory (for file tests).
 * Inserts directly into DB to point root_path at temp dir.
 */
function createDossierWithDir(name: string): { id: string; rootPath: string } {
  const id = randomUUID();
  const rootPath = join(testDossiersRoot, id);
  for (const sub of ['research', 'verification', 'analysis', 'artifacts', 'artifacts/exports']) {
    mkdirSync(join(rootPath, sub), { recursive: true });
  }
  const now = new Date().toISOString();
  const changeLog = JSON.stringify([{ date: now, type: 'created', summary: `Dossier created for ${name}` }]);
  testDb.prepare(`
    INSERT INTO dossiers (id, competitor_name, industry, description, source_project_id, status, created_at, updated_at, root_path, change_log)
    VALUES (?, ?, NULL, NULL, NULL, 'active', ?, ?, ?, ?)
  `).run(id, name, now, now, rootPath, changeLog);
  return { id, rootPath };
}

describe('Dossier Detail & File Endpoints', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    testDb = createTestDb();
    setupTables(testDb);

    testDossiersRoot = join(tmpdir(), `strategos-dossier-test-${Date.now()}`);
    mkdirSync(testDossiersRoot, { recursive: true });

    app = express();
    app.use(express.json());
    app.use('/api/dossiers', dossiersRouter);
  });

  afterEach(() => {
    testDb.close();
    try {
      rmSync(testDossiersRoot, { recursive: true, force: true });
    } catch { /* best effort cleanup */ }
  });

  // ===========================================================================
  // ENRICHED DETAIL
  // ===========================================================================

  describe('GET /:id — Enriched Detail', () => {
    it('should return enriched response with linked projects', async () => {
      const { id } = createDossierWithDir('Acme Corp');
      const projectId = randomUUID();
      insertTestProject(testDb, projectId, 'Project Alpha');
      linkProject(id, projectId, 'source');

      const res = await request(app).get(`/api/dossiers/${id}`);

      expect(res.status).toBe(200);
      expect(res.body.dossier.competitorName).toBe('Acme Corp');
      expect(res.body.linkedProjects).toHaveLength(1);
      expect(res.body.linkedProjects[0].projectId).toBe(projectId);
      expect(res.body.linkedProjects[0].projectName).toBe('Project Alpha');
      expect(res.body.staleness).toBeDefined();
    });

    it('should return parsed change log array', async () => {
      const { id } = createDossierWithDir('Beta LLC');

      const res = await request(app).get(`/api/dossiers/${id}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.dossier.changeLog)).toBe(true);
      expect(res.body.dossier.changeLog).toHaveLength(1);
      expect(res.body.dossier.changeLog[0].type).toBe('created');
    });

    it('should return 404 for nonexistent dossier', async () => {
      const fakeId = randomUUID();
      const res = await request(app).get(`/api/dossiers/${fakeId}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Dossier not found');
    });
  });

  // ===========================================================================
  // FILE MANIFEST
  // ===========================================================================

  describe('GET /:id/files — File Manifest', () => {
    it('should return section-organized manifest', async () => {
      const { id, rootPath } = createDossierWithDir('Gamma Inc');
      writeFileSync(join(rootPath, 'research', 'kimi.md'), '# Kimi Research\n\nSome findings here.');
      writeFileSync(join(rootPath, 'analysis', 'assessment.md'), '# Strategic Assessment\n\nDeep analysis.');

      const res = await request(app).get(`/api/dossiers/${id}/files`);

      expect(res.status).toBe(200);
      expect(res.body.sections).toHaveLength(4);

      const labels = res.body.sections.map((s: any) => s.label);
      expect(labels).toEqual(['Research Reports', 'Source Verification', 'Strategic Assessment', 'Deliverables']);

      const researchSection = res.body.sections.find((s: any) => s.label === 'Research Reports');
      expect(researchSection.files).toHaveLength(1);
      expect(researchSection.files[0].name).toBe('kimi.md');
    });

    it('should return empty sections for dossier with no files', async () => {
      const { id } = createDossierWithDir('Delta Corp');

      const res = await request(app).get(`/api/dossiers/${id}/files`);

      expect(res.status).toBe(200);
      expect(res.body.sections).toHaveLength(4);
      for (const section of res.body.sections) {
        expect(section.files).toHaveLength(0);
      }
    });

    it('should compute word counts for markdown files', async () => {
      const { id, rootPath } = createDossierWithDir('Epsilon Ltd');
      writeFileSync(join(rootPath, 'research', 'report.md'), 'one two three four five');

      const res = await request(app).get(`/api/dossiers/${id}/files`);

      const researchSection = res.body.sections.find((s: any) => s.label === 'Research Reports');
      expect(researchSection.files[0].wordCount).toBe(5);
      expect(researchSection.files[0].isMarkdown).toBe(true);
    });

    it('should distinguish markdown from binary files', async () => {
      const { id, rootPath } = createDossierWithDir('Zeta GmbH');
      writeFileSync(join(rootPath, 'artifacts', 'exports', 'battle-card.pptx'), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      writeFileSync(join(rootPath, 'artifacts', 'summary.md'), '# Executive Summary');

      const res = await request(app).get(`/api/dossiers/${id}/files`);

      const deliverables = res.body.sections.find((s: any) => s.label === 'Deliverables');
      const pptx = deliverables.files.find((f: any) => f.name === 'battle-card.pptx');
      const md = deliverables.files.find((f: any) => f.name === 'summary.md');

      expect(pptx.isMarkdown).toBe(false);
      expect(pptx.wordCount).toBe(0);
      expect(md.isMarkdown).toBe(true);
      expect(md.wordCount).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // FILE CONTENT
  // ===========================================================================

  describe('GET /:id/files/* — File Content', () => {
    it('should return markdown content', async () => {
      const { id, rootPath } = createDossierWithDir('Eta Corp');
      writeFileSync(join(rootPath, 'research', 'kimi.md'), '# Kimi Research\n\nDetailed findings.');

      const res = await request(app).get(`/api/dossiers/${id}/files/research/kimi.md`);

      expect(res.status).toBe(200);
      expect(res.body.content).toBe('# Kimi Research\n\nDetailed findings.');
      expect(res.body.name).toBe('kimi.md');
      expect(res.body.path).toBe('research/kimi.md');
    });

    it('should return 404 for nonexistent file', async () => {
      const { id } = createDossierWithDir('Theta Inc');

      const res = await request(app).get(`/api/dossiers/${id}/files/research/nonexistent.md`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('File not found');
    });

    it('should return 403 for path traversal (..)', () => {
      // Test service function directly since Express normalizes .. in URL paths
      const { id } = createDossierWithDir('Iota LLC');

      const result = getDossierFileContent(id, '../../etc/passwd');

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.status).toBe(403);
        expect(result.message).toBe('Path traversal denied');
      }
    });

    it('should return 403 for null byte injection', () => {
      // Test service function directly since Express URL-decodes before routing
      const { id } = createDossierWithDir('Kappa Ltd');

      const result = getDossierFileContent(id, 'research/file\0.md');

      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.status).toBe(403);
        expect(result.message).toBe('Path traversal denied');
      }
    });
  });

  // ===========================================================================
  // STATUS CHANGE LOG
  // ===========================================================================

  describe('PUT /:id — Status Change Log', () => {
    it('should append archive change log entry on status change to archived', async () => {
      const { id } = createDossierWithDir('Lambda Corp');

      const res = await request(app)
        .put(`/api/dossiers/${id}`)
        .send({ status: 'archived' });

      expect(res.status).toBe(200);
      expect(res.body.dossier.status).toBe('archived');
      const archiveEntry = res.body.dossier.changeLog.find((e: any) => e.type === 'archived');
      expect(archiveEntry).toBeDefined();
      expect(archiveEntry.summary).toContain('Lambda Corp');
    });

    it('should append unarchive change log entry on status change to active', async () => {
      const { id } = createDossierWithDir('Mu Inc');
      // First archive it
      testDb.prepare(`UPDATE dossiers SET status = 'archived' WHERE id = ?`).run(id);

      const res = await request(app)
        .put(`/api/dossiers/${id}`)
        .send({ status: 'active' });

      expect(res.status).toBe(200);
      expect(res.body.dossier.status).toBe('active');
      const unarchiveEntry = res.body.dossier.changeLog.find((e: any) => e.type === 'unarchived');
      expect(unarchiveEntry).toBeDefined();
      expect(unarchiveEntry.summary).toContain('Mu Inc');
    });
  });
});
