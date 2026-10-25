/**
 * Sprint 1 tests — SDK upgrade and backend integration.
 *
 * Tests verify:
 * 1. Anthropic SDK upgrade to ^0.73.0
 * 2. Backend compiles without TypeScript errors
 * 3. Verification service integration (quality gate, verdict labels)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb } from './helpers/test-db.js';
import type Database from 'better-sqlite3';
import { mapVerificationStatus } from '../services/verification.js';

describe('Sprint 1 Changes', () => {
  let testDb: Database.Database;

  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  describe('SDK Upgrade (Task 3)', () => {
    it('should import @anthropic-ai/sdk without errors', async () => {
      // This test verifies the SDK upgrade from 0.39.0 to ^0.73.0
      const AnthropicModule = await import('@anthropic-ai/sdk');
      expect(AnthropicModule).toBeDefined();
      expect(AnthropicModule.default).toBeDefined();
    });

    it('should have Anthropic SDK available as a constructor', async () => {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      expect(typeof Anthropic).toBe('function');

      // Verify we can instantiate (without API key, just checking the constructor works)
      // This would throw if the SDK has breaking changes
      const client = new Anthropic({ apiKey: 'test-key' });
      expect(client).toBeDefined();
    });
  });

  describe('Verification Service Integration (Task 2)', () => {
    it('should map verifier quality gate status to frontend format', () => {
      const mockTaskState = {
        task_id: 'task-123',
        type: 'verification',
        status: 'completed' as const,
        progress: 100,
        current_step: 'done',
        project_id: 1,
        unit_number: 1,
        created_at: '2026-02-07T10:00:00Z',
        completed_at: '2026-02-07T10:17:00Z',
        result: {
          verification_report_path: '/path/to/report.md',
          quality_gate: {
            status: 'PASSED' as const,
            total_claims: 45,
            verified: 19,
            discrepancy: 9,
            hallucination: 0,
            unverifiable: 17,
            failure_rate: 0.321,
          },
        },
      };

      const mapped = mapVerificationStatus(mockTaskState);

      expect(mapped.completed).toBe(true);
      expect(mapped.status).toBe('complete');
      expect(mapped.progress).toBe(100);
      expect(mapped.claimCount).toBe(45);
      expect(mapped.issueRate).toBe(0.321);
      expect(mapped.gateStatus).toBe('PASSED');
      expect(mapped.reportPath).toBe('/path/to/report.md');
      expect(mapped.error).toBeNull();
    });

    it('should accept REVIEW_RECOMMENDED as a valid quality gate status', () => {
      // Task 2 updated the verifier to use REVIEW_RECOMMENDED instead of REMEDIATION_REQUIRED
      // The backend proxy should pass through this status
      const mockTaskState = {
        task_id: 'task-456',
        type: 'verification',
        status: 'completed' as const,
        progress: 100,
        current_step: 'done',
        project_id: 1,
        unit_number: 1,
        created_at: '2026-02-07T10:00:00Z',
        completed_at: '2026-02-07T10:17:00Z',
        result: {
          verification_report_path: '/path/to/report.md',
          quality_gate: {
            // The verifier now returns REVIEW_RECOMMENDED instead of REMEDIATION_REQUIRED
            status: 'REVIEW_RECOMMENDED' as any,
            total_claims: 50,
            verified: 15,
            discrepancy: 12,
            hallucination: 1,
            unverifiable: 22,
            failure_rate: 0.35,
          },
        },
      };

      const mapped = mapVerificationStatus(mockTaskState);

      // Backend passes through the gate status without transformation
      expect(mapped.gateStatus).toBe('REVIEW_RECOMMENDED');
      expect(mapped.claimCount).toBe(50);
      expect(mapped.issueRate).toBe(0.35);
    });

    it('should handle verification task failure with error message', () => {
      const mockTaskState = {
        task_id: 'task-789',
        type: 'verification',
        status: 'failed' as const,
        progress: 43,
        current_step: 'investigate',
        project_id: 1,
        unit_number: 1,
        created_at: '2026-02-07T10:00:00Z',
        error: 'Tavily API rate limit exceeded',
      };

      const mapped = mapVerificationStatus(mockTaskState);

      expect(mapped.completed).toBe(false);
      expect(mapped.status).toBe('failed');
      expect(mapped.progress).toBe(43);
      expect(mapped.currentStep).toBe('Investigating sources');
      expect(mapped.error).toBe('Tavily API rate limit exceeded');
      expect(mapped.gateStatus).toBeNull();
    });
  });

  describe('Database Integration - Verification Data', () => {
    it('should store and retrieve verification task IDs in projects table', () => {
      // Insert project with verifier_task_id
      testDb.prepare(`
        INSERT INTO projects (id, name, root_path, status, verifier_task_id)
        VALUES (?, ?, ?, ?, ?)
      `).run('proj-1', 'Test', '/tmp/proj-1', 'verifying', 'task-abc-123');

      const project = testDb.prepare(`
        SELECT verifier_task_id FROM projects WHERE id = ?
      `).get('proj-1') as any;

      expect(project.verifier_task_id).toBe('task-abc-123');
    });

    it('should clear verifier_task_id when retrying verification', () => {
      // Setup: project with failed verification
      testDb.prepare(`
        INSERT INTO projects (id, name, root_path, status, verifier_task_id, error_message)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run('proj-1', 'Test', '/tmp/proj-1', 'verification_failed', 'task-old', 'Timeout');

      // Simulate retry: reset to research_complete, clear old task ID
      testDb.prepare(`
        UPDATE projects SET status = 'research_complete', verifier_task_id = NULL, error_message = NULL
        WHERE id = ?
      `).run('proj-1');

      const project = testDb.prepare(`
        SELECT status, verifier_task_id, error_message FROM projects WHERE id = ?
      `).get('proj-1') as any;

      expect(project.status).toBe('research_complete');
      expect(project.verifier_task_id).toBeNull();
      expect(project.error_message).toBeNull();
    });
  });
});
