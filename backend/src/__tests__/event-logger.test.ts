/**
 * Unit tests for event-logger service.
 *
 * Uses in-memory SQLite via test-db helper, with the events table
 * created manually (since createTestDb only runs schema.sql).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from './helpers/test-db.js';
import type Database from 'better-sqlite3';

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

// Import after mocking
import {
  logEvent,
  getEventsByProject,
  getEventsByType,
  getAllEvents,
  EVENT_TYPES,
  dedupMap,
  flushDedupSummary,
} from '../services/event-logger.js';

describe('Event Logger Service', () => {
  beforeEach(() => {
    testDb = createTestDb();
    // Add the events table (not in schema.sql — it's an idempotent migration)
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

  // =========================================================================
  // logEvent
  // =========================================================================

  it('should create an event with all fields', () => {
    logEvent(EVENT_TYPES.export_initiated, 'proj-1', { format: 'docx', artifactType: 'swot' });

    const rows = testDb.prepare('SELECT * FROM events').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].project_id).toBe('proj-1');
    expect(rows[0].event_type).toBe('export_initiated');
    expect(rows[0].timestamp).toBeTruthy();
    expect(rows[0].id).toBeTruthy();

    const metadata = JSON.parse(rows[0].metadata);
    expect(metadata.format).toBe('docx');
    expect(metadata.artifactType).toBe('swot');
  });

  it('should create an event with null metadata', () => {
    logEvent(EVENT_TYPES.project_created, 'proj-1');

    const rows = testDb.prepare('SELECT * FROM events').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toBeNull();
  });

  it('should create an event with null projectId', () => {
    logEvent(EVENT_TYPES.phase_started, null, { phase: 'research' });

    const rows = testDb.prepare('SELECT * FROM events').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].project_id).toBeNull();
  });

  // =========================================================================
  // getEventsByProject
  // =========================================================================

  it('should get events by project ID', () => {
    logEvent(EVENT_TYPES.project_created, 'proj-1', { projectName: 'Test' });
    logEvent(EVENT_TYPES.phase_started, 'proj-1', { phase: 'research' });
    logEvent(EVENT_TYPES.project_created, 'proj-2', { projectName: 'Other' });

    const events = getEventsByProject('proj-1');
    expect(events).toHaveLength(2);
    expect(events.every(e => e.projectId === 'proj-1')).toBe(true);
  });

  it('should return empty array for unknown project', () => {
    const events = getEventsByProject('nonexistent');
    expect(events).toHaveLength(0);
  });

  // =========================================================================
  // getEventsByType
  // =========================================================================

  it('should get events by type', () => {
    logEvent(EVENT_TYPES.export_initiated, 'proj-1', { format: 'docx' });
    logEvent(EVENT_TYPES.export_completed, 'proj-1', { format: 'docx' });
    logEvent(EVENT_TYPES.export_initiated, 'proj-2', { format: 'pptx' });

    const events = getEventsByType(EVENT_TYPES.export_initiated);
    expect(events).toHaveLength(2);
    expect(events.every(e => e.eventType === 'export_initiated')).toBe(true);
  });

  it('should filter events after a date', () => {
    // Insert events with controlled timestamps
    testDb.prepare(`
      INSERT INTO events (id, timestamp, project_id, event_type, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run('evt-1', '2026-01-01T00:00:00.000Z', 'proj-1', 'export_initiated', null);

    testDb.prepare(`
      INSERT INTO events (id, timestamp, project_id, event_type, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run('evt-2', '2026-02-01T00:00:00.000Z', 'proj-1', 'export_initiated', null);

    const events = getEventsByType('export_initiated', '2026-01-15T00:00:00.000Z');
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('evt-2');
  });

  it('should filter events before a date', () => {
    testDb.prepare(`
      INSERT INTO events (id, timestamp, project_id, event_type, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run('evt-1', '2026-01-01T00:00:00.000Z', 'proj-1', 'phase_started', null);

    testDb.prepare(`
      INSERT INTO events (id, timestamp, project_id, event_type, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run('evt-2', '2026-02-01T00:00:00.000Z', 'proj-1', 'phase_started', null);

    const events = getEventsByType('phase_started', undefined, '2026-01-15T00:00:00.000Z');
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('evt-1');
  });

  it('should filter events with both after and before', () => {
    testDb.prepare(`
      INSERT INTO events (id, timestamp, project_id, event_type, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run('evt-1', '2026-01-01T00:00:00.000Z', 'proj-1', 'phase_completed', null);

    testDb.prepare(`
      INSERT INTO events (id, timestamp, project_id, event_type, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run('evt-2', '2026-02-01T00:00:00.000Z', 'proj-1', 'phase_completed', null);

    testDb.prepare(`
      INSERT INTO events (id, timestamp, project_id, event_type, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run('evt-3', '2026-03-01T00:00:00.000Z', 'proj-1', 'phase_completed', null);

    const events = getEventsByType(
      'phase_completed',
      '2026-01-15T00:00:00.000Z',
      '2026-02-15T00:00:00.000Z',
    );
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('evt-2');
  });

  // =========================================================================
  // Non-blocking behavior
  // =========================================================================

  it('should not throw when database fails (non-blocking)', () => {
    // Close the DB to simulate a failure
    testDb.close();

    // logEvent should silently fail, not throw
    expect(() => logEvent(EVENT_TYPES.export_initiated, 'proj-1')).not.toThrow();

    // Re-open for afterEach cleanup
    testDb = createTestDb();
  });

  // =========================================================================
  // getAllEvents cap
  // =========================================================================

  it('should include dossier_refresh_started in EVENT_TYPES', () => {
    expect(EVENT_TYPES.dossier_refresh_started).toBe('dossier_refresh_started');
  });

  // =========================================================================
  // Dedup — provider_failure / provider_retry
  // =========================================================================

  it('should log the first provider_failure event normally', () => {
    dedupMap.clear();
    logEvent(EVENT_TYPES.provider_failure, 'proj-d1', { provider: 'kimi', error: 'timeout' });

    const rows = testDb.prepare("SELECT * FROM events WHERE event_type = 'provider_failure'").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].project_id).toBe('proj-d1');
  });

  it('should suppress duplicate provider_failure within dedup window', () => {
    dedupMap.clear();
    logEvent(EVENT_TYPES.provider_failure, 'proj-d2', { provider: 'kimi', error: 'timeout' });
    logEvent(EVENT_TYPES.provider_failure, 'proj-d2', { provider: 'kimi', error: 'timeout' });
    logEvent(EVENT_TYPES.provider_failure, 'proj-d2', { provider: 'kimi', error: 'timeout' });

    const rows = testDb.prepare("SELECT * FROM events WHERE event_type = 'provider_failure' AND project_id = 'proj-d2'").all() as any[];
    expect(rows).toHaveLength(1); // Only the first one logged
  });

  it('should log provider_failure after dedup window expires', () => {
    dedupMap.clear();
    logEvent(EVENT_TYPES.provider_failure, 'proj-d3', { provider: 'kimi', error: 'timeout' });

    // Manually expire the dedup entry
    const key = 'proj-d3:provider_failure:kimi';
    const entry = dedupMap.get(key);
    if (entry) entry.lastLoggedAt = Date.now() - 6 * 60 * 1000; // 6 minutes ago

    logEvent(EVENT_TYPES.provider_failure, 'proj-d3', { provider: 'kimi', error: 'timeout' });

    const rows = testDb.prepare("SELECT * FROM events WHERE event_type = 'provider_failure' AND project_id = 'proj-d3'").all() as any[];
    expect(rows).toHaveLength(2); // Both logged — window expired
  });

  it('should flush dedup summary with correct suppressed count', () => {
    dedupMap.clear();
    logEvent(EVENT_TYPES.provider_failure, 'proj-d4', { provider: 'kimi', error: 'timeout' });
    // Suppress 5 more
    for (let i = 0; i < 5; i++) {
      logEvent(EVENT_TYPES.provider_failure, 'proj-d4', { provider: 'kimi', error: 'timeout' });
    }

    flushDedupSummary('proj-d4');

    const summaryRows = testDb.prepare("SELECT * FROM events WHERE event_type = 'dedup_summary' AND project_id = 'proj-d4'").all() as any[];
    expect(summaryRows).toHaveLength(1);

    const metadata = JSON.parse(summaryRows[0].metadata);
    expect(metadata.totalSuppressed).toBe(5);
    expect(metadata.summaries).toHaveLength(1);
    expect(metadata.summaries[0].provider).toBe('kimi');
    expect(metadata.summaries[0].suppressedCount).toBe(5);

    // Dedup state should be cleared
    expect(dedupMap.size).toBe(0);
  });

  it('should not create a dedup_summary if nothing was suppressed', () => {
    dedupMap.clear();
    logEvent(EVENT_TYPES.provider_failure, 'proj-d5', { provider: 'gemini', error: 'rate limit' });

    flushDedupSummary('proj-d5');

    const summaryRows = testDb.prepare("SELECT * FROM events WHERE event_type = 'dedup_summary' AND project_id = 'proj-d5'").all() as any[];
    expect(summaryRows).toHaveLength(0);
  });

  it('should cap getAllEvents at 1000', () => {
    // Insert 1005 events directly
    const stmt = testDb.prepare(`
      INSERT INTO events (id, timestamp, project_id, event_type, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < 1005; i++) {
      stmt.run(`evt-${i}`, `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`, 'proj-1', 'phase_started', null);
    }

    const events = getAllEvents();
    expect(events).toHaveLength(1000);
  });
});
