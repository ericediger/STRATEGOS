import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database;

vi.mock('../db/index.js', () => {
  return {
    prepare: (sql: string) => db.prepare(sql),
    getDb: () => db,
  };
});

import { logEvent, EVENT_TYPES } from '../services/event-logger.js';

describe('Provider Metrics (P2)', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf-8');
    db.exec(schema);
    // Create events table (from migration, not schema)
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        project_id TEXT,
        event_type TEXT NOT NULL,
        metadata TEXT
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('provider_completed event type exists', () => {
    expect(EVENT_TYPES.provider_completed).toBe('provider_completed');
  });

  it('logs provider_completed with timing and word count', () => {
    logEvent(EVENT_TYPES.provider_completed, 'proj-1', {
      provider: 'kimi',
      status: 'complete',
      duration_ms: 45000,
      word_count: 6500,
    });

    const rows = db.prepare('SELECT * FROM events WHERE event_type = ?').all('provider_completed') as any[];
    expect(rows).toHaveLength(1);

    const metadata = JSON.parse(rows[0].metadata);
    expect(metadata.provider).toBe('kimi');
    expect(metadata.status).toBe('complete');
    expect(metadata.duration_ms).toBe(45000);
    expect(metadata.word_count).toBe(6500);
  });

  it('logs failed provider with null word count', () => {
    logEvent(EVENT_TYPES.provider_completed, 'proj-2', {
      provider: 'gemini',
      status: 'failed',
      duration_ms: 120000,
      word_count: null,
    });

    const rows = db.prepare('SELECT * FROM events WHERE event_type = ?').all('provider_completed') as any[];
    expect(rows).toHaveLength(1);

    const metadata = JSON.parse(rows[0].metadata);
    expect(metadata.status).toBe('failed');
    expect(metadata.word_count).toBeNull();
  });

  it('logs stopped provider with null duration', () => {
    logEvent(EVENT_TYPES.provider_completed, 'proj-3', {
      provider: 'edr',
      status: 'stopped',
      duration_ms: null,
      word_count: null,
    });

    const rows = db.prepare('SELECT * FROM events WHERE event_type = ?').all('provider_completed') as any[];
    expect(rows).toHaveLength(1);

    const metadata = JSON.parse(rows[0].metadata);
    expect(metadata.status).toBe('stopped');
    expect(metadata.duration_ms).toBeNull();
  });
});
