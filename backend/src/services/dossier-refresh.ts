/**
 * Dossier Refresh Service — EP-07 Delta Refresh Pipeline
 *
 * Orchestrates the full research-to-artifact refresh cycle for an existing dossier.
 * Creates an ephemeral project, runs Phases 1-4 in delta mode, copies results back,
 * and cleans up on success. On failure, the ephemeral project is retained for debugging.
 *
 * The per-dossier in-progress lock prevents concurrent refreshes of the same dossier.
 * The lock is always released in a finally block regardless of success or failure.
 */

import { randomUUID } from 'crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { prepare } from '../db/index.js';
import { getDossier, updateCachedMetrics, linkProject } from './dossier.js';
import type { ChangeLogEntry, DossierRecord } from './dossier.js';
import { createResearchProject, startResearchQueue, getResearchStatus, checkAndAdvanceStatus } from './research.js';
import { startVerification, getVerificationStatus, mapVerificationStatus, saveVerificationReport } from './verification.js';
import { startAnalysis, selectAndGenerateArtifacts } from './analysis.js';
import { parseVerificationReport, calculateConfidence } from './confidence.js';
import { logEvent } from './event-logger.js';

// =============================================================================
// IN-PROGRESS LOCK
// =============================================================================

const refreshLocks = new Map<string, boolean>();

export function isRefreshInProgress(dossierId: string): boolean {
  return refreshLocks.get(dossierId) === true;
}

// =============================================================================
// PUBLIC API
// =============================================================================

export async function refreshDossier(
  dossierId: string,
  options: { regenerateArtifacts?: boolean } = {},
): Promise<{ dossierId: string; status: 'refreshing' }> {
  // 1. Check lock
  if (refreshLocks.get(dossierId)) {
    throw Object.assign(new Error('A refresh is already in progress for this dossier'), { statusCode: 423 });
  }

  // 2. Set lock
  refreshLocks.set(dossierId, true);

  // 3. Read dossier
  let dossier: DossierRecord | null;
  try {
    dossier = getDossier(dossierId);
  } catch (err) {
    refreshLocks.delete(dossierId);
    throw err;
  }

  if (!dossier) {
    refreshLocks.delete(dossierId);
    throw Object.assign(new Error('Dossier not found'), { statusCode: 404 });
  }

  if (dossier.status === 'archived') {
    refreshLocks.delete(dossierId);
    throw Object.assign(new Error('Dossier is archived and cannot be refreshed'), { statusCode: 409 });
  }

  // 4. Determine reference date
  const referenceDate = (dossier.lastRefreshedAt || dossier.createdAt).split('T')[0];

  // 5. Create ephemeral project
  let ephemeralProjectId: string;
  try {
    ephemeralProjectId = createEphemeralProject(dossier, referenceDate);
  } catch (err) {
    refreshLocks.delete(dossierId);
    throw err;
  }

  const regenerateArtifacts = options.regenerateArtifacts !== false;

  // 6. Fire-and-forget the pipeline
  void runRefreshPipeline(ephemeralProjectId, dossierId, referenceDate, regenerateArtifacts);

  // 7. Return immediately
  return { dossierId, status: 'refreshing' };
}

// =============================================================================
// INTERNAL: EPHEMERAL PROJECT
// =============================================================================

function createEphemeralProject(dossier: DossierRecord, referenceDate: string): string {
  const briefPath = join(dossier.rootPath, 'collaboration', 'research-brief.md');
  if (!existsSync(briefPath)) {
    throw Object.assign(new Error('No research brief found in dossier'), { statusCode: 400 });
  }
  const briefContent = readFileSync(briefPath, 'utf-8');

  const projectId = randomUUID();
  const today = new Date().toISOString().split('T')[0];
  const projectName = `${dossier.competitorName} — Refresh ${today}`;
  const projectsRoot = process.env.PROJECTS_ROOT || './projects';
  const projectRootPath = resolve(projectsRoot, projectId);

  for (const sub of ['collaboration', 'research', 'verification', 'analysis', 'artifacts']) {
    mkdirSync(join(projectRootPath, sub), { recursive: true });
  }

  const newBriefPath = join(projectRootPath, 'collaboration', 'research-brief.md');
  writeFileSync(newBriefPath, briefContent, 'utf-8');

  prepare(`
    INSERT INTO projects (id, name, root_path, status, research_brief_path)
    VALUES (?, ?, ?, 'brief_approved', ?)
  `).run(projectId, projectName, projectRootPath, newBriefPath);

  try {
    const briefId = randomUUID();
    prepare(`
      INSERT OR REPLACE INTO research_briefs (id, project_id, file_path, status, approved_at)
      VALUES (?, ?, ?, 'approved', datetime('now'))
    `).run(briefId, projectId, newBriefPath);
  } catch { /* persistence is best-effort */ }

  linkProject(dossier.id, projectId, 'refresh');

  console.log(`[refresh] Created ephemeral project ${projectId} for dossier ${dossier.id} (ref: ${referenceDate})`);

  return projectId;
}

// =============================================================================
// INTERNAL: PIPELINE
// =============================================================================

async function runRefreshPipeline(
  ephemeralProjectId: string,
  dossierId: string,
  referenceDate: string,
  regenerateArtifacts: boolean,
): Promise<void> {
  try {
    // Log refresh started event before any phase begins
    try {
      logEvent('dossier_refresh_started', ephemeralProjectId, {
        dossierId,
        regenerateArtifacts,
        referenceDate,
      });
    } catch { /* event logging never blocks primary operation */ }

    // Phase 1: Research (delta mode)
    console.log(`[refresh] Phase 1: Starting delta research for project ${ephemeralProjectId}`);
    const researcherProjectId = await createResearchProject(ephemeralProjectId);
    await startResearchQueue();
    prepare(`UPDATE projects SET status = 'researching' WHERE id = ? AND status = 'brief_approved'`).run(ephemeralProjectId);
    await pollResearchComplete(ephemeralProjectId, researcherProjectId, 5000, 60 * 60 * 1000);

    // Phase 2: Verification
    console.log(`[refresh] Phase 2: Starting verification for project ${ephemeralProjectId}`);
    const taskId = await startVerification(ephemeralProjectId);
    prepare(`UPDATE projects SET verifier_task_id = ?, status = 'verifying' WHERE id = ?`).run(taskId, ephemeralProjectId);
    await pollVerificationComplete(ephemeralProjectId, taskId, 5000, 45 * 60 * 1000);

    // Phase 3: Analysis
    console.log(`[refresh] Phase 3: Starting analysis for project ${ephemeralProjectId}`);
    prepare(`UPDATE projects SET status = 'verification_complete' WHERE id = ? AND status != 'verification_complete'`).run(ephemeralProjectId);
    startAnalysis(ephemeralProjectId);
    await pollUntilComplete(ephemeralProjectId, 'analysis_complete', ['analysis_failed'], 5000, 15 * 60 * 1000);

    // Phase 4: Artifacts (optional)
    if (regenerateArtifacts) {
      const artifactTypes = scanDossierArtifacts(dossierId);
      if (artifactTypes.length > 0) {
        console.log(`[refresh] Phase 4: Regenerating ${artifactTypes.length} artifacts for project ${ephemeralProjectId}`);
        await selectAndGenerateArtifacts(ephemeralProjectId, artifactTypes);
        await pollUntilComplete(ephemeralProjectId, 'complete', ['artifacts_failed'], 5000, 30 * 60 * 1000);
      } else {
        console.log(`[refresh] Phase 4: No existing artifacts to regenerate, skipping`);
      }
    }

    // Copy-back
    console.log(`[refresh] Copying outputs from project ${ephemeralProjectId} to dossier ${dossierId}`);
    copyDossierOutputs(ephemeralProjectId, dossierId);

    // Update dossier metadata
    updateCachedMetrics(dossierId);
    const dossier = getDossier(dossierId);
    if (!dossier) throw new Error('Dossier disappeared during refresh');

    let confidenceRating: string | null = dossier.confidenceRating;
    const verificationReportPath = join(dossier.rootPath, 'verification', 'verification_report.md');
    if (existsSync(verificationReportPath)) {
      try {
        const reportContent = readFileSync(verificationReportPath, 'utf-8');
        const parsed = parseVerificationReport(reportContent);
        const confidence = calculateConfidence(parsed, new Date());
        confidenceRating = confidence.rating;
      } catch { /* keep existing rating */ }
    }

    const now = new Date().toISOString();
    const changeLogEntry: ChangeLogEntry = {
      date: now,
      type: 'refreshed',
      summary: `Delta refresh from ${referenceDate}. Research: ${dossier.researchWordCount} words. Confidence: ${confidenceRating ?? 'N/A'}.`,
      sourceProjectId: ephemeralProjectId,
    };

    const changeLog = [...dossier.changeLog, changeLogEntry];

    prepare(`
      UPDATE dossiers
      SET last_refreshed_at = ?, confidence_rating = ?, updated_at = ?, change_log = ?
      WHERE id = ?
    `).run(now, confidenceRating, now, JSON.stringify(changeLog), dossierId);

    // Delete ephemeral project (success path only)
    deleteEphemeralProject(ephemeralProjectId);

    try {
      logEvent('dossier_refresh_completed', null, {
        dossierId,
        competitorName: dossier.competitorName,
        referenceDate,
        researchWordCount: dossier.researchWordCount,
        confidenceRating,
      });
    } catch { /* event logging never blocks primary operation */ }

    console.log(`[refresh] Dossier ${dossierId} refresh completed successfully`);

  } catch (err) {
    console.error(`[refresh] Pipeline failed for dossier ${dossierId}:`, (err as Error).message);
    // Do NOT delete ephemeral project on failure — leave for debugging
  } finally {
    refreshLocks.delete(dossierId);
  }
}

// =============================================================================
// INTERNAL: ACTIVE POLLING (Research + Verification)
// =============================================================================

/**
 * Actively poll the research engine and trigger status transitions.
 * Unlike pollUntilComplete, this calls getResearchStatus + checkAndAdvanceStatus
 * to drive the researching → research_complete transition.
 */
async function pollResearchComplete(
  projectId: string,
  researcherProjectId: number,
  intervalMs: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Check DB status first (fast, catches external status changes)
    const project = prepare('SELECT status FROM projects WHERE id = ?').get(projectId) as { status: string } | undefined;
    if (!project) throw new Error(`Project ${projectId} not found during polling`);
    if (project.status === 'research_complete') return;
    if (project.status === 'research_failed') throw new Error(`Phase failed: ${project.status}`);

    // Actively poll research engine and drive status transitions
    try {
      const research = await getResearchStatus(projectId, researcherProjectId);
      checkAndAdvanceStatus(projectId, research);
    } catch (err) {
      console.warn(`[refresh] Research status check failed:`, (err as Error).message);
    }

    // Re-check DB after research engine poll (may have advanced)
    const updated = prepare('SELECT status FROM projects WHERE id = ?').get(projectId) as { status: string } | undefined;
    if (!updated) throw new Error(`Project ${projectId} not found during polling`);
    if (updated.status === 'research_complete') return;
    if (updated.status === 'research_failed') throw new Error(`Phase failed: ${updated.status}`);

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout waiting for research_complete on project ${projectId}`);
}

/**
 * Actively poll the citation verifier and trigger status transitions.
 * Checks verifier status, copies report on completion, advances project status.
 */
async function pollVerificationComplete(
  projectId: string,
  taskId: string,
  intervalMs: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const taskState = await getVerificationStatus(taskId);
      const mapped = mapVerificationStatus(taskState);

      if (mapped.completed) {
        // Copy verification report to project directory
        if (mapped.reportPath) {
          try {
            const reportContent = readFileSync(mapped.reportPath, 'utf-8');
            await saveVerificationReport(projectId, reportContent);
          } catch (err) {
            console.warn('[refresh] Failed to copy verification report:', (err as Error).message);
          }
        }
        prepare(`UPDATE projects SET status = 'verification_complete' WHERE id = ?`).run(projectId);
        return;
      }

      if (mapped.status === 'failed') {
        prepare(`UPDATE projects SET status = 'verification_failed', error_message = 'Verification failed' WHERE id = ?`).run(projectId);
        throw new Error('Phase failed: verification_failed');
      }
    } catch (err) {
      if ((err as Error).message.includes('Phase failed')) throw err;
      console.warn(`[refresh] Verification status check failed:`, (err as Error).message);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout waiting for verification_complete on project ${projectId}`);
}

// =============================================================================
// INTERNAL: POLLING (for analysis/artifacts which self-advance)
// =============================================================================

async function pollUntilComplete(
  projectId: string,
  completedStatus: string,
  failedStatuses: string[],
  intervalMs: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const project = prepare('SELECT status FROM projects WHERE id = ?').get(projectId) as { status: string } | undefined;
    if (!project) throw new Error(`Project ${projectId} not found during polling`);
    if (project.status === completedStatus) return;
    if (failedStatuses.includes(project.status)) throw new Error(`Phase failed: ${project.status}`);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timeout waiting for ${completedStatus} on project ${projectId}`);
}

// =============================================================================
// INTERNAL: HELPERS
// =============================================================================

function scanDossierArtifacts(dossierId: string): string[] {
  const dossier = getDossier(dossierId);
  if (!dossier) return [];

  const artifactsDir = join(dossier.rootPath, 'artifacts');
  if (!existsSync(artifactsDir)) return [];

  const types: string[] = [];
  try {
    const entries = readdirSync(artifactsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        // Map filename (e.g., "swot.md") to artifact type key
        const type = entry.name.replace(/\.md$/, '');
        types.push(type);
      }
      // Skip subdirectories like exports/
    }
  } catch { /* ignore read errors */ }

  return types;
}

function copyDossierOutputs(ephemeralProjectId: string, dossierId: string): void {
  const project = prepare('SELECT root_path FROM projects WHERE id = ?').get(ephemeralProjectId) as { root_path: string } | undefined;
  if (!project) throw new Error('Ephemeral project not found for copy-back');

  const dossier = getDossier(dossierId);
  if (!dossier) throw new Error('Dossier not found for copy-back');

  const projectRoot = resolve(project.root_path);
  const dossierRoot = dossier.rootPath;

  const dirsToSync = ['research', 'verification', 'analysis', 'artifacts'];
  for (const dir of dirsToSync) {
    const srcDir = join(projectRoot, dir);
    if (!existsSync(srcDir)) continue;

    const destDir = join(dossierRoot, dir);
    mkdirSync(destDir, { recursive: true });

    copyDirectoryRecursive(srcDir, destDir);
  }

  // Copy collaboration brief
  const projectBriefPath = join(projectRoot, 'collaboration', 'research-brief.md');
  if (existsSync(projectBriefPath)) {
    mkdirSync(join(dossierRoot, 'collaboration'), { recursive: true });
    copyFileSync(projectBriefPath, join(dossierRoot, 'collaboration', 'research-brief.md'));
  }
}

function copyDirectoryRecursive(srcDir: string, destDir: string): void {
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirectoryRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function deleteEphemeralProject(projectId: string): void {
  const project = prepare('SELECT root_path FROM projects WHERE id = ?').get(projectId) as { root_path: string } | undefined;
  if (!project) return;

  // Delete from DB
  try {
    prepare('DELETE FROM dossier_projects WHERE project_id = ?').run(projectId);
  } catch { /* best-effort */ }
  try {
    prepare('DELETE FROM tasks WHERE project_id = ?').run(projectId);
  } catch { /* best-effort */ }
  try {
    prepare('DELETE FROM research_briefs WHERE project_id = ?').run(projectId);
  } catch { /* best-effort */ }
  try {
    prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  } catch { /* best-effort */ }

  // Delete files
  if (existsSync(project.root_path)) {
    try {
      rmSync(project.root_path, { recursive: true, force: true });
    } catch { /* best-effort */ }
  }

  console.log(`[refresh] Deleted ephemeral project ${projectId}`);
}
