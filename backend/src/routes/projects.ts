/**
 * Project management endpoints
 *
 * GET    /api/projects           - List all projects
 * POST   /api/projects           - Create a new project
 * GET    /api/projects/:id       - Get project with dashboard data
 * DELETE /api/projects/:id       - Delete a project
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { prepare, transaction } from '../db/index.js';
import { getPhaseFromStatus, getPhaseLabel } from '../types/workflow.js';
import { getResearchStatus, checkAndAdvanceStatus } from '../services/research.js';
import { getVerificationStatus, mapVerificationStatus, saveVerificationReport, updateVerificationTaskPersistence, updateVerificationProgress } from '../services/verification.js';
import { getProjectTasks } from '../services/task-persistence.js';
import { getAnalysisResult, getAnalysisTaskStatus, checkAndAdvanceArtifactStatus } from '../services/analysis.js';
import { getProjectConfidence, parseVerificationReport } from '../services/confidence.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { createProjectSchema, idParamSchema, projectIdParamSchema } from '../middleware/schemas.js';
import { logEvent, EVENT_TYPES, getEventsByProject, getEventsByType, getAllEvents } from '../services/event-logger.js';
import { getDossierLinkForProject } from '../services/dossier.js';

const router = Router();

const __booksDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));  // src/routes → src → backend
const PROJECTS_ROOT = process.env.PROJECTS_ROOT || join(__booksDir, 'projects');

// =============================================================================
// GET /api/projects - List all projects
// =============================================================================

router.get('/', (req, res) => {
  try {
    const projects = prepare(`
      SELECT
        p.id,
        p.name,
        p.status,
        p.updated_at as updatedAt
      FROM projects p
      ORDER BY p.updated_at DESC
    `).all() as { id: string; name: string; status: string; updatedAt: string }[];

    const result = projects.map(p => ({
      ...p,
      currentPhaseLabel: getPhaseLabel(p.status),
    }));

    res.json({ projects: result });
  } catch (err) {
    console.error('[projects] List error:', err);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// =============================================================================
// POST /api/projects - Create a new project
// =============================================================================

router.post('/', validateBody(createProjectSchema), (req, res) => {
  try {
    const { name } = req.body;

    const id = uuidv4();
    const rootPath = join(PROJECTS_ROOT, id);

    // Create directory structure
    mkdirSync(join(rootPath, 'collaboration'), { recursive: true });
    mkdirSync(join(rootPath, 'research'), { recursive: true });
    mkdirSync(join(rootPath, 'verification'), { recursive: true });
    mkdirSync(join(rootPath, 'analysis'), { recursive: true });
    mkdirSync(join(rootPath, 'artifacts'), { recursive: true });

    // Insert into database
    prepare(`
      INSERT INTO projects (id, name, root_path, status)
      VALUES (?, ?, ?, 'not_started')
    `).run(id, name.trim(), rootPath);

    const project = prepare(`
      SELECT
        id,
        name,
        root_path as rootPath,
        status,
        research_brief_path as researchBriefPath,
        created_at as createdAt,
        updated_at as updatedAt
      FROM projects WHERE id = ?
    `).get(id);

    console.log(`[projects] Created project: ${name} (${id})`);
    try { logEvent(EVENT_TYPES.project_created, id, { projectName: name.trim() }); } catch { /* non-blocking */ }
    res.status(201).json({ project });
  } catch (err) {
    console.error('[projects] Create error:', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// =============================================================================
// GET /api/projects/events - Query event log
// =============================================================================

router.get('/events', (req, res) => {
  try {
    const { project_id, event_type, after, before } = req.query as {
      project_id?: string;
      event_type?: string;
      after?: string;
      before?: string;
    };

    let events;
    if (project_id) {
      events = getEventsByProject(project_id);
    } else if (event_type) {
      events = getEventsByType(event_type, after, before);
    } else {
      events = getAllEvents(after, before);
    }

    res.json({ events });
  } catch (err) {
    console.error('[events] Query error:', err);
    res.status(500).json({ error: 'Failed to query events' });
  }
});

// =============================================================================
// GET /api/projects/:id - Get project with dashboard data
// =============================================================================

router.get('/:id', validateParams(idParamSchema), async (req, res) => {
  try {
    const { id } = req.params;

    const project = prepare(`
      SELECT
        id,
        name,
        root_path as rootPath,
        status,
        research_brief_path as researchBriefPath,
        researcher_project_id as researcherProjectId,
        verifier_task_id as verifierTaskId,
        error_message as errorMessage,
        created_at as createdAt,
        updated_at as updatedAt
      FROM projects WHERE id = ?
    `).get(id) as any;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Count collaboration messages
    const session = prepare(`
      SELECT messages FROM collaboration_sessions WHERE project_id = ?
    `).get(id) as { messages: string } | undefined;

    let messageCount = 0;
    if (session?.messages) {
      try {
        messageCount = JSON.parse(session.messages).length;
      } catch { /* empty */ }
    }

    // Get research brief status (verify file exists on disk, with path fallback)
    const briefRow = prepare(`
      SELECT file_path, status FROM research_briefs WHERE project_id = ?
    `).get(id) as { file_path: string; status: string } | undefined;
    const briefFileExists = briefRow && (
      existsSync(briefRow.file_path) ||
      existsSync(join(PROJECTS_ROOT, id, 'collaboration', 'research-brief.md'))
    );
    const brief = briefFileExists ? briefRow : undefined;

    // Get selected artifacts (with last_exported_at for download warning)
    const rawArtifacts = prepare(`
      SELECT
        id,
        project_id as projectId,
        artifact_type as artifactType,
        label,
        status,
        output_path as outputPath,
        last_error as lastError,
        last_exported_at as lastExportedAt,
        created_at as createdAt,
        completed_at as completedAt
      FROM selected_artifacts
      WHERE project_id = ?
      ORDER BY created_at
    `).all(id) as any[];

    // Enrich artifacts with available_exports from disk
    const artifacts = rawArtifacts.map((a: any) => {
      const availableExports: string[] = [];
      if (a.status === 'complete') {
        const exportsDir = join(PROJECTS_ROOT, id, 'exports');
        if (existsSync(exportsDir)) {
          const files = readdirSync(exportsDir);
          // Match files like "swot.docx", "swot.pptx"
          for (const f of files) {
            if (f.startsWith(a.artifactType + '.')) {
              availableExports.push(f);
            }
          }
        }
      }
      return { ...a, availableExports };
    });

    // Get recent workflow actions
    const activity = prepare(`
      SELECT
        id,
        project_id as projectId,
        phase,
        step_type as stepType,
        status,
        agent_id as agentId,
        input_paths as inputPaths,
        output_path as outputPath,
        tokens_input as tokensInput,
        tokens_output as tokensOutput,
        cost_usd as cost,
        started_at as startedAt,
        completed_at as completedAt,
        error,
        created_at as createdAt
      FROM workflow_actions
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(id);

    const status = project.status || 'not_started';

    // Fetch real research data if researcher_project_id exists
    let research = {
      kimi: { status: 'pending' as string, wordCount: null as number | null, startedAt: null as string | null, completedAt: null as string | null, content: null as string | null },
      gemini: { status: 'pending' as string, wordCount: null as number | null, startedAt: null as string | null, completedAt: null as string | null, content: null as string | null },
      edr: { status: 'pending' as string, wordCount: null as number | null, startedAt: null as string | null, completedAt: null as string | null, content: null as string | null },
    };

    if (project.researcherProjectId) {
      try {
        const liveResearch = await getResearchStatus(id, project.researcherProjectId);
        checkAndAdvanceStatus(id, liveResearch);
        research = liveResearch;
      } catch (err) {
        console.error('[projects] Research status fetch error:', err);
      }
    } else {
      // No researcher_project_id — check for imported research files on disk
      const researchDir = join(project.rootPath, 'research');
      if (existsSync(researchDir)) {
        const mdFiles = readdirSync(researchDir).filter((f: string) => f.endsWith('.md'));
        if (mdFiles.length > 0) {
          // Build research data from disk files
          const importedResearch: Record<string, any> = {};
          for (const file of mdFiles) {
            const key = file.replace('.md', '');
            try {
              const content = readFileSync(join(researchDir, file), 'utf-8');
              const wordCount = content.split(/\s+/).filter(Boolean).length;
              importedResearch[key] = {
                status: 'complete' as const,
                wordCount,
                startedAt: null,
                completedAt: null,
                content,
              };
            } catch {
              importedResearch[key] = {
                status: 'complete' as const,
                wordCount: null,
                startedAt: null,
                completedAt: null,
                content: null,
              };
            }
          }
          // Override the default kimi/gemini/edr structure with actual files
          research = importedResearch as any;
        }
      }
    }

    // Fetch real verification data if verifier_task_id exists
    let verification: any = {
      completed: false,
      status: 'pending',
      progress: 0,
      currentStep: null,
      claimCount: null,
      issueRate: null,
      gateStatus: null,
      reportContent: null,
      error: null,
    };

    if (project.verifierTaskId) {
      try {
        const taskState = await getVerificationStatus(project.verifierTaskId);
        const mapped = mapVerificationStatus(taskState);
        verification = { ...mapped, reportContent: null };

        // Update verification task persistence with step progress
        if (mapped.status === 'running') {
          updateVerificationProgress(id, taskState.current_step, taskState.progress);
        }

        // If completed and not yet advanced, save report and advance status
        const needsAdvance = mapped.completed && (status === 'verifying' || status === 'research_complete');
        if (needsAdvance) {
          updateVerificationTaskPersistence(id, 'complete');
          if (mapped.reportPath) {
            try {
              const { readFileSync } = await import('fs');
              const reportContent = readFileSync(mapped.reportPath, 'utf-8');
              await saveVerificationReport(id, reportContent);
            } catch (err) {
              console.error('[projects] Failed to copy verification report:', err);
            }
          }
          prepare(`
            UPDATE projects SET status = 'verification_complete' WHERE id = ?
          `).run(id);
          project.status = 'verification_complete';
        }

        // Load report content if completed — try local copy first, then verifier's path
        if (mapped.completed) {
          try {
            const localReportPath = join(project.rootPath, 'verification', 'verification_report.md');
            if (existsSync(localReportPath)) {
              verification.reportContent = readFileSync(localReportPath, 'utf-8');
            } else if (mapped.reportPath && existsSync(mapped.reportPath)) {
              verification.reportContent = readFileSync(mapped.reportPath, 'utf-8');
            }
          } catch { /* report not yet saved */ }
        }
      } catch (err) {
        const errMsg = (err as Error).message || '';
        console.error('[projects] Verification status fetch error:', errMsg);

        // Detect verifier losing track of the task (404 = task ID unknown after restart)
        if (errMsg.includes('404') && status === 'verifying') {
          const failMessage = 'The verification service lost track of this task (likely restarted). Please retry verification.';
          prepare(`
            UPDATE projects
            SET status = 'verification_failed', error_message = ?, verifier_task_id = NULL, updated_at = datetime('now')
            WHERE id = ?
          `).run(failMessage, id);
          project.status = 'verification_failed';
          verification = {
            ...verification,
            status: 'failed',
            error: failMessage,
          };
          updateVerificationTaskPersistence(id, 'failed', failMessage);
          console.log(`[projects] ${id}: verifier returned 404 → verification_failed`);
        }
      }
    }

    // Fallback: if project is past verification but verification data is still empty,
    // reconstruct it from the saved report on disk
    const pastVerificationStatuses = [
      'verification_complete', 'analyzing', 'analysis_failed', 'analysis_complete',
      'generating_artifacts', 'artifacts_failed', 'complete',
    ];
    if (pastVerificationStatuses.includes(project.status) && !verification.completed) {
      try {
        const reportPath = join(project.rootPath, 'verification', 'verification_report.md');
        if (existsSync(reportPath)) {
          const reportContent = readFileSync(reportPath, 'utf-8');
          const parsed = parseVerificationReport(reportContent);
          verification = {
            completed: true,
            status: 'complete',
            progress: 100,
            currentStep: 'Complete',
            claimCount: parsed.qualityGate.totalClaims,
            issueRate: parsed.qualityGate.issueRate,
            gateStatus: parsed.qualityGate.result,
            reportContent,
            error: null,
          };
        }
      } catch (err) {
        console.warn('[projects] Failed to load verification report from disk:', err);
      }
    }

    // Build real analysis data
    let analysis: any = {
      completed: false,
      status: 'pending',
      assessmentContent: null,
      wordCount: null,
      error: null,
    };

    const currentStatus = project.status || status;

    if (['analysis_complete', 'generating_artifacts', 'complete'].includes(currentStatus)) {
      const result = getAnalysisResult(id);
      analysis = {
        completed: true,
        status: 'complete',
        assessmentContent: result?.content || null,
        wordCount: result?.wordCount || null,
        error: null,
      };
    } else if (currentStatus === 'analyzing') {
      const task = getAnalysisTaskStatus(id);
      analysis = {
        completed: false,
        status: task?.status === 'failed' ? 'failed' : 'running',
        assessmentContent: null,
        wordCount: null,
        error: task?.error || null,
      };
    }

    // Auto-advance artifact status if generating
    if (currentStatus === 'generating_artifacts') {
      checkAndAdvanceArtifactStatus(id);
      // Re-read project status in case it advanced
      const refreshed = prepare('SELECT status FROM projects WHERE id = ?').get(id) as { status: string } | undefined;
      if (refreshed) {
        project.status = refreshed.status;
      }
    }

    // Confidence data (when verification is complete)
    let confidence = null;
    try {
      confidence = getProjectConfidence(id, PROJECTS_ROOT);
    } catch (err) {
      console.warn('[projects] Confidence calculation error:', err);
    }

    // Linked dossier (for refresh-linked projects)
    let linkedDossier = null;
    try {
      linkedDossier = getDossierLinkForProject(id);
    } catch { /* non-blocking */ }

    res.json({
      project,
      collaboration: {
        messageCount,
        briefGenerated: !!brief,
        briefApproved: brief?.status === 'approved',
      },
      research,
      verification,
      analysis,
      artifacts,
      confidence,
      linkedDossier,
      currentPhase: getPhaseFromStatus(project.status || status),
      attention: [],
      activity,
    });
  } catch (err) {
    console.error('[projects] Get error:', err);
    res.status(500).json({ error: 'Failed to get project' });
  }
});

// =============================================================================
// GET /api/projects/:id/confidence - Get confidence data
// =============================================================================

router.get('/:id/confidence', validateParams(idParamSchema), (req, res) => {
  try {
    const { id } = req.params;

    const project = prepare('SELECT id, root_path as rootPath FROM projects WHERE id = ?').get(id) as { id: string; rootPath: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const confidence = getProjectConfidence(id, PROJECTS_ROOT);

    if (!confidence) {
      return res.status(404).json({ error: 'No verification report found for this project' });
    }

    res.json(confidence);
  } catch (err) {
    console.error('[projects] Confidence error:', err);
    res.status(500).json({ error: 'Failed to calculate confidence' });
  }
});

// =============================================================================
// DELETE /api/projects/:id - Delete a project
// =============================================================================

router.delete('/:id', validateParams(idParamSchema), (req, res) => {
  try {
    const { id } = req.params;

    const project = prepare('SELECT id, name, root_path FROM projects WHERE id = ?').get(id) as { id: string; name: string; root_path: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    transaction(() => {
      // Clean up related rows in tables without ON DELETE CASCADE
      prepare('DELETE FROM dossier_projects WHERE project_id = ?').run(id);
      prepare('DELETE FROM tasks WHERE project_id = ?').run(id);
      prepare('DELETE FROM events WHERE project_id = ?').run(id);
      // Nullify dossier source references instead of deleting dossiers
      prepare('UPDATE dossiers SET source_project_id = NULL WHERE source_project_id = ?').run(id);
      prepare('DELETE FROM projects WHERE id = ?').run(id);
    });

    if (project.root_path && existsSync(project.root_path)) {
      rmSync(project.root_path, { recursive: true, force: true });
      console.log(`[projects] Deleted project files: ${project.root_path}`);
    }

    console.log(`[projects] Permanently deleted project: "${project.name}" (${id})`);
    res.json({ success: true, message: 'Project permanently deleted.' });
  } catch (err) {
    console.error('[projects] Delete error:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// =============================================================================
// GET /api/projects/:projectId/tasks - Get task history for a project
// =============================================================================

router.get('/:projectId/tasks', validateParams(projectIdParamSchema), (req, res) => {
  try {
    const { projectId } = req.params;

    const project = prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const tasks = getProjectTasks(projectId);
    res.json({ tasks });
  } catch (err) {
    console.error('[projects] Tasks error:', err);
    res.status(500).json({ error: 'Failed to get project tasks' });
  }
});

export default router;
