/**
 * Unit tests for task-persistence service.
 *
 * Uses in-memory SQLite via test-db helper, with the tasks table
 * created manually (since createTestDb only runs schema.sql).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb } from './helpers/test-db.js';
import type Database from 'better-sqlite3';

// We test the service functions by mocking the db module's `prepare` function
// to use our in-memory test database instead of the real one.

let testDb: Database.Database;

// Mock the db module to use our test database
vi.mock('../db/index.js', () => {
  return {
    prepare: (sql: string) => {
      // Lazily accessed — testDb is set in beforeEach
      return testDb.prepare(sql);
    },
    getDb: () => testDb,
  };
});

// Import after mocking
import {
  createTask,
  updateTaskProgress,
  completeTask,
  failTask,
  getActiveTask,
  getProjectTasks,
  getInterruptedTasks,
  markInterrupted,
  recoverInterruptedTasks,
} from '../services/task-persistence.js';

describe('Task Persistence Service', () => {
  beforeEach(() => {
    testDb = createTestDb();
    // Add the tasks table (not in schema.sql yet — it's an idempotent migration)
    testDb.exec(`
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

    // Insert a test project for foreign key references
    testDb.prepare(`
      INSERT INTO projects (id, name, root_path, status)
      VALUES (?, ?, ?, ?)
    `).run('proj-1', 'Test Project', '/tmp/proj-1', 'researching');
  });

  afterEach(() => {
    testDb.close();
  });

  // =========================================================================
  // createTask
  // =========================================================================

  it('should create a new task record with running status', () => {
    const task = createTask('proj-1', 'research');
    expect(task).not.toBeNull();
    expect(task!.projectId).toBe('proj-1');
    expect(task!.phase).toBe('research');
    expect(task!.status).toBe('running');
    expect(task!.startedAt).toBeTruthy();
    expect(task!.updatedAt).toBeTruthy();
    expect(task!.completedAt).toBeNull();

    // Verify in database
    const row = testDb.prepare('SELECT * FROM tasks WHERE id = ?').get(task!.id) as any;
    expect(row).toBeTruthy();
    expect(row.status).toBe('running');
  });

  it('should upsert (replace) existing task for same project+phase', () => {
    const task1 = createTask('proj-1', 'research');
    const task2 = createTask('proj-1', 'research');

    expect(task1).not.toBeNull();
    expect(task2).not.toBeNull();
    expect(task1!.id).not.toBe(task2!.id);

    // Only one task should exist for this project+phase
    const rows = testDb.prepare(
      'SELECT * FROM tasks WHERE project_id = ? AND phase = ?'
    ).all('proj-1', 'research');
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).id).toBe(task2!.id);
  });

  // =========================================================================
  // updateTaskProgress
  // =========================================================================

  it('should update task progress JSON and updated_at', () => {
    const task = createTask('proj-1', 'research');
    expect(task).not.toBeNull();

    const progress = { kimi: 'complete', gemini: 'running', edr: 'pending' };
    updateTaskProgress(task!.id, progress);

    const row = testDb.prepare('SELECT progress, updated_at FROM tasks WHERE id = ?').get(task!.id) as any;
    expect(JSON.parse(row.progress)).toEqual(progress);
    expect(row.updated_at).toBeTruthy();
  });

  // =========================================================================
  // completeTask
  // =========================================================================

  it('should mark task as completed with completed_at timestamp', () => {
    const task = createTask('proj-1', 'analysis');
    expect(task).not.toBeNull();

    completeTask(task!.id);

    const row = testDb.prepare('SELECT status, completed_at FROM tasks WHERE id = ?').get(task!.id) as any;
    expect(row.status).toBe('completed');
    expect(row.completed_at).toBeTruthy();
  });

  // =========================================================================
  // failTask
  // =========================================================================

  it('should mark task as failed with error message', () => {
    const task = createTask('proj-1', 'verification');
    expect(task).not.toBeNull();

    failTask(task!.id, 'Tavily rate limit exceeded');

    const row = testDb.prepare('SELECT status, error, completed_at FROM tasks WHERE id = ?').get(task!.id) as any;
    expect(row.status).toBe('failed');
    expect(row.error).toBe('Tavily rate limit exceeded');
    expect(row.completed_at).toBeTruthy();
  });

  // =========================================================================
  // getActiveTask
  // =========================================================================

  it('should return running task for a project phase', () => {
    createTask('proj-1', 'research');

    const active = getActiveTask('proj-1', 'research');
    expect(active).not.toBeNull();
    expect(active!.status).toBe('running');
    expect(active!.phase).toBe('research');
  });

  it('should return null when no active task exists', () => {
    const active = getActiveTask('proj-1', 'research');
    expect(active).toBeNull();
  });

  it('should not return completed tasks as active', () => {
    const task = createTask('proj-1', 'research');
    completeTask(task!.id);

    const active = getActiveTask('proj-1', 'research');
    expect(active).toBeNull();
  });

  // =========================================================================
  // getProjectTasks
  // =========================================================================

  it('should return all tasks for a project ordered by started_at DESC', () => {
    // Create a second project
    testDb.prepare(`
      INSERT INTO projects (id, name, root_path, status)
      VALUES (?, ?, ?, ?)
    `).run('proj-2', 'Other Project', '/tmp/proj-2', 'not_started');

    createTask('proj-1', 'research');
    createTask('proj-1', 'verification');
    createTask('proj-2', 'research'); // different project

    const tasks = getProjectTasks('proj-1');
    expect(tasks).toHaveLength(2);
    // Both should belong to proj-1
    expect(tasks.every(t => t.projectId === 'proj-1')).toBe(true);
  });

  // =========================================================================
  // getInterruptedTasks + markInterrupted
  // =========================================================================

  it('should mark task as interrupted and retrieve it', () => {
    const task = createTask('proj-1', 'research');
    expect(task).not.toBeNull();

    markInterrupted(task!.id);

    const interrupted = getInterruptedTasks();
    expect(interrupted).toHaveLength(1);
    expect(interrupted[0].id).toBe(task!.id);
    expect(interrupted[0].status).toBe('interrupted');
  });

  // =========================================================================
  // recoverInterruptedTasks (startup recovery)
  // =========================================================================

  it('should recover running tasks: mark interrupted and reset project status', () => {
    // Set project to 'researching' (simulating mid-research crash)
    testDb.prepare('UPDATE projects SET status = ? WHERE id = ?').run('researching', 'proj-1');

    // Create a running task
    createTask('proj-1', 'research');

    // Simulate server restart — recover
    recoverInterruptedTasks();

    // Task should be interrupted
    const tasks = testDb.prepare('SELECT status FROM tasks WHERE project_id = ?').all('proj-1') as any[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('interrupted');

    // Project should be reset to brief_approved (research phase reset)
    const project = testDb.prepare('SELECT status FROM projects WHERE id = ?').get('proj-1') as any;
    expect(project.status).toBe('brief_approved');
  });

  it('should recover multiple running tasks across different phases', () => {
    // Create second project
    testDb.prepare(`
      INSERT INTO projects (id, name, root_path, status)
      VALUES (?, ?, ?, ?)
    `).run('proj-2', 'Project 2', '/tmp/proj-2', 'verifying');

    testDb.prepare('UPDATE projects SET status = ? WHERE id = ?').run('analyzing', 'proj-1');

    createTask('proj-1', 'analysis');
    createTask('proj-2', 'verification');

    recoverInterruptedTasks();

    // proj-1 analysis → verification_complete
    const proj1 = testDb.prepare('SELECT status FROM projects WHERE id = ?').get('proj-1') as any;
    expect(proj1.status).toBe('verification_complete');

    // proj-2 verification → research_complete
    const proj2 = testDb.prepare('SELECT status FROM projects WHERE id = ?').get('proj-2') as any;
    expect(proj2.status).toBe('research_complete');

    // All tasks should be interrupted
    const interrupted = getInterruptedTasks();
    expect(interrupted).toHaveLength(2);
  });

  it('should handle recovery with no running tasks gracefully', () => {
    // No running tasks exist
    expect(() => recoverInterruptedTasks()).not.toThrow();
  });

  // =========================================================================
  // generating_artifacts recovery (R-006)
  // =========================================================================

  it('should recover generating_artifacts: reset generating artifacts to pending, preserve completed', () => {
    testDb.prepare('UPDATE projects SET status = ? WHERE id = ?').run('generating_artifacts', 'proj-1');

    // Create a running generating_artifacts task
    createTask('proj-1', 'generating_artifacts');

    // Insert artifacts in mixed states
    testDb.prepare(`
      INSERT INTO selected_artifacts (id, project_id, artifact_type, label, status)
      VALUES (?, ?, ?, ?, ?)
    `).run('art-1', 'proj-1', 'battle_card', 'Battle Card', 'complete');
    testDb.prepare(`
      INSERT INTO selected_artifacts (id, project_id, artifact_type, label, status)
      VALUES (?, ?, ?, ?, ?)
    `).run('art-2', 'proj-1', 'swot_analysis', 'SWOT Analysis', 'generating');
    testDb.prepare(`
      INSERT INTO selected_artifacts (id, project_id, artifact_type, label, status)
      VALUES (?, ?, ?, ?, ?)
    `).run('art-3', 'proj-1', 'market_overview', 'Market Overview', 'generating');

    recoverInterruptedTasks();

    // Project should be reset to analysis_complete
    const project = testDb.prepare('SELECT status FROM projects WHERE id = ?').get('proj-1') as any;
    expect(project.status).toBe('analysis_complete');

    // Completed artifact should be preserved
    const art1 = testDb.prepare('SELECT status FROM selected_artifacts WHERE id = ?').get('art-1') as any;
    expect(art1.status).toBe('complete');

    // Generating artifacts should be reset to selected
    const art2 = testDb.prepare('SELECT status FROM selected_artifacts WHERE id = ?').get('art-2') as any;
    expect(art2.status).toBe('selected');
    const art3 = testDb.prepare('SELECT status FROM selected_artifacts WHERE id = ?').get('art-3') as any;
    expect(art3.status).toBe('selected');
  });

  it('should recover generating_artifacts: all generating → all reset to pending', () => {
    testDb.prepare('UPDATE projects SET status = ? WHERE id = ?').run('generating_artifacts', 'proj-1');
    createTask('proj-1', 'generating_artifacts');

    testDb.prepare(`
      INSERT INTO selected_artifacts (id, project_id, artifact_type, label, status)
      VALUES (?, ?, ?, ?, ?)
    `).run('art-a', 'proj-1', 'battle_card', 'Battle Card', 'generating');
    testDb.prepare(`
      INSERT INTO selected_artifacts (id, project_id, artifact_type, label, status)
      VALUES (?, ?, ?, ?, ?)
    `).run('art-b', 'proj-1', 'swot_analysis', 'SWOT', 'generating');

    recoverInterruptedTasks();

    const project = testDb.prepare('SELECT status FROM projects WHERE id = ?').get('proj-1') as any;
    expect(project.status).toBe('analysis_complete');

    const artifacts = testDb.prepare(
      'SELECT status FROM selected_artifacts WHERE project_id = ?'
    ).all('proj-1') as any[];
    expect(artifacts).toHaveLength(2);
    expect(artifacts.every((a: any) => a.status === 'selected')).toBe(true);
  });
});
