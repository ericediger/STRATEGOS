/**
 * Unit tests for Competitor Dossier Library (Session 30).
 *
 * Tests cover: schema, CRUD via API, relationships, validation, staleness.
 * Uses in-memory SQLite via test-db helper.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from './helpers/test-db.js';
import type Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';

let testDb: Database.Database;

// Mock the db module to use our test database
vi.mock('../db/index.js', () => {
  return {
    prepare: (sql: string) => {
      return testDb.prepare(sql);
    },
    getDb: () => testDb,
  };
});

// Mock fs for directory creation in dossier service (avoid filesystem side-effects in tests)
vi.mock('fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('fs')>();
  return {
    ...original,
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    readdirSync: vi.fn().mockReturnValue([]),
    readFileSync: original.readFileSync,
    statSync: original.statSync,
  };
});

// Import after mocking
import {
  createDossier,
  getDossier,
  listDossiers,
  updateDossier,
  archiveDossier,
  linkProject,
  getLinkedProjects,
  getDossierForProject,
  computeStaleness,
} from '../services/dossier.js';
import { dossiersRouter } from '../routes/dossiers.js';

function setupTables(db: Database.Database) {
  // Tasks table (not in schema.sql)
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

  // Events table (not in schema.sql)
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

  // Dossiers table
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

  // Dossier_projects junction table
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

  // Add dossier_id to projects
  try {
    db.exec('ALTER TABLE projects ADD COLUMN dossier_id TEXT');
  } catch { /* column may already exist */ }
}

// Create a test project for linking
function insertTestProject(db: Database.Database, id: string, name: string) {
  db.prepare(`
    INSERT INTO projects (id, name, root_path, status, created_at, updated_at)
    VALUES (?, ?, '/tmp/test', 'not_started', datetime('now'), datetime('now'))
  `).run(id, name);
}

describe('Competitor Dossier Library', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    testDb = createTestDb();
    setupTables(testDb);

    app = express();
    app.use(express.json());
    app.use('/api/dossiers', dossiersRouter);
  });

  afterEach(() => {
    testDb.close();
  });

  // ===========================================================================
  // SCHEMA TESTS
  // ===========================================================================

  describe('Schema', () => {
    it('should have dossiers table with expected columns', () => {
      const columns = testDb.prepare("PRAGMA table_info('dossiers')").all() as any[];
      const names = columns.map(c => c.name);
      expect(names).toContain('id');
      expect(names).toContain('competitor_name');
      expect(names).toContain('industry');
      expect(names).toContain('description');
      expect(names).toContain('source_project_id');
      expect(names).toContain('status');
      expect(names).toContain('created_at');
      expect(names).toContain('updated_at');
      expect(names).toContain('last_refreshed_at');
      expect(names).toContain('confidence_rating');
      expect(names).toContain('research_word_count');
      expect(names).toContain('artifact_count');
      expect(names).toContain('root_path');
      expect(names).toContain('change_log');
    });

    it('should have dossier_projects junction table', () => {
      const columns = testDb.prepare("PRAGMA table_info('dossier_projects')").all() as any[];
      const names = columns.map(c => c.name);
      expect(names).toContain('dossier_id');
      expect(names).toContain('project_id');
      expect(names).toContain('relationship');
      expect(names).toContain('linked_at');
    });

    it('should have dossier_id column on projects table', () => {
      const columns = testDb.prepare("PRAGMA table_info('projects')").all() as any[];
      const names = columns.map(c => c.name);
      expect(names).toContain('dossier_id');
    });
  });

  // ===========================================================================
  // CRUD VIA API
  // ===========================================================================

  describe('CRUD via API', () => {
    it('POST /api/dossiers should create a dossier and return 201', async () => {
      const res = await request(app)
        .post('/api/dossiers')
        .send({ competitorName: 'Acme Corp', industry: 'SaaS' });

      expect(res.status).toBe(201);
      expect(res.body.dossier).toBeDefined();
      expect(res.body.dossier.competitorName).toBe('Acme Corp');
      expect(res.body.dossier.industry).toBe('SaaS');
      expect(res.body.dossier.status).toBe('active');
      expect(res.body.dossier.changeLog).toHaveLength(1);
      expect(res.body.dossier.changeLog[0].type).toBe('created');
    });

    it('GET /api/dossiers should return list', async () => {
      createDossier({ competitorName: 'Alpha Inc' });
      createDossier({ competitorName: 'Beta LLC' });

      const res = await request(app).get('/api/dossiers');

      expect(res.status).toBe(200);
      expect(res.body.dossiers).toHaveLength(2);
    });

    it('GET /api/dossiers/:id should return dossier with linked projects', async () => {
      const dossier = createDossier({ competitorName: 'Gamma Co' });

      const res = await request(app).get(`/api/dossiers/${dossier.id}`);

      expect(res.status).toBe(200);
      expect(res.body.dossier.competitorName).toBe('Gamma Co');
      expect(res.body.linkedProjects).toBeDefined();
      expect(Array.isArray(res.body.linkedProjects)).toBe(true);
    });

    it('PUT /api/dossiers/:id should update metadata', async () => {
      const dossier = createDossier({ competitorName: 'Delta Ltd' });

      const res = await request(app)
        .put(`/api/dossiers/${dossier.id}`)
        .send({ competitorName: 'Delta Holdings', industry: 'Finance' });

      expect(res.status).toBe(200);
      expect(res.body.dossier.competitorName).toBe('Delta Holdings');
      expect(res.body.dossier.industry).toBe('Finance');
      // Should have 2 changelog entries: created + metadata_updated
      expect(res.body.dossier.changeLog).toHaveLength(2);
      expect(res.body.dossier.changeLog[1].type).toBe('metadata_updated');
    });

    it('POST /api/dossiers/:id/archive should set status to archived', async () => {
      const dossier = createDossier({ competitorName: 'Epsilon GmbH' });

      const res = await request(app).post(`/api/dossiers/${dossier.id}/archive`);

      expect(res.status).toBe(200);
      expect(res.body.dossier.status).toBe('archived');
    });

    it('GET /api/dossiers/:id with nonexistent UUID should return 404', async () => {
      const res = await request(app).get('/api/dossiers/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Dossier not found');
    });
  });

  // ===========================================================================
  // RELATIONSHIPS
  // ===========================================================================

  describe('Relationships', () => {
    it('linkProject should create junction record', () => {
      const dossier = createDossier({ competitorName: 'Zeta Inc' });
      const projectId = '11111111-1111-1111-1111-111111111111';
      insertTestProject(testDb, projectId, 'Test Project');

      linkProject(dossier.id, projectId, 'source');

      const row = testDb.prepare('SELECT * FROM dossier_projects WHERE dossier_id = ?').get(dossier.id) as any;
      expect(row).toBeDefined();
      expect(row.project_id).toBe(projectId);
      expect(row.relationship).toBe('source');
    });

    it('getLinkedProjects should return correct relationships', () => {
      const dossier = createDossier({ competitorName: 'Eta Corp' });
      const projectId = '22222222-2222-2222-2222-222222222222';
      insertTestProject(testDb, projectId, 'Linked Project');

      linkProject(dossier.id, projectId, 'source');

      const linked = getLinkedProjects(dossier.id);
      expect(linked).toHaveLength(1);
      expect(linked[0].projectId).toBe(projectId);
      expect(linked[0].projectName).toBe('Linked Project');
      expect(linked[0].relationship).toBe('source');
    });

    it('getDossierForProject should return correct dossier', () => {
      const dossier = createDossier({ competitorName: 'Theta LLC' });
      const projectId = '33333333-3333-3333-3333-333333333333';
      insertTestProject(testDb, projectId, 'Source Project');

      linkProject(dossier.id, projectId, 'source');

      const found = getDossierForProject(projectId);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(dossier.id);
      expect(found!.competitorName).toBe('Theta LLC');
    });
  });

  // ===========================================================================
  // VALIDATION
  // ===========================================================================

  describe('Validation', () => {
    it('POST without competitorName should return 400', async () => {
      const res = await request(app)
        .post('/api/dossiers')
        .send({ industry: 'Tech' });

      expect(res.status).toBe(400);
    });

    it('POST with oversized competitorName (>200 chars) should return 400', async () => {
      const res = await request(app)
        .post('/api/dossiers')
        .send({ competitorName: 'A'.repeat(201) });

      expect(res.status).toBe(400);
    });

    it('GET with invalid UUID should return 400', async () => {
      const res = await request(app).get('/api/dossiers/not-a-uuid');

      expect(res.status).toBe(400);
    });

    it('GET with invalid status filter should return 400', async () => {
      const res = await request(app).get('/api/dossiers?status=invalid');

      expect(res.status).toBe(400);
    });
  });

  // ===========================================================================
  // STALENESS
  // ===========================================================================

  describe('Staleness', () => {
    const referenceDate = new Date('2026-03-01T00:00:00.000Z');

    it('should return fresh for < 30 days', () => {
      const result = computeStaleness(
        { lastRefreshedAt: '2026-02-15T00:00:00.000Z' },
        referenceDate,
      );
      expect(result).toBe('fresh');
    });

    it('should return aging for 31-90 days', () => {
      const result = computeStaleness(
        { lastRefreshedAt: '2025-12-15T00:00:00.000Z' },
        referenceDate,
      );
      expect(result).toBe('aging');
    });

    it('should return stale for > 90 days', () => {
      const result = computeStaleness(
        { lastRefreshedAt: '2025-06-01T00:00:00.000Z' },
        referenceDate,
      );
      expect(result).toBe('stale');
    });

    it('should return never_refreshed for null lastRefreshedAt', () => {
      const result = computeStaleness(
        { lastRefreshedAt: null },
        referenceDate,
      );
      expect(result).toBe('never_refreshed');
    });
  });
});
