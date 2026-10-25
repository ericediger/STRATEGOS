/**
 * Database connection for STRATEGOS
 *
 * SQLite: Workflow state, project metadata, conversation history
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// SQLite Connection
// =============================================================================

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export function initDb(dbPath: string): Database.Database {
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  try {
    db.exec(schema);
  } catch (err) {
    const error = err as Error;
    if (!error.message.includes('already exists')) {
      console.error(`Schema error: ${error.message}`);
    }
  }

  // Migrations: add columns safely (idempotent)
  try {
    db.exec('ALTER TABLE projects ADD COLUMN verifier_task_id TEXT');
    console.log('[db] Migration: added verifier_task_id column');
  } catch (err) {
    const error = err as Error;
    if (!error.message.includes('duplicate column')) {
      // Column already exists — expected on subsequent runs
      if (!error.message.includes('already exists')) {
        console.error(`Migration error: ${error.message}`);
      }
    }
  }

  // Migration: Add error_message column to projects (Sprint 0 — error handling)
  try {
    db.exec('ALTER TABLE projects ADD COLUMN error_message TEXT DEFAULT NULL');
    console.log('[db] Migration: added error_message column to projects');
  } catch (err) {
    const error = err as Error;
    if (!error.message.includes('duplicate column')) {
      console.error(`Migration error (projects.error_message): ${error.message}`);
    }
  }

  // Migration: Add last_error column to selected_artifacts (Sprint 0 — error handling)
  try {
    db.exec('ALTER TABLE selected_artifacts ADD COLUMN last_error TEXT DEFAULT NULL');
    console.log('[db] Migration: added last_error column to selected_artifacts');
  } catch (err) {
    const error = err as Error;
    if (!error.message.includes('duplicate column')) {
      console.error(`Migration error (selected_artifacts.last_error): ${error.message}`);
    }
  }

  // Migration: Rebuild projects table to include failure statuses in CHECK constraint
  // SQLite cannot ALTER CHECK constraints, so we rebuild the table
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'").get() as { sql: string } | undefined;
    if (tableInfo && tableInfo.sql.includes("CHECK") && !tableInfo.sql.includes('brief_generation_failed')) {
      console.log('[db] Migration: rebuilding projects table to add failure statuses to CHECK constraint...');
      db.pragma('foreign_keys = OFF');
      db.exec(`
        CREATE TABLE projects_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          root_path TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'not_started'
            CHECK (status IN (
              'not_started',
              'collaborating',
              'brief_generated',
              'brief_generation_failed',
              'brief_approved',
              'researching',
              'research_complete',
              'research_failed',
              'verifying',
              'verification_complete',
              'verification_failed',
              'analyzing',
              'analysis_complete',
              'analysis_failed',
              'generating_artifacts',
              'artifacts_failed',
              'complete'
            )),
          research_brief_path TEXT,
          researcher_project_id INTEGER,
          verifier_task_id TEXT,
          error_message TEXT DEFAULT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO projects_new SELECT id, name, root_path, status, research_brief_path, researcher_project_id, verifier_task_id, error_message, created_at, updated_at FROM projects;
        DROP TABLE projects;
        ALTER TABLE projects_new RENAME TO projects;
        CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
        CREATE TRIGGER IF NOT EXISTS projects_updated
        AFTER UPDATE ON projects
        BEGIN
          UPDATE projects SET updated_at = datetime('now') WHERE id = NEW.id;
        END;
      `);
      db.pragma('foreign_keys = ON');
      console.log('[db] Migration: projects table rebuilt with failure statuses');
      // Clear statement cache since table was rebuilt
      stmtCache.clear();
    }
  } catch (err) {
    console.error('[db] Migration error (projects table rebuild):', (err as Error).message);
  }

  // Migration: Add last_exported_at column to selected_artifacts (Session 13 — download warning)
  try {
    db.exec('ALTER TABLE selected_artifacts ADD COLUMN last_exported_at TEXT DEFAULT NULL');
    console.log('[db] Migration: added last_exported_at column to selected_artifacts');
  } catch (err) {
    const error = err as Error;
    if (!error.message.includes('duplicate column')) {
      console.error(`Migration error (selected_artifacts.last_exported_at): ${error.message}`);
    }
  }

  // Migration: Create tasks table for long-running operation persistence (Session 28)
  try {
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
    console.log('[db] Migration: tasks table ready');
  } catch (err) {
    const error = err as Error;
    if (!error.message.includes('already exists')) {
      console.error(`Migration error (tasks table): ${error.message}`);
    }
  }

  // Migration: Create events table for analytics event logging (Session 29)
  try {
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
    console.log('[db] Migration: events table ready');
  } catch (err) {
    const error = err as Error;
    if (!error.message.includes('already exists')) {
      console.error(`Migration error (events table): ${error.message}`);
    }
  }

  // Migration: Create dossiers table (Session 30 — Competitor Dossier Library)
  try {
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
    console.log('[db] Migration: dossiers table ready');
  } catch (err) {
    const error = err as Error;
    if (!error.message.includes('already exists')) {
      console.error(`Migration error (dossiers table): ${error.message}`);
    }
  }

  // Migration: Create dossier_projects junction table (Session 30)
  try {
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
    console.log('[db] Migration: dossier_projects table ready');
  } catch (err) {
    const error = err as Error;
    if (!error.message.includes('already exists')) {
      console.error(`Migration error (dossier_projects table): ${error.message}`);
    }
  }

  // Migration: Add dossier_id column to projects (Session 30)
  try {
    db.exec('ALTER TABLE projects ADD COLUMN dossier_id TEXT REFERENCES dossiers(id)');
    console.log('[db] Migration: added dossier_id column to projects');
  } catch (err) {
    const error = err as Error;
    if (!error.message.includes('duplicate column')) {
      console.error(`Migration error (projects.dossier_id): ${error.message}`);
    }
  }

  // Migration: Add project_id and phase columns to llm_calls (Session 41 — token instrumentation)
  try {
    db.exec('ALTER TABLE llm_calls ADD COLUMN project_id TEXT');
    console.log('[db] Migration: added project_id column to llm_calls');
  } catch (err) {
    const error = err as Error;
    if (!error.message.includes('duplicate column')) {
      console.error(`Migration error (llm_calls.project_id): ${error.message}`);
    }
  }
  try {
    db.exec('ALTER TABLE llm_calls ADD COLUMN phase TEXT');
    console.log('[db] Migration: added phase column to llm_calls');
  } catch (err) {
    const error = err as Error;
    if (!error.message.includes('duplicate column')) {
      console.error(`Migration error (llm_calls.phase): ${error.message}`);
    }
  }

  console.log(`[db] SQLite initialized at ${dbPath}`);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[db] SQLite connection closed');
  }
}

// =============================================================================
// Helper: Transaction wrapper
// =============================================================================

export function transaction<T>(fn: () => T): T {
  const database = getDb();
  return database.transaction(fn)();
}

// =============================================================================
// Helper: Prepared statement cache
// =============================================================================

const stmtCache = new Map<string, Database.Statement>();

export function prepare(sql: string): Database.Statement {
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = getDb().prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt;
}
