/**
 * Recovery Service — Handles startup recovery of stale project states
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { prepare } from '../db/index.js';

const PROJECTS_ROOT = process.env.PROJECTS_ROOT || join(
  new URL('../../projects', import.meta.url).pathname
);

/**
 * Recover projects stuck in transient statuses.
 *
 * On startup, check for projects stuck in statuses that indicate an in-progress
 * operation but have been idle for >1 hour. These indicate the backend crashed
 * or was restarted mid-operation.
 *
 * Statuses checked:
 * - brief_generating → brief_failed
 * - researching → research_complete (if files on disk) or research_failed
 * - verifying → research_complete (verifier lost state; user can re-start)
 * - analyzing → analysis_failed
 * - generating_artifacts → artifacts_failed
 */
export function recoverStaleStatuses(): void {
  const now = Date.now();

  const staleProjects = prepare(`
    SELECT id, name, status, root_path as rootPath, updated_at
    FROM projects
    WHERE status IN ('brief_generating', 'researching', 'verifying', 'analyzing', 'generating_artifacts')
      AND updated_at < datetime('now', '-1 hour')
  `).all() as Array<{
    id: string;
    name: string;
    status: string;
    rootPath: string;
    updated_at: string;
  }>;

  if (staleProjects.length === 0) {
    console.log('[recovery] No stale projects found');
    return;
  }

  console.log(`[recovery] Found ${staleProjects.length} stale project(s)`);

  for (const project of staleProjects) {
    const updatedAt = new Date(project.updated_at + 'Z').getTime();
    const staleMinutes = Math.floor((now - updatedAt) / (60 * 1000));

    let newStatus: string;
    let errorMessage: string | null;

    switch (project.status) {
      case 'brief_generating':
        newStatus = 'brief_generation_failed';
        errorMessage = `Brief generation timed out (stale for ${staleMinutes} minutes). Recovered on startup.`;
        break;

      case 'researching': {
        // Check disk for completed research files
        const researchResult = checkResearchFilesOnDisk(project.id, project.rootPath);
        if (researchResult.fileCount > 0) {
          newStatus = 'research_complete';
          errorMessage = null;
          console.log(`[recovery] ${project.name}: found ${researchResult.fileCount} research file(s) on disk (${researchResult.files.join(', ')})`);
        } else {
          newStatus = 'research_failed';
          errorMessage = `Research stalled (no progress for ${staleMinutes} minutes). The research service may have restarted. Recovered on startup.`;
        }
        break;
      }

      case 'verifying':
        // Verifier uses in-memory state — if stale, it lost the task.
        // Reset to research_complete so user can re-start verification.
        newStatus = 'research_complete';
        errorMessage = null;
        // Clear the stale verifier_task_id
        prepare(`UPDATE projects SET verifier_task_id = NULL WHERE id = ?`).run(project.id);
        console.log(`[recovery] ${project.name}: cleared stale verifier_task_id`);
        break;

      case 'analyzing':
        newStatus = 'analysis_failed';
        errorMessage = `Analysis timed out (stale for ${staleMinutes} minutes). Recovered on startup.`;
        break;

      case 'generating_artifacts':
        newStatus = 'artifacts_failed';
        errorMessage = `Artifact generation timed out (stale for ${staleMinutes} minutes). Recovered on startup.`;
        break;

      default:
        continue;
    }

    prepare(`
      UPDATE projects
      SET status = ?, error_message = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(newStatus, errorMessage, project.id);

    console.log(`[recovery] ${project.name} (${project.id}): ${project.status} → ${newStatus} (stale ${staleMinutes}m)`);
  }
}

/**
 * Check for research output files on disk.
 * Returns the count and names of .md files in the project's research/ directory.
 */
function checkResearchFilesOnDisk(projectId: string, rootPath: string): { fileCount: number; files: string[] } {
  // Try rootPath first, then PROJECTS_ROOT fallback
  const candidates = [
    join(rootPath, 'research'),
    join(PROJECTS_ROOT, projectId, 'research'),
  ];

  for (const dir of candidates) {
    if (existsSync(dir)) {
      try {
        const files = readdirSync(dir).filter(f => f.endsWith('.md'));
        if (files.length > 0) {
          return { fileCount: files.length, files };
        }
      } catch {
        // Directory read error, try next candidate
      }
    }
  }

  return { fileCount: 0, files: [] };
}
