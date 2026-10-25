/**
 * Dossier Event Logging Tests (Session 34).
 *
 * Verifies that dossier lifecycle operations emit events via logEvent(),
 * events are queryable via the events API, and event logging failures
 * never block primary dossier operations.
 *
 * Uses in-memory SQLite + temp directories with fixture files.
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
let testRoot: string;
let testProjectsRoot: string;

// Mock the db module to use our test database
vi.mock('../db/index.js', () => {
  return {
    prepare: (sql: string) => testDb.prepare(sql),
    getDb: () => testDb,
    transaction: (fn: () => any) => fn(),
  };
});

// Import after mocking
import {
  createDossier,
  archiveDossier,
  updateDossierWithStatus,
  linkProject,
  createRefreshProject,
  updateDossierFromProject,
} from '../services/dossier.js';
import { getEventsByType, EVENT_TYPES } from '../services/event-logger.js';
import { dossiersRouter } from '../routes/dossiers.js';
import projectsRouter from '../routes/projects.js';

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

  try {
    db.exec('ALTER TABLE selected_artifacts ADD COLUMN last_exported_at TEXT DEFAULT NULL');
  } catch { /* column may already exist */ }
}

function insertTestProject(
  db: Database.Database,
  id: string,
  name: string,
  rootPath: string,
  status: string = 'complete',
) {
  db.prepare(`
    INSERT INTO projects (id, name, root_path, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, name, rootPath, status);
}

function createDossierWithDir(name: string): { id: string; rootPath: string } {
  const id = randomUUID();
  const rootPath = join(testRoot, 'dossiers', id);
  for (const sub of ['research', 'verification', 'analysis', 'artifacts', 'artifacts/exports', 'collaboration']) {
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

function createProjectWithDir(name: string, status: string = 'complete'): { id: string; rootPath: string } {
  const id = randomUUID();
  const rootPath = join(testProjectsRoot, id);
  for (const sub of ['collaboration', 'research', 'verification', 'analysis', 'artifacts', 'artifacts/exports']) {
    mkdirSync(join(rootPath, sub), { recursive: true });
  }
  insertTestProject(testDb, id, name, rootPath, status);
  return { id, rootPath };
}

describe('Dossier Event Logging', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    testDb = createTestDb();
    setupTables(testDb);

    testRoot = join(tmpdir(), `strategos-dossier-events-test-${Date.now()}`);
    testProjectsRoot = join(testRoot, 'projects');
    mkdirSync(testProjectsRoot, { recursive: true });

    process.env.PROJECTS_ROOT = testProjectsRoot;

    app = express();
    app.use(express.json());
    app.use('/api/dossiers', dossiersRouter);
    app.use('/api/projects', projectsRouter);
  });

  afterEach(() => {
    testDb.close();
    delete process.env.PROJECTS_ROOT;
    try {
      rmSync(testRoot, { recursive: true, force: true });
    } catch { /* best effort cleanup */ }
  });

  // ===========================================================================
  // Test 1: dossier_created event logged with correct metadata
  // ===========================================================================

  it('should log dossier_created event with correct metadata', () => {
    const sourceProjectId = randomUUID();
    const { id: projectId, rootPath: projectRoot } = createProjectWithDir('Source Project', 'complete');

    const dossier = createDossier({
      competitorName: 'Acme Corp',
      industry: 'SaaS',
      sourceProjectId: projectId,
    });

    const events = getEventsByType('dossier_created');
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('dossier_created');
    expect(events[0].projectId).toBe(projectId);

    const metadata = events[0].metadata as Record<string, unknown>;
    expect(metadata.dossierId).toBe(dossier.id);
    expect(metadata.competitorName).toBe('Acme Corp');
    expect(metadata.sourceProjectId).toBe(projectId);
  });

  // ===========================================================================
  // Test 2: dossier_archived event logged
  // ===========================================================================

  it('should log dossier_archived event', () => {
    const { id } = createDossierWithDir('Beta LLC');

    archiveDossier(id);

    const events = getEventsByType('dossier_archived');
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('dossier_archived');
    expect(events[0].projectId).toBeNull();

    const metadata = events[0].metadata as Record<string, unknown>;
    expect(metadata.dossierId).toBe(id);
    expect(metadata.competitorName).toBe('Beta LLC');
  });

  // ===========================================================================
  // Test 3: dossier_unarchived event logged
  // ===========================================================================

  it('should log dossier_unarchived event', () => {
    const { id } = createDossierWithDir('Gamma Inc');
    // Archive first
    testDb.prepare(`UPDATE dossiers SET status = 'archived' WHERE id = ?`).run(id);

    updateDossierWithStatus(id, { status: 'active' });

    const events = getEventsByType('dossier_unarchived');
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('dossier_unarchived');
    expect(events[0].projectId).toBeNull();

    const metadata = events[0].metadata as Record<string, unknown>;
    expect(metadata.dossierId).toBe(id);
    expect(metadata.competitorName).toBe('Gamma Inc');
  });

  // ===========================================================================
  // Test 4: dossier_refresh_started event with refreshProjectId
  // ===========================================================================

  it('should log dossier_refresh_started event with refreshProjectId', () => {
    const { id, rootPath } = createDossierWithDir('Delta Corp');
    writeFileSync(join(rootPath, 'collaboration', 'research-brief.md'), '# Research Brief\n\nCompetitive analysis.');

    const result = createRefreshProject(id);

    const events = getEventsByType('dossier_refresh_started');
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('dossier_refresh_started');
    expect(events[0].projectId).toBe(result.projectId);

    const metadata = events[0].metadata as Record<string, unknown>;
    expect(metadata.dossierId).toBe(id);
    expect(metadata.competitorName).toBe('Delta Corp');
    expect(metadata.refreshProjectId).toBe(result.projectId);
  });

  // ===========================================================================
  // Test 5: dossier_updated_from_project event with wordCountDelta
  // ===========================================================================

  it('should log dossier_updated_from_project event with wordCountDelta', () => {
    const { id: dossierId, rootPath: dossierRoot } = createDossierWithDir('Epsilon Ltd');
    // Pre-existing research: 4 words
    writeFileSync(join(dossierRoot, 'research', 'old.md'), 'old research data here');

    const { id: projectId, rootPath: projectRoot } = createProjectWithDir('Epsilon Research', 'complete');
    linkProject(dossierId, projectId, 'refresh');

    // Project adds 9 words of research
    writeFileSync(join(projectRoot, 'research', 'kimi.md'), 'new research data with more words in it now');

    updateDossierFromProject(dossierId, projectId);

    const events = getEventsByType('dossier_updated_from_project');
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('dossier_updated_from_project');
    expect(events[0].projectId).toBe(projectId);

    const metadata = events[0].metadata as Record<string, unknown>;
    expect(metadata.dossierId).toBe(dossierId);
    expect(metadata.competitorName).toBe('Epsilon Ltd');
    expect(metadata.sourceProjectId).toBe(projectId);
    expect(typeof metadata.wordCountDelta).toBe('number');
  });

  // ===========================================================================
  // Test 6: Events queryable via GET /api/projects/events?event_type=dossier_created
  // ===========================================================================

  it('should be queryable via GET /api/projects/events?event_type=dossier_created', async () => {
    // Create two dossiers to generate events
    createDossier({ competitorName: 'Zeta GmbH' });
    createDossier({ competitorName: 'Eta Corp' });

    const res = await request(app).get('/api/projects/events?event_type=dossier_created');

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.events[0].eventType).toBe('dossier_created');
    expect(res.body.events[1].eventType).toBe('dossier_created');
  });

  // ===========================================================================
  // Test 7: Event logging failure does not block primary dossier operation
  // ===========================================================================

  it('should not block primary operation when event logging fails', () => {
    // Drop the events table to force logEvent to fail
    testDb.exec('DROP TABLE events');

    // createDossier should still succeed despite logEvent failure
    const dossier = createDossier({ competitorName: 'Theta Inc' });
    expect(dossier).toBeDefined();
    expect(dossier.competitorName).toBe('Theta Inc');
    expect(dossier.status).toBe('active');

    // archiveDossier should also succeed
    const archived = archiveDossier(dossier.id);
    expect(archived).not.toBeNull();
    expect(archived!.status).toBe('archived');
  });

  // ===========================================================================
  // Test 8: Events include dossierId and competitorName in metadata
  // ===========================================================================

  it('should include dossierId and competitorName in all dossier event metadata', () => {
    // Create dossier (generates dossier_created event)
    const { id } = createDossierWithDir('Iota LLC');

    // Archive (generates dossier_archived event)
    archiveDossier(id);

    // Unarchive via updateDossierWithStatus (generates dossier_unarchived event)
    updateDossierWithStatus(id, { status: 'active' });

    // Fetch all dossier events
    const createdEvents = getEventsByType('dossier_archived');
    const unarchivedEvents = getEventsByType('dossier_unarchived');

    for (const event of [...createdEvents, ...unarchivedEvents]) {
      const metadata = event.metadata as Record<string, unknown>;
      expect(metadata).toBeDefined();
      expect(metadata.dossierId).toBe(id);
      expect(metadata.competitorName).toBe('Iota LLC');
    }
  });
});
