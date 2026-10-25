/**
 * Event Logger Service — SQLite-backed event logging for analytics
 *
 * Provides non-blocking event recording for pilot validation and usage analytics.
 * All logEvent calls are wrapped in try-catch — logging is a side-effect,
 * never a gatekeeper. If SQLite fails, the primary operation continues.
 */

import { randomUUID } from 'crypto';
import { prepare } from '../db/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface EventRecord {
  id: string;
  timestamp: string;
  projectId: string | null;
  eventType: string;
  metadata: Record<string, unknown> | null;
}

// =============================================================================
// EVENT TYPES
// =============================================================================

export const EVENT_TYPES = {
  // Group 1: Export events (primary KPI)
  export_initiated: 'export_initiated',
  export_completed: 'export_completed',

  // Group 2: Artifact events (grid rebalancing validation)
  artifact_selected: 'artifact_selected',
  artifact_generation_started: 'artifact_generation_started',
  artifact_generation_completed: 'artifact_generation_completed',
  artifact_generation_failed: 'artifact_generation_failed',

  // Group 3: Lifecycle events (funnel analysis)
  project_created: 'project_created',
  phase_started: 'phase_started',
  phase_completed: 'phase_completed',
  phase_failed: 'phase_failed',

  // Group 4: Provider/Reliability events
  provider_failure: 'provider_failure',
  provider_retry: 'provider_retry',
  provider_timeout: 'provider_timeout',
  provider_completed: 'provider_completed',
  research_degraded: 'research_degraded',
  kimi_filter_applied: 'kimi_filter_applied',

  // Group 5: Dossier events (library lifecycle)
  dossier_created: 'dossier_created',
  dossier_archived: 'dossier_archived',
  dossier_unarchived: 'dossier_unarchived',
  dossier_refresh_started: 'dossier_refresh_started',
  dossier_refresh_completed: 'dossier_refresh_completed',
  dossier_updated_from_project: 'dossier_updated_from_project',
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];

// =============================================================================
// DEDUP — Suppress repeated provider_failure / provider_retry events
// =============================================================================

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const DEDUP_EVENT_TYPES: Set<string> = new Set([EVENT_TYPES.provider_failure, EVENT_TYPES.provider_retry]);

interface DedupEntry {
  lastLoggedAt: number;
  suppressedCount: number;
}

/** In-memory dedup state keyed by projectId:eventType:provider */
export const dedupMap = new Map<string, DedupEntry>();

function getDedupKey(projectId: string | null, eventType: string, metadata?: Record<string, unknown>): string | null {
  if (!projectId || !DEDUP_EVENT_TYPES.has(eventType)) return null;
  const provider = metadata?.provider as string | undefined;
  if (!provider) return null;
  return `${projectId}:${eventType}:${provider}`;
}

/**
 * Flush dedup summary for a project — logs a summary event with suppressed counts
 * and clears the dedup state for that project. Call at provider terminal state.
 * Non-blocking — never throws.
 */
export function flushDedupSummary(projectId: string): void {
  try {
    const summaries: Array<{ eventType: string; provider: string; suppressedCount: number }> = [];

    for (const [key, entry] of dedupMap.entries()) {
      if (key.startsWith(`${projectId}:`) && entry.suppressedCount > 0) {
        const parts = key.split(':');
        summaries.push({
          eventType: parts[1],
          provider: parts[2],
          suppressedCount: entry.suppressedCount,
        });
      }
    }

    // Clear all dedup entries for this project
    for (const key of [...dedupMap.keys()]) {
      if (key.startsWith(`${projectId}:`)) {
        dedupMap.delete(key);
      }
    }

    if (summaries.length > 0) {
      const totalSuppressed = summaries.reduce((sum, s) => sum + s.suppressedCount, 0);
      const id = randomUUID();
      const timestamp = new Date().toISOString();
      const metadataJson = JSON.stringify({ summaries, totalSuppressed });

      prepare(`
        INSERT INTO events (id, timestamp, project_id, event_type, metadata)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, timestamp, projectId, 'dedup_summary', metadataJson);
    }
  } catch (err) {
    console.warn('[event-logger] flushDedupSummary failed:', (err as Error).message);
  }
}

// =============================================================================
// CORE OPERATIONS
// =============================================================================

/**
 * Log an event. Non-blocking — never throws.
 * Dedup-eligible types (provider_failure, provider_retry) are suppressed if
 * an identical event was logged within the dedup window.
 */
export function logEvent(
  eventType: string,
  projectId: string | null,
  metadata?: Record<string, unknown>,
): void {
  try {
    // Check dedup
    const dedupKey = getDedupKey(projectId, eventType, metadata);
    if (dedupKey) {
      const existing = dedupMap.get(dedupKey);
      const now = Date.now();
      if (existing && (now - existing.lastLoggedAt) < DEDUP_WINDOW_MS) {
        existing.suppressedCount++;
        return; // Suppress this event
      }
      // First occurrence or window expired — log normally and update dedup state
      dedupMap.set(dedupKey, { lastLoggedAt: now, suppressedCount: 0 });
    }

    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    prepare(`
      INSERT INTO events (id, timestamp, project_id, event_type, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, timestamp, projectId, eventType, metadataJson);
  } catch (err) {
    console.warn('[event-logger] logEvent failed:', (err as Error).message);
  }
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Get all events for a project, ordered by timestamp DESC.
 */
export function getEventsByProject(projectId: string): EventRecord[] {
  try {
    const rows = prepare(`
      SELECT id, timestamp, project_id, event_type, metadata
      FROM events
      WHERE project_id = ?
      ORDER BY timestamp DESC
    `).all(projectId) as any[];

    return rows.map(mapRow);
  } catch (err) {
    console.warn('[event-logger] getEventsByProject failed:', (err as Error).message);
    return [];
  }
}

/**
 * Get events by type with optional date range filters.
 */
export function getEventsByType(
  eventType: string,
  after?: string,
  before?: string,
): EventRecord[] {
  try {
    let sql = `
      SELECT id, timestamp, project_id, event_type, metadata
      FROM events
      WHERE event_type = ?
    `;
    const params: unknown[] = [eventType];

    if (after) {
      sql += ' AND timestamp > ?';
      params.push(after);
    }
    if (before) {
      sql += ' AND timestamp < ?';
      params.push(before);
    }

    sql += ' ORDER BY timestamp DESC';

    const rows = prepare(sql).all(...params) as any[];
    return rows.map(mapRow);
  } catch (err) {
    console.warn('[event-logger] getEventsByType failed:', (err as Error).message);
    return [];
  }
}

/**
 * Get all events with optional date range, capped at 1000.
 */
export function getAllEvents(after?: string, before?: string): EventRecord[] {
  try {
    let sql = `
      SELECT id, timestamp, project_id, event_type, metadata
      FROM events
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (after) {
      sql += ' AND timestamp > ?';
      params.push(after);
    }
    if (before) {
      sql += ' AND timestamp < ?';
      params.push(before);
    }

    sql += ' ORDER BY timestamp DESC LIMIT 1000';

    const rows = prepare(sql).all(...params) as any[];
    return rows.map(mapRow);
  } catch (err) {
    console.warn('[event-logger] getAllEvents failed:', (err as Error).message);
    return [];
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function mapRow(row: any): EventRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    projectId: row.project_id ?? null,
    eventType: row.event_type,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}
