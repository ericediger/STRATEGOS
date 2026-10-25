/**
 * Task Persistence Service — SQLite-backed tracking for long-running operations
 *
 * Provides durable task records that survive server restarts, complementing
 * the existing in-memory Maps in research/verification/analysis services.
 *
 * All database calls are wrapped in try-catch — persistence is a side-effect,
 * never a gatekeeper. If SQLite fails, the primary operation continues.
 */

import { randomUUID } from 'crypto';
import { prepare } from '../db/index.js';
import { logEvent, EVENT_TYPES } from './event-logger.js';

// =============================================================================
// TYPES
// =============================================================================

export interface TaskRecord {
  id: string;
  projectId: string;
  phase: string;
  status: string;
  progress: string | null;
  error: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

// =============================================================================
// CORE OPERATIONS
// =============================================================================

/**
 * Create or upsert a task record for a project phase.
 * If a task already exists for this project+phase, it is replaced.
 */
export function createTask(projectId: string, phase: string): TaskRecord | null {
  try {
    const id = randomUUID();
    const now = new Date().toISOString();

    // Upsert: delete any existing task for this project+phase, then insert
    prepare(`
      DELETE FROM tasks WHERE project_id = ? AND phase = ?
    `).run(projectId, phase);

    prepare(`
      INSERT INTO tasks (id, project_id, phase, status, started_at, updated_at)
      VALUES (?, ?, ?, 'running', ?, ?)
    `).run(id, projectId, phase, now, now);

    return {
      id,
      projectId,
      phase,
      status: 'running',
      progress: null,
      error: null,
      startedAt: now,
      updatedAt: now,
      completedAt: null,
    };
  } catch (err) {
    console.warn('[task-persistence] createTask failed:', (err as Error).message);
    return null;
  }
}

/**
 * Update progress JSON for a running task.
 */
export function updateTaskProgress(taskId: string, progress: Record<string, unknown>): void {
  try {
    const now = new Date().toISOString();
    prepare(`
      UPDATE tasks SET progress = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(progress), now, taskId);
  } catch (err) {
    console.warn('[task-persistence] updateTaskProgress failed:', (err as Error).message);
  }
}

/**
 * Mark a task as completed.
 */
export function completeTask(taskId: string): void {
  try {
    const now = new Date().toISOString();
    prepare(`
      UPDATE tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?
    `).run(now, now, taskId);
  } catch (err) {
    console.warn('[task-persistence] completeTask failed:', (err as Error).message);
  }
}

/**
 * Mark a task as failed with an error message.
 */
export function failTask(taskId: string, error: string): void {
  try {
    const now = new Date().toISOString();
    prepare(`
      UPDATE tasks SET status = 'failed', error = ?, completed_at = ?, updated_at = ? WHERE id = ?
    `).run(error, now, now, taskId);
  } catch (err) {
    console.warn('[task-persistence] failTask failed:', (err as Error).message);
  }
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Get the currently running task for a project phase (if any).
 */
export function getActiveTask(projectId: string, phase: string): TaskRecord | null {
  try {
    const row = prepare(`
      SELECT id, project_id, phase, status, progress, error, started_at, updated_at, completed_at
      FROM tasks
      WHERE project_id = ? AND phase = ? AND status = 'running'
      ORDER BY started_at DESC LIMIT 1
    `).get(projectId, phase) as any | undefined;

    if (!row) return null;

    return mapRow(row);
  } catch (err) {
    console.warn('[task-persistence] getActiveTask failed:', (err as Error).message);
    return null;
  }
}

/**
 * Get all tasks for a project, ordered by started_at DESC.
 */
export function getProjectTasks(projectId: string): TaskRecord[] {
  try {
    const rows = prepare(`
      SELECT id, project_id, phase, status, progress, error, started_at, updated_at, completed_at
      FROM tasks
      WHERE project_id = ?
      ORDER BY started_at DESC
    `).all(projectId) as any[];

    return rows.map(mapRow);
  } catch (err) {
    console.warn('[task-persistence] getProjectTasks failed:', (err as Error).message);
    return [];
  }
}

/**
 * Get all tasks with status='interrupted'.
 */
export function getInterruptedTasks(): TaskRecord[] {
  try {
    const rows = prepare(`
      SELECT id, project_id, phase, status, progress, error, started_at, updated_at, completed_at
      FROM tasks
      WHERE status = 'interrupted'
      ORDER BY started_at DESC
    `).all() as any[];

    return rows.map(mapRow);
  } catch (err) {
    console.warn('[task-persistence] getInterruptedTasks failed:', (err as Error).message);
    return [];
  }
}

/**
 * Mark a single task as interrupted.
 */
export function markInterrupted(taskId: string): void {
  try {
    const now = new Date().toISOString();
    prepare(`
      UPDATE tasks SET status = 'interrupted', updated_at = ? WHERE id = ?
    `).run(now, taskId);
  } catch (err) {
    console.warn('[task-persistence] markInterrupted failed:', (err as Error).message);
  }
}

// =============================================================================
// STARTUP RECOVERY
// =============================================================================

/** Phase-to-reset-status mapping: which project status to restore when a task was interrupted */
const PHASE_RESET_STATUS: Record<string, string> = {
  research: 'brief_approved',
  verification: 'research_complete',
  analysis: 'verification_complete',
  generating_artifacts: 'analysis_complete',
};

/**
 * Find tasks stuck in 'running' state (from a crashed server), mark them
 * as interrupted, and reset corresponding project statuses.
 */
export function recoverInterruptedTasks(): void {
  try {
    const runningTasks = prepare(`
      SELECT id, project_id, phase, status, progress, error, started_at, updated_at, completed_at
      FROM tasks
      WHERE status = 'running'
    `).all() as any[];

    if (runningTasks.length === 0) {
      console.log('[task-persistence] No interrupted tasks found');
      return;
    }

    console.log(`[task-persistence] Found ${runningTasks.length} interrupted task(s)`);

    for (const row of runningTasks) {
      const now = new Date().toISOString();

      // Mark the task as interrupted
      prepare(`
        UPDATE tasks SET status = 'interrupted', updated_at = ? WHERE id = ?
      `).run(now, row.id);

      // Reset the corresponding project status
      const resetStatus = PHASE_RESET_STATUS[row.phase];
      if (resetStatus) {
        prepare(`
          UPDATE projects SET status = ?, error_message = NULL WHERE id = ?
        `).run(resetStatus, row.project_id);
        console.log(`[task-persistence] Task ${row.id} (${row.phase}): interrupted, project ${row.project_id} reset to ${resetStatus}`);

        // For generating_artifacts: reset in-flight artifacts to pending, preserve completed ones
        if (row.phase === 'generating_artifacts') {
          try {
            const completedArtifacts = prepare(`
              SELECT id, artifact_type FROM selected_artifacts
              WHERE project_id = ? AND status = 'complete'
            `).all(row.project_id) as Array<{ id: string; artifact_type: string }>;

            const generatingArtifacts = prepare(`
              SELECT id, artifact_type FROM selected_artifacts
              WHERE project_id = ? AND status = 'generating'
            `).all(row.project_id) as Array<{ id: string; artifact_type: string }>;

            // Reset generating artifacts to selected (ready for re-generation)
            if (generatingArtifacts.length > 0) {
              prepare(`
                UPDATE selected_artifacts SET status = 'selected', last_error = NULL
                WHERE project_id = ? AND status = 'generating'
              `).run(row.project_id);
            }

            try {
              logEvent(EVENT_TYPES.phase_failed, row.project_id, {
                phase: 'generating_artifacts',
                reason: 'interrupted_on_startup',
                preservedArtifacts: completedArtifacts.map(a => a.artifact_type),
                resetArtifacts: generatingArtifacts.map(a => a.artifact_type),
              });
            } catch { /* non-blocking */ }

            console.log(`[task-persistence] Artifact recovery for ${row.project_id}: ${completedArtifacts.length} preserved, ${generatingArtifacts.length} reset to pending`);
          } catch (artifactErr) {
            console.warn('[task-persistence] Artifact recovery failed:', (artifactErr as Error).message);
          }
        }
      } else {
        console.log(`[task-persistence] Task ${row.id} (${row.phase}): interrupted (no project status reset for this phase)`);
      }
    }
  } catch (err) {
    console.warn('[task-persistence] recoverInterruptedTasks failed:', (err as Error).message);
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function mapRow(row: any): TaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    phase: row.phase,
    status: row.status,
    progress: row.progress ?? null,
    error: row.error ?? null,
    startedAt: row.started_at ?? null,
    updatedAt: row.updated_at ?? null,
    completedAt: row.completed_at ?? null,
  };
}
