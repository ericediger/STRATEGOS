/**
 * Verification service — proxy between STRATEGOS backend and citation verifier (port 9002)
 */

import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { checkVerifierHealth as checkHealth } from './health.js';
import { createTask, completeTask, failTask, updateTaskProgress, getActiveTask } from './task-persistence.js';
import { logEvent, EVENT_TYPES } from './event-logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VERIFIER_URL = process.env.VERIFIER_URL || 'http://localhost:9002';
const PROJECTS_ROOT = process.env.PROJECTS_ROOT || join(__dirname, '../../projects');

interface VerifierTaskState {
  task_id: string;
  type: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  current_step: string;
  project_id: number;
  unit_number: number;
  created_at: string;
  completed_at?: string;
  error?: string;
  result?: {
    verification_report_path: string;
    sizing_report_path?: string;
    quality_gate: {
      status: 'PASSED' | 'REVIEW_RECOMMENDED';
      total_claims: number;
      verified: number;
      discrepancy: number;
      hallucination: number;
      unverifiable: number;
      failure_rate: number;
    };
  };
}

/**
 * Derive a stable integer project ID from a UUID string.
 * The verifier expects a numeric project_id for directory keying.
 * Uses the first 8 hex characters of the UUID parsed as base-16,
 * ensuring each project gets its own output namespace.
 */
export function uuidToProjectId(uuid: string): number {
  const hex = uuid.replace(/-/g, '').slice(0, 8);
  return parseInt(hex, 16);
}

/**
 * Check if the citation verifier service is healthy.
 * Re-exported from health.ts for backwards compatibility.
 */
export async function checkVerifierHealth(): Promise<boolean> {
  return checkHealth();
}

/** Start verification by sending research file paths to the verifier. */
export async function startVerification(projectId: string): Promise<string> {
  const researchDir = resolve(PROJECTS_ROOT, projectId, 'research');

  if (!existsSync(researchDir)) {
    throw new Error(`Research directory not found: ${researchDir}`);
  }

  // Collect research file absolute paths (dynamic scan)
  const files = readdirSync(researchDir)
    .filter(f => f.endsWith('.md'))
    .map(f => resolve(join(researchDir, f)));

  if (files.length === 0) {
    throw new Error('No research files found for verification');
  }

  const numericProjectId = uuidToProjectId(projectId);
  console.log(`[verification] Sending ${files.length} files to verifier (project_id: ${numericProjectId}): ${files.map(f => f.split('/').pop()).join(', ')}`);

  const response = await fetch(`${VERIFIER_URL}/api/verify/unit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: numericProjectId,
      unit_number: 1,
      unit_title: 'Research Verification',
      files,
      skip_sizing: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Verifier error ${response.status}: ${text}`);
  }

  const data = await response.json() as { task_id: string; status: string };

  // Persist task record (side-effect, non-blocking)
  try { createTask(projectId, 'verification'); } catch { /* persistence is best-effort */ }
  try { logEvent(EVENT_TYPES.phase_started, projectId, { phase: 'verification' }); } catch { /* non-blocking */ }

  return data.task_id;
}

/** Get verification status from the verifier. */
export async function getVerificationStatus(taskId: string): Promise<VerifierTaskState> {
  const response = await fetch(`${VERIFIER_URL}/api/verify/status/${taskId}`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Verifier status error ${response.status}`);
  }

  return await response.json() as VerifierTaskState;
}

/** Save verification report to project directory. */
export async function saveVerificationReport(projectId: string, reportContent: string): Promise<string> {
  const verificationDir = resolve(PROJECTS_ROOT, projectId, 'verification');
  if (!existsSync(verificationDir)) {
    mkdirSync(verificationDir, { recursive: true });
  }

  const reportPath = join(verificationDir, 'verification_report.md');
  writeFileSync(reportPath, reportContent, 'utf-8');
  console.log(`[verification] Report saved: ${reportPath}`);
  return reportPath;
}

/** Update task persistence based on verification status changes. */
export function updateVerificationTaskPersistence(projectId: string, status: 'complete' | 'failed', error?: string): void {
  try {
    const active = getActiveTask(projectId, 'verification');
    if (active) {
      if (status === 'complete') {
        completeTask(active.id);
      } else {
        failTask(active.id, error || 'Verification failed');
      }
    }
  } catch { /* persistence is best-effort */ }
  if (status === 'complete') {
    try { logEvent(EVENT_TYPES.phase_completed, projectId, { phase: 'verification' }); } catch { /* non-blocking */ }
  } else {
    try { logEvent(EVENT_TYPES.provider_failure, projectId, { provider: 'kimi', phase: 'verification', error: error?.slice(0, 500) }); } catch { /* non-blocking */ }
    try { logEvent(EVENT_TYPES.phase_failed, projectId, { phase: 'verification', error: error || 'Verification failed' }); } catch { /* non-blocking */ }
  }
}

/** Update task progress for verification step changes. */
export function updateVerificationProgress(projectId: string, step: string, progress: number): void {
  try {
    const active = getActiveTask(projectId, 'verification');
    if (active) {
      updateTaskProgress(active.id, { currentStep: step, progress });
    }
  } catch { /* persistence is best-effort */ }
}

/** Map verifier task state to frontend-friendly status. */
export function mapVerificationStatus(task: VerifierTaskState) {
  const stepLabels: Record<string, string> = {
    queued: 'Queued',
    consolidate: 'Consolidating research files',
    extract: 'Extracting claims',
    investigate: 'Investigating sources',
    adjudicate: 'Adjudicating claims',
    consensus: 'Cross-provider consensus',
    report: 'Generating report',
    sizing: 'Calculating sizing',
    done: 'Complete',
  };

  return {
    completed: task.status === 'completed',
    status: task.status === 'queued' ? 'pending' as const
      : task.status === 'running' ? 'running' as const
      : task.status === 'completed' ? 'complete' as const
      : 'failed' as const,
    progress: task.progress,
    currentStep: stepLabels[task.current_step] || task.current_step,
    claimCount: task.result?.quality_gate?.total_claims ?? null,
    issueRate: task.result?.quality_gate?.failure_rate ?? null,
    gateStatus: task.result?.quality_gate?.status ?? null,
    reportPath: task.result?.verification_report_path ?? null,
    error: task.error ?? null,
  };
}
