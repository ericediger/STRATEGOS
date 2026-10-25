import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  const schemaPath = join(__dirname, '../../db/schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  return db;
}

export function clearTestDb(db: Database.Database) {
  db.exec('DELETE FROM projects');
  db.exec('DELETE FROM collaboration_sessions');
  db.exec('DELETE FROM research_briefs');
  db.exec('DELETE FROM selected_artifacts');
  db.exec('DELETE FROM workflow_actions');
}
