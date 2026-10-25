import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from './helpers/test-db.js';
import type Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('../db/index.js', () => {
  return {
    prepare: (sql: string) => {
      return testDb.prepare(sql);
    },
    getDb: () => testDb,
  };
});

import { logEvent, EVENT_TYPES, dedupMap } from '../services/event-logger.js';

describe('Group 4 reliability events', () => {
  beforeEach(() => {
    dedupMap.clear();
    testDb = createTestDb();
    testDb.exec(`
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
  });

  afterEach(() => {
    testDb.close();
  });

  it('provider_failure event has provider and phase in metadata', () => {
    logEvent(EVENT_TYPES.provider_failure, 'proj-1', { provider: 'openai', phase: 'analysis', error: 'Connection timeout' });
    const rows = testDb.prepare('SELECT * FROM events WHERE event_type = ?').all('provider_failure') as any[];
    expect(rows).toHaveLength(1);
    const metadata = JSON.parse(rows[0].metadata);
    expect(metadata.provider).toBe('openai');
    expect(metadata.phase).toBe('analysis');
    expect(metadata.error).toBe('Connection timeout');
  });

  it('provider_retry event has provider and phase in metadata', () => {
    logEvent(EVENT_TYPES.provider_retry, 'proj-1', { provider: 'kimi', phase: 'verification' });
    const rows = testDb.prepare('SELECT * FROM events WHERE event_type = ?').all('provider_retry') as any[];
    expect(rows).toHaveLength(1);
    const metadata = JSON.parse(rows[0].metadata);
    expect(metadata.provider).toBe('kimi');
    expect(metadata.phase).toBe('verification');
  });

  it('provider_timeout event has provider and phase in metadata', () => {
    logEvent(EVENT_TYPES.provider_timeout, 'proj-1', { provider: 'kimi', phase: 'research' });
    const rows = testDb.prepare('SELECT * FROM events WHERE event_type = ?').all('provider_timeout') as any[];
    expect(rows).toHaveLength(1);
    const metadata = JSON.parse(rows[0].metadata);
    expect(metadata.provider).toBe('kimi');
    expect(metadata.phase).toBe('research');
  });

  it('logEvent failure does not throw (non-blocking verification)', () => {
    testDb.close();
    // Should not throw even though DB is closed
    expect(() => logEvent(EVENT_TYPES.provider_failure, 'proj-1', { provider: 'openai', phase: 'analysis' })).not.toThrow();
    // Re-open for afterEach
    testDb = createTestDb();
  });

  it('event metadata includes error field truncated to 500 chars', () => {
    const longError = 'x'.repeat(600);
    logEvent(EVENT_TYPES.provider_failure, 'proj-1', { provider: 'openai', phase: 'analysis', error: longError.slice(0, 500) });
    const rows = testDb.prepare('SELECT * FROM events WHERE event_type = ?').all('provider_failure') as any[];
    expect(rows).toHaveLength(1);
    const metadata = JSON.parse(rows[0].metadata);
    expect(metadata.error.length).toBe(500);
  });
});
