/**
 * Dossier Refresh Tests (Session 33 EP-06 + Session 35 EP-07).
 *
 * Tests cover:
 * - POST /:dossierId/refresh returns 202/404/409/423 (EP-07 endpoint)
 * - In-progress lock prevents concurrent refreshes
 * - Lock releases after pipeline failure (finally block)
 * - Ephemeral project creation
 * - Event logging (dossier_refresh_started)
 * - POST /:dossierId/update-from-project (EP-06 copy-back)
 * - Dashboard linkedDossier enrichment
 *
 * Uses in-memory SQLite + temp directories with fixture files.
 * Research/verification/analysis services are mocked to prevent
 * live API calls — only synchronous setup and lock mechanics are tested.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from './helpers/test-db.js';
import type Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
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

// Mock research service — prevent live research engine calls
vi.mock('../services/research.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    createResearchProject: vi.fn().mockResolvedValue(1),
    startResearchQueue: vi.fn().mockResolvedValue(undefined),
    getResearchStatus: vi.fn().mockRejectedValue(new Error('mocked: no research engine')),
    checkAndAdvanceStatus: vi.fn(),
  };
});

// Mock verification service
vi.mock('../services/verification.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    startVerification: vi.fn().mockResolvedValue('mock-task-id'),
    getVerificationStatus: vi.fn().mockRejectedValue(new Error('mocked: no verifier')),
    mapVerificationStatus: vi.fn().mockReturnValue({ completed: false, status: 'pending', reportPath: null }),
    saveVerificationReport: vi.fn().mockResolvedValue(undefined),
  };
});

// Mock analysis service
vi.mock('../services/analysis.js', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    startAnalysis: vi.fn(),
    selectAndGenerateArtifacts: vi.fn().mockResolvedValue(undefined),
  };
});

// Import after mocking
import {
  getDossier,
  linkProject,
  updateDossierFromProject,
} from '../services/dossier.js';
import { refreshDossier, isRefreshInProgress } from '../services/dossier-refresh.js';
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

function createDossierWithDir(name: string, status: string = 'active'): { id: string; rootPath: string } {
  const id = randomUUID();
  const rootPath = join(testRoot, 'dossiers', id);
  for (const sub of ['research', 'verification', 'analysis', 'artifacts', 'artifacts/exports', 'collaboration']) {
    mkdirSync(join(rootPath, sub), { recursive: true });
  }
  const now = new Date().toISOString();
  const changeLog = JSON.stringify([{ date: now, type: 'created', summary: `Dossier created for ${name}` }]);
  testDb.prepare(`
    INSERT INTO dossiers (id, competitor_name, industry, description, source_project_id, status, created_at, updated_at, root_path, change_log)
    VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)
  `).run(id, name, status, now, now, rootPath, changeLog);
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

describe('Dossier Refresh Flow', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    testDb = createTestDb();
    setupTables(testDb);

    testRoot = join(tmpdir(), `strategos-refresh-test-${Date.now()}`);
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
  // EP-07: POST /:dossierId/refresh — Automated Delta Refresh
  // ===========================================================================

  describe('POST /:dossierId/refresh (EP-07)', () => {

    it('should return 202 for active dossier with research brief', async () => {
      const { id, rootPath } = createDossierWithDir('Acme Corp');
      writeFileSync(join(rootPath, 'collaboration', 'research-brief.md'), '# Research Brief\n\nCompetitive analysis.');

      const res = await request(app)
        .post(`/api/dossiers/${id}/refresh`)
        .send({});

      expect(res.status).toBe(202);
      expect(res.body.dossierId).toBe(id);
      expect(res.body.status).toBe('refreshing');

      // Wait for fire-and-forget pipeline to fail (mocked) and release lock
      await new Promise(resolve => setTimeout(resolve, 200));
    });

    it('should return 404 for nonexistent dossier', async () => {
      const fakeId = randomUUID();
      const res = await request(app)
        .post(`/api/dossiers/${fakeId}/refresh`)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('should return 409 for archived dossier', async () => {
      const { id, rootPath } = createDossierWithDir('ArchivedCorp', 'archived');
      writeFileSync(join(rootPath, 'collaboration', 'research-brief.md'), '# Brief');

      const res = await request(app)
        .post(`/api/dossiers/${id}/refresh`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('archived');
    });

    it('should return 423 when a refresh is already in progress', async () => {
      const { id, rootPath } = createDossierWithDir('BusyCorp');
      writeFileSync(join(rootPath, 'collaboration', 'research-brief.md'), '# Brief\n\nTest.');

      // First call should succeed with 202
      const res1 = await request(app)
        .post(`/api/dossiers/${id}/refresh`)
        .send({});
      expect(res1.status).toBe(202);

      // Second concurrent call should return 423
      const res2 = await request(app)
        .post(`/api/dossiers/${id}/refresh`)
        .send({});
      expect(res2.status).toBe(423);
      expect(res2.body.error).toContain('already in progress');

      // Wait for pipeline to fail (mocked) and release lock
      await new Promise(resolve => setTimeout(resolve, 300));
    });

    it('should create an ephemeral project in the database', async () => {
      const { id, rootPath } = createDossierWithDir('EphemCorp');
      writeFileSync(join(rootPath, 'collaboration', 'research-brief.md'), '# Brief\n\nTest.');

      await refreshDossier(id);

      // Check that a project was created with the dossier name in it
      const projects = testDb.prepare(
        "SELECT * FROM projects WHERE name LIKE '%EphemCorp%Refresh%'"
      ).all() as any[];
      expect(projects.length).toBeGreaterThanOrEqual(1);
      expect(projects[0].status).toBe('brief_approved');

      await new Promise(resolve => setTimeout(resolve, 200));
    });

    it('should log dossier_refresh_started event', async () => {
      const { id, rootPath } = createDossierWithDir('EventCorp');
      writeFileSync(join(rootPath, 'collaboration', 'research-brief.md'), '# Brief\n\nTest.');

      await refreshDossier(id);

      const events = testDb.prepare(
        "SELECT * FROM events WHERE event_type = 'dossier_refresh_started'"
      ).all() as any[];

      expect(events.length).toBeGreaterThanOrEqual(1);
      const metadata = JSON.parse(events[0].metadata);
      expect(metadata.dossierId).toBe(id);
      expect(metadata.regenerateArtifacts).toBe(true);
      expect(metadata.referenceDate).toBeDefined();

      await new Promise(resolve => setTimeout(resolve, 200));
    });

    it('should release lock after pipeline failure', async () => {
      const { id, rootPath } = createDossierWithDir('FailCorp');
      writeFileSync(join(rootPath, 'collaboration', 'research-brief.md'), '# Brief\n\nTest.');

      const result = await refreshDossier(id);
      expect(result.status).toBe('refreshing');

      // Wait for the pipeline to advance past createResearchProject + set status
      await new Promise(resolve => setTimeout(resolve, 500));

      // Find the ephemeral project and set it to a failed status so pollResearchComplete exits
      const ephemeral = testDb.prepare(
        "SELECT id FROM projects WHERE name LIKE '%FailCorp%Refresh%'"
      ).get() as any;
      expect(ephemeral).toBeDefined();

      testDb.prepare("UPDATE projects SET status = 'research_failed' WHERE id = ?").run(ephemeral.id);

      // Wait for pipeline to detect failure on next poll cycle (5s interval + margin)
      await new Promise(resolve => setTimeout(resolve, 7000));

      // Lock should be released via finally block
      expect(isRefreshInProgress(id)).toBe(false);
    }, 15000);

    it('isRefreshInProgress returns false when no refresh is active', () => {
      expect(isRefreshInProgress(randomUUID())).toBe(false);
    });

    it('should accept regenerateArtifacts option', async () => {
      const { id, rootPath } = createDossierWithDir('OptsCorp');
      writeFileSync(join(rootPath, 'collaboration', 'research-brief.md'), '# Brief\n\nTest.');

      const result = await refreshDossier(id, { regenerateArtifacts: false });
      expect(result.dossierId).toBe(id);
      expect(result.status).toBe('refreshing');

      await new Promise(resolve => setTimeout(resolve, 200));
    });

    it('should fail when dossier has no research brief', async () => {
      const { id } = createDossierWithDir('NoBriefCorp');
      // No brief file written

      const res = await request(app)
        .post(`/api/dossiers/${id}/refresh`)
        .send({});

      expect([400, 500]).toContain(res.status);
    });
  });

  // ===========================================================================
  // EP-06: POST /:dossierId/update-from-project (copy-back flow)
  // ===========================================================================

  describe('POST /:dossierId/update-from-project', () => {
    it('should copy all output files to dossier', async () => {
      const { id: dossierId, rootPath: dossierRoot } = createDossierWithDir('Zeta GmbH');
      const { id: projectId, rootPath: projectRoot } = createProjectWithDir('Zeta Research', 'complete');
      linkProject(dossierId, projectId, 'refresh');

      writeFileSync(join(projectRoot, 'research', 'kimi.md'), '# Kimi Research\n\nFindings.');
      writeFileSync(join(projectRoot, 'verification', 'verification_report.md'), '# Verification Report');
      writeFileSync(join(projectRoot, 'analysis', 'assessment.md'), '# Strategic Assessment');
      writeFileSync(join(projectRoot, 'artifacts', 'swot.md'), '# SWOT Analysis');
      writeFileSync(join(projectRoot, 'collaboration', 'research-brief.md'), '# Brief');

      const res = await request(app)
        .post(`/api/dossiers/${dossierId}/update-from-project`)
        .send({ projectId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      expect(existsSync(join(dossierRoot, 'research', 'kimi.md'))).toBe(true);
      expect(existsSync(join(dossierRoot, 'verification', 'verification_report.md'))).toBe(true);
      expect(existsSync(join(dossierRoot, 'analysis', 'assessment.md'))).toBe(true);
      expect(existsSync(join(dossierRoot, 'artifacts', 'swot.md'))).toBe(true);
      expect(existsSync(join(dossierRoot, 'collaboration', 'research-brief.md'))).toBe(true);
    });

    it('should update dossier metadata', async () => {
      const { id: dossierId } = createDossierWithDir('Eta Corp');
      const { id: projectId, rootPath: projectRoot } = createProjectWithDir('Eta Research', 'complete');
      linkProject(dossierId, projectId, 'refresh');

      writeFileSync(join(projectRoot, 'research', 'kimi.md'), 'word1 word2 word3 word4 word5');
      writeFileSync(join(projectRoot, 'artifacts', 'swot.md'), '# SWOT');

      const res = await request(app)
        .post(`/api/dossiers/${dossierId}/update-from-project`)
        .send({ projectId });

      expect(res.status).toBe(200);

      const dossier = testDb.prepare('SELECT * FROM dossiers WHERE id = ?').get(dossierId) as any;
      expect(dossier.research_word_count).toBe(5);
      expect(dossier.artifact_count).toBeGreaterThanOrEqual(1);
      expect(dossier.last_refreshed_at).toBeDefined();
    });

    it('should append change log with word count delta', async () => {
      const { id: dossierId, rootPath: dossierRoot } = createDossierWithDir('Theta Inc');
      writeFileSync(join(dossierRoot, 'research', 'old.md'), 'old research data here');

      const { id: projectId, rootPath: projectRoot } = createProjectWithDir('Theta Research', 'complete');
      linkProject(dossierId, projectId, 'refresh');

      writeFileSync(join(projectRoot, 'research', 'kimi.md'), 'new research data with more words in it now');

      const res = await request(app)
        .post(`/api/dossiers/${dossierId}/update-from-project`)
        .send({ projectId });

      expect(res.status).toBe(200);
      expect(res.body.changeLogEntry).toBeDefined();
      expect(res.body.changeLogEntry.type).toBe('refreshed');
      expect(res.body.changeLogEntry.summary).toContain('\u2192');
      expect(res.body.changeLogEntry.sourceProjectId).toBe(projectId);

      const dossier = testDb.prepare('SELECT change_log FROM dossiers WHERE id = ?').get(dossierId) as any;
      const changeLog = JSON.parse(dossier.change_log);
      const refreshEntry = changeLog.find((e: any) => e.type === 'refreshed');
      expect(refreshEntry).toBeDefined();
      expect(refreshEntry.summary).toContain('Research:');
      expect(refreshEntry.summary).toContain('Total:');
    });

    it('should return 400 for incomplete project', async () => {
      const { id: dossierId } = createDossierWithDir('Iota LLC');
      const { id: projectId } = createProjectWithDir('Iota Research', 'researching');
      linkProject(dossierId, projectId, 'refresh');

      const res = await request(app)
        .post(`/api/dossiers/${dossierId}/update-from-project`)
        .send({ projectId });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not complete');
    });

    it('should return 400 for unlinked project', async () => {
      const { id: dossierId } = createDossierWithDir('Kappa Ltd');
      const { id: projectId } = createProjectWithDir('Unlinked Project', 'complete');

      const res = await request(app)
        .post(`/api/dossiers/${dossierId}/update-from-project`)
        .send({ projectId });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not linked');
    });
  });

  // ===========================================================================
  // Dashboard linkedDossier enrichment
  // ===========================================================================

  describe('Dashboard linkedDossier enrichment', () => {
    it('should return linkedDossier for refresh-linked projects', async () => {
      const { id: dossierId } = createDossierWithDir('Lambda Corp');
      const { id: projectId, rootPath: projectRoot } = createProjectWithDir('Lambda Refresh', 'not_started');
      linkProject(dossierId, projectId, 'refresh');

      mkdirSync(join(projectRoot, 'exports'), { recursive: true });

      const res = await request(app).get(`/api/projects/${projectId}`);

      expect(res.status).toBe(200);
      expect(res.body.linkedDossier).toBeDefined();
      expect(res.body.linkedDossier.dossierId).toBe(dossierId);
      expect(res.body.linkedDossier.competitorName).toBe('Lambda Corp');
    });

    it('should return null linkedDossier for unlinked projects', async () => {
      const { id: projectId } = createProjectWithDir('Standalone Project', 'not_started');

      const res = await request(app).get(`/api/projects/${projectId}`);

      expect(res.status).toBe(200);
      expect(res.body.linkedDossier).toBeNull();
    });
  });
});
