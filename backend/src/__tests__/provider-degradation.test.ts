/**
 * Tests for 2-of-3 provider degradation logic in checkAndAdvanceStatus().
 *
 * Validates that research completes successfully when at least one provider
 * succeeds, even if others fail — fixing the R-005 gap where any single
 * provider failure killed the entire research phase.
 */
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

// Mock task-persistence to avoid side-effect failures
vi.mock('../services/task-persistence.js', () => ({
  createTask: vi.fn(() => null),
  completeTask: vi.fn(),
  failTask: vi.fn(),
  updateTaskProgress: vi.fn(),
  getActiveTask: vi.fn(() => null),
}));

import { checkAndAdvanceStatus } from '../services/research.js';
import { EVENT_TYPES } from '../services/event-logger.js';

function makeProviderStatus(status: 'pending' | 'running' | 'complete' | 'failed' | 'stopped') {
  // Use a recent startedAt so running providers don't trip the 45-min timeout
  const recentStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  return {
    status,
    wordCount: status === 'complete' ? 5000 : null,
    startedAt: recentStart,
    completedAt: status === 'complete' ? new Date().toISOString() : null,
    content: status === 'complete' ? 'Research content here...' : null,
  };
}

describe('Provider Degradation (R-005)', () => {
  const PROJECT_ID = 'deg-proj-1';

  beforeEach(() => {
    testDb = createTestDb();
    // Create events table for event logging
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
    // Insert test project in researching state
    testDb.prepare(`
      INSERT INTO projects (id, name, root_path, status)
      VALUES (?, ?, ?, 'researching')
    `).run(PROJECT_ID, 'Degradation Test', '/tmp/deg-test', );
  });

  afterEach(() => {
    testDb.close();
  });

  it('2 complete + 1 failed → research_complete', () => {
    checkAndAdvanceStatus(PROJECT_ID, {
      kimi: makeProviderStatus('complete'),
      gemini: makeProviderStatus('complete'),
      edr: makeProviderStatus('failed'),
    });
    const project = testDb.prepare('SELECT status, error_message FROM projects WHERE id = ?').get(PROJECT_ID) as any;
    expect(project.status).toBe('research_complete');
    expect(project.error_message).toBeNull();
  });

  it('1 complete + 2 failed → research_complete', () => {
    checkAndAdvanceStatus(PROJECT_ID, {
      kimi: makeProviderStatus('failed'),
      gemini: makeProviderStatus('failed'),
      edr: makeProviderStatus('complete'),
    });
    const project = testDb.prepare('SELECT status, error_message FROM projects WHERE id = ?').get(PROJECT_ID) as any;
    expect(project.status).toBe('research_complete');
    expect(project.error_message).toBeNull();
  });

  it('3 failed → research_failed', () => {
    checkAndAdvanceStatus(PROJECT_ID, {
      kimi: makeProviderStatus('failed'),
      gemini: makeProviderStatus('failed'),
      edr: makeProviderStatus('failed'),
    });
    const project = testDb.prepare('SELECT status, error_message FROM projects WHERE id = ?').get(PROJECT_ID) as any;
    expect(project.status).toBe('research_failed');
    expect(project.error_message).toContain('all providers');
  });

  it('1 complete + 1 failed + 1 running → stays researching', () => {
    checkAndAdvanceStatus(PROJECT_ID, {
      kimi: makeProviderStatus('complete'),
      gemini: makeProviderStatus('failed'),
      edr: makeProviderStatus('running'),
    });
    const project = testDb.prepare('SELECT status FROM projects WHERE id = ?').get(PROJECT_ID) as any;
    expect(project.status).toBe('researching');
  });

  it('2 complete + 1 stopped → research_complete', () => {
    checkAndAdvanceStatus(PROJECT_ID, {
      kimi: makeProviderStatus('complete'),
      gemini: makeProviderStatus('complete'),
      edr: makeProviderStatus('stopped'),
    });
    const project = testDb.prepare('SELECT status, error_message FROM projects WHERE id = ?').get(PROJECT_ID) as any;
    expect(project.status).toBe('research_complete');
    expect(project.error_message).toBeNull();
  });

  it('3 complete → research_complete (happy path)', () => {
    checkAndAdvanceStatus(PROJECT_ID, {
      kimi: makeProviderStatus('complete'),
      gemini: makeProviderStatus('complete'),
      edr: makeProviderStatus('complete'),
    });
    const project = testDb.prepare('SELECT status FROM projects WHERE id = ?').get(PROJECT_ID) as any;
    expect(project.status).toBe('research_complete');
  });

  it('research_degraded event logged when completing with failed providers', () => {
    checkAndAdvanceStatus(PROJECT_ID, {
      kimi: makeProviderStatus('complete'),
      gemini: makeProviderStatus('failed'),
      edr: makeProviderStatus('complete'),
    });
    const events = testDb.prepare(
      "SELECT * FROM events WHERE event_type = ? AND project_id = ?"
    ).all(EVENT_TYPES.research_degraded, PROJECT_ID) as any[];
    expect(events).toHaveLength(1);
    const metadata = JSON.parse(events[0].metadata);
    expect(metadata.completedProviders).toContain('kimi');
    expect(metadata.completedProviders).toContain('edr');
    expect(metadata.failedProviders).toContain('gemini');
  });

  it('no research_degraded event when all 3 complete', () => {
    checkAndAdvanceStatus(PROJECT_ID, {
      kimi: makeProviderStatus('complete'),
      gemini: makeProviderStatus('complete'),
      edr: makeProviderStatus('complete'),
    });
    const events = testDb.prepare(
      "SELECT * FROM events WHERE event_type = ? AND project_id = ?"
    ).all(EVENT_TYPES.research_degraded, PROJECT_ID) as any[];
    expect(events).toHaveLength(0);
  });

  it('1 complete + 1 failed + 1 stopped → research_complete with degraded event', () => {
    checkAndAdvanceStatus(PROJECT_ID, {
      kimi: makeProviderStatus('complete'),
      gemini: makeProviderStatus('failed'),
      edr: makeProviderStatus('stopped'),
    });
    const project = testDb.prepare('SELECT status FROM projects WHERE id = ?').get(PROJECT_ID) as any;
    expect(project.status).toBe('research_complete');
    const events = testDb.prepare(
      "SELECT * FROM events WHERE event_type = ? AND project_id = ?"
    ).all(EVENT_TYPES.research_degraded, PROJECT_ID) as any[];
    expect(events).toHaveLength(1);
    const metadata = JSON.parse(events[0].metadata);
    expect(metadata.stoppedProviders).toContain('edr');
  });

  it('all stopped → research_failed', () => {
    checkAndAdvanceStatus(PROJECT_ID, {
      kimi: makeProviderStatus('stopped'),
      gemini: makeProviderStatus('stopped'),
      edr: makeProviderStatus('stopped'),
    });
    const project = testDb.prepare('SELECT status, error_message FROM projects WHERE id = ?').get(PROJECT_ID) as any;
    expect(project.status).toBe('research_failed');
    expect(project.error_message).toContain('stopped');
  });
});
