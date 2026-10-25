/**
 * Collaboration route endpoints
 *
 * Phase 0: /api/collaboration/:projectId/*  — Chat + Brief
 * Phase 1: /api/collaboration/:projectId/research/*  — (stub)
 * Phase 2: /api/collaboration/:projectId/verification/*  — (stub)
 * Phase 3: /api/collaboration/:projectId/analysis/*  — Strategic Analysis
 * Phase 4: /api/collaboration/:projectId/artifacts/*  — Artifact Generation
 */

import { Router } from 'express';
import { prepare } from '../db/index.js';
import {
  getChatHistory,
  sendChat,
  synthesizeBrief,
  approveBrief,
  getBrief,
  updateBrief,
} from '../services/collaboration.js';
import {
  createResearchProject,
  startResearchQueue,
  checkResearchEngineHealth,
  getResearchStatus,
  checkAndAdvanceStatus,
  rerunSingleProvider,
  stopResearch,
} from '../services/research.js';
import {
  checkVerifierHealth,
  startVerification,
  getVerificationStatus,
  saveVerificationReport,
  mapVerificationStatus,
} from '../services/verification.js';
import {
  startAnalysis,
  getAnalysisTaskStatus,
  getAnalysisResult,
  selectAndGenerateArtifacts,
  getArtifactContent,
  checkAndAdvanceArtifactStatus,
  generateSingleArtifact,
  stopArtifactGeneration,
  ARTIFACT_TYPES,
} from '../services/analysis.js';
import { existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'fs';
import { join, basename, resolve } from 'path';
import { validateBody, validateParams } from '../middleware/validate.js';
import {
  projectIdParamSchema,
  chatMessageSchema,
  selectArtifactsSchema,
  artifactTypeParamSchema,
  importDocumentSchema,
  rerunPhaseSchema,
  updateBriefSchema,
  rerunProviderSchema,
  stopResearchSchema,
  retryArtifactSchema,
} from '../middleware/schemas.js';
import { aiOperationLimiter } from '../middleware/rate-limit.js';
import { logEvent, EVENT_TYPES } from '../services/event-logger.js';

const router = Router();

// =============================================================================
// PHASE 0: RESEARCH COLLABORATION
// =============================================================================

/**
 * GET /api/collaboration/:projectId/history
 * Get conversation history.
 */
router.get('/:projectId/history', validateParams(projectIdParamSchema), (req, res) => {
  try {
    const { projectId } = req.params;
    const messages = getChatHistory(projectId);
    res.json({ messages });
  } catch (err) {
    console.error('[collaboration] History error:', err);
    res.status(500).json({ error: 'Failed to get chat history' });
  }
});

/**
 * POST /api/collaboration/:projectId/chat
 * Send a message and get AI response.
 */
router.post('/:projectId/chat', validateParams(projectIdParamSchema), validateBody(chatMessageSchema), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { message } = req.body;

    const project = prepare(
      'SELECT name FROM projects WHERE id = ?'
    ).get(projectId) as { name: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const result = await sendChat(projectId, project.name, message.trim());
    res.json(result);
  } catch (err) {
    console.error('[collaboration] Chat error:', err);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

/**
 * POST /api/collaboration/:projectId/synthesize
 * Generate Research Brief from conversation.
 */
router.post('/:projectId/synthesize', validateParams(projectIdParamSchema), aiOperationLimiter, async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = prepare(
      'SELECT name FROM projects WHERE id = ?'
    ).get(projectId) as { name: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Clear any previous error before starting
    prepare(`
      UPDATE projects SET error_message = NULL WHERE id = ?
    `).run(projectId);

    const result = await synthesizeBrief(projectId, project.name);
    res.json({ success: true, wordCount: result.wordCount });
  } catch (err: any) {
    console.error('[collaboration] Synthesize error:', err);

    // Store error in database
    const errorMessage = err.message || 'Failed to synthesize brief';
    prepare(`
      UPDATE projects SET status = 'brief_generation_failed', error_message = ?
      WHERE id = ?
    `).run(errorMessage, req.params.projectId);

    res.status(500).json({ error: errorMessage });
  }
});

// =============================================================================
// RESEARCH BRIEF
// =============================================================================

/**
 * GET /api/collaboration/:projectId/brief
 * Get Research Brief content.
 */
router.get('/:projectId/brief', validateParams(projectIdParamSchema), (req, res) => {
  try {
    const { projectId } = req.params;
    const brief = getBrief(projectId);

    if (!brief) {
      return res.status(404).json({ error: 'Research Brief not found' });
    }

    res.json(brief);
  } catch (err) {
    console.error('[collaboration] Get brief error:', err);
    res.status(500).json({ error: 'Failed to get brief' });
  }
});

/**
 * PUT /api/collaboration/:projectId/brief
 * Update the Research Brief content.
 */
router.put('/:projectId/brief', validateParams(projectIdParamSchema), validateBody(updateBriefSchema), (req, res) => {
  try {
    const { projectId } = req.params;
    const { content } = req.body;

    const project = prepare(
      'SELECT id FROM projects WHERE id = ?'
    ).get(projectId);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const result = updateBrief(projectId, content);
    res.json(result);
  } catch (err: any) {
    console.error('[collaboration] Update brief error:', err);
    res.status(500).json({ error: err.message || 'Failed to update brief' });
  }
});

/**
 * POST /api/collaboration/:projectId/brief/approve
 * Approve the Research Brief.
 */
router.post('/:projectId/brief/approve', validateParams(projectIdParamSchema), (req, res) => {
  try {
    const { projectId } = req.params;
    approveBrief(projectId);
    res.json({ success: true });
  } catch (err) {
    console.error('[collaboration] Approve brief error:', err);
    res.status(500).json({ error: 'Failed to approve brief' });
  }
});

// =============================================================================
// PHASE 1: DEEP RESEARCH (Stub)
// =============================================================================

router.post('/:projectId/research/start', validateParams(projectIdParamSchema), aiOperationLimiter, async (req, res) => {
  try {
    const { projectId } = req.params;

    // Verify project status
    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (project.status !== 'brief_approved') {
      return res.status(400).json({ error: `Cannot start research: status is ${project.status}, expected brief_approved` });
    }

    // Clear any previous error before starting
    prepare(`
      UPDATE projects SET error_message = NULL WHERE id = ?
    `).run(projectId);

    // Check research engine health
    const healthy = await checkResearchEngineHealth();
    if (!healthy) {
      return res.status(503).json({ error: 'Research engine is not available. Ensure it is running on port 4456.' });
    }

    // Create project in research engine and start queue
    const researcherProjectId = await createResearchProject(projectId);
    await startResearchQueue();

    // Update status to researching
    prepare(`
      UPDATE projects SET status = 'researching' WHERE id = ?
    `).run(projectId);

    res.json({ success: true, researcherProjectId });
  } catch (err: any) {
    console.error('[research] Start error:', err);

    // Store error in database
    const errorMessage = err.message || 'Failed to start research';
    prepare(`
      UPDATE projects SET status = 'research_failed', error_message = ?
      WHERE id = ?
    `).run(errorMessage, req.params.projectId);

    res.status(500).json({ error: errorMessage });
  }
});

router.get('/:projectId/research/status', validateParams(projectIdParamSchema), async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = prepare(
      'SELECT researcher_project_id as researcherProjectId FROM projects WHERE id = ?'
    ).get(projectId) as { researcherProjectId: number | null } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.researcherProjectId) {
      return res.json({
        kimi: { status: 'pending', wordCount: null, startedAt: null, completedAt: null, content: null },
        gemini: { status: 'pending', wordCount: null, startedAt: null, completedAt: null, content: null },
        edr: { status: 'pending', wordCount: null, startedAt: null, completedAt: null, content: null },
      });
    }

    const research = await getResearchStatus(projectId, project.researcherProjectId);
    checkAndAdvanceStatus(projectId, research);

    res.json(research);
  } catch (err: any) {
    console.error('[research] Status error:', err);
    res.status(500).json({ error: err.message || 'Failed to get research status' });
  }
});

// =============================================================================
// PHASE 2: VERIFICATION (Stub)
// =============================================================================

router.post('/:projectId/verification/start', validateParams(projectIdParamSchema), aiOperationLimiter, async (req, res) => {
  try {
    const { projectId } = req.params;

    // Verify project status
    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (project.status !== 'research_complete') {
      return res.status(400).json({ error: `Cannot start verification: status is ${project.status}, expected research_complete` });
    }

    // Clear any previous error before starting
    prepare(`
      UPDATE projects SET error_message = NULL WHERE id = ?
    `).run(projectId);

    // Check verifier health
    const healthy = await checkVerifierHealth();
    if (!healthy) {
      return res.status(503).json({ error: 'Citation verifier is not available. Ensure it is running on port 9002.' });
    }

    // Start verification pipeline
    const taskId = await startVerification(projectId);

    // Store task ID and update status
    prepare(`
      UPDATE projects SET verifier_task_id = ?, status = 'verifying' WHERE id = ?
    `).run(taskId, projectId);

    console.log(`[verification] Started for project ${projectId}, task ${taskId}`);
    res.json({ success: true, taskId });
  } catch (err: any) {
    console.error('[verification] Start error:', err);

    // Store error in database
    const errorMessage = err.message || 'Failed to start verification';
    prepare(`
      UPDATE projects SET status = 'verification_failed', error_message = ?
      WHERE id = ?
    `).run(errorMessage, req.params.projectId);

    res.status(500).json({ error: errorMessage });
  }
});

router.get('/:projectId/verification/status', validateParams(projectIdParamSchema), async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = prepare(
      'SELECT verifier_task_id as verifierTaskId, status FROM projects WHERE id = ?'
    ).get(projectId) as { verifierTaskId: string | null; status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (!project.verifierTaskId) {
      return res.json({
        completed: false,
        status: 'pending',
        progress: 0,
        currentStep: null,
        claimCount: null,
        issueRate: null,
        gateStatus: null,
        error: null,
      });
    }

    const taskState = await getVerificationStatus(project.verifierTaskId);
    const mapped = mapVerificationStatus(taskState);

    // If failed, set verification_failed status
    if (mapped.status === 'failed' && project.status === 'verifying') {
      const errorMessage = mapped.error || 'Verification pipeline failed';
      prepare(`
        UPDATE projects SET status = 'verification_failed', error_message = ?
        WHERE id = ?
      `).run(errorMessage, projectId);
      console.error(`[verification] Project ${projectId} failed: ${errorMessage}`);
    }

    // If completed and not yet advanced, save report and advance status
    if (mapped.completed && project.status === 'verifying') {
      // Read the verification report from the verifier's output path
      if (mapped.reportPath) {
        try {
          const { readFileSync } = await import('fs');
          const reportContent = readFileSync(mapped.reportPath, 'utf-8');
          await saveVerificationReport(projectId, reportContent);
        } catch (err) {
          console.error('[verification] Failed to copy report:', err);
        }
      }

      prepare(`
        UPDATE projects SET status = 'verification_complete', error_message = NULL WHERE id = ?
      `).run(projectId);
      console.log(`[verification] Project ${projectId} advanced to verification_complete`);
    }

    res.json(mapped);
  } catch (err: any) {
    console.error('[verification] Status error:', err);
    res.status(500).json({ error: err.message || 'Failed to get verification status' });
  }
});

// =============================================================================
// PHASE 3: STRATEGIC ANALYSIS
// =============================================================================

router.post('/:projectId/analysis/start', validateParams(projectIdParamSchema), aiOperationLimiter, (req, res) => {
  try {
    const { projectId } = req.params;

    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (project.status !== 'verification_complete') {
      return res.status(400).json({
        error: `Cannot start analysis: status is ${project.status}, expected verification_complete`,
      });
    }

    // Update status to analyzing
    prepare(`
      UPDATE projects SET status = 'analyzing' WHERE id = ?
    `).run(projectId);

    // Fire-and-forget
    startAnalysis(projectId);

    res.json({ success: true });
  } catch (err: any) {
    console.error('[analysis] Start error:', err);
    res.status(500).json({ error: err.message || 'Failed to start analysis' });
  }
});

router.get('/:projectId/analysis/status', validateParams(projectIdParamSchema), (req, res) => {
  try {
    const { projectId } = req.params;

    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const task = getAnalysisTaskStatus(projectId);
    const dbComplete = ['analysis_complete', 'generating_artifacts', 'complete'].includes(project.status);

    res.json({
      status: dbComplete ? 'complete' : (task?.status || 'pending'),
      completed: dbComplete || task?.status === 'complete',
      error: task?.error || null,
    });
  } catch (err: any) {
    console.error('[analysis] Status error:', err);
    res.status(500).json({ error: err.message || 'Failed to get analysis status' });
  }
});

router.get('/:projectId/analysis/result', validateParams(projectIdParamSchema), (req, res) => {
  try {
    const { projectId } = req.params;
    const result = getAnalysisResult(projectId);

    if (!result) {
      return res.status(404).json({ error: 'Analysis result not found' });
    }

    res.json(result);
  } catch (err: any) {
    console.error('[analysis] Result error:', err);
    res.status(500).json({ error: err.message || 'Failed to get analysis result' });
  }
});

// =============================================================================
// PHASE 4: ARTIFACT GENERATION
// =============================================================================

router.post('/:projectId/artifacts/select', validateParams(projectIdParamSchema), validateBody(selectArtifactsSchema), aiOperationLimiter, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { types } = req.body;

    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (project.status !== 'analysis_complete' && project.status !== 'complete') {
      return res.status(400).json({
        error: `Cannot generate artifacts: status is ${project.status}, expected analysis_complete or complete`,
      });
    }

    // When adding more artifacts to a completed project, set status back to generating
    if (project.status === 'complete') {
      prepare(`UPDATE projects SET status = 'generating_artifacts' WHERE id = ?`).run(projectId);
    }

    await selectAndGenerateArtifacts(projectId, types);

    res.json({ success: true, types });
  } catch (err: any) {
    console.error('[artifacts] Select error:', err);
    res.status(500).json({ error: err.message || 'Failed to start artifact generation' });
  }
});

router.get('/:projectId/artifacts/status', validateParams(projectIdParamSchema), (req, res) => {
  try {
    const { projectId } = req.params;

    // Check and auto-advance if all done
    checkAndAdvanceArtifactStatus(projectId);

    const artifacts = prepare(`
      SELECT
        id,
        project_id as projectId,
        artifact_type as artifactType,
        label,
        status,
        output_path as outputPath,
        created_at as createdAt,
        completed_at as completedAt
      FROM selected_artifacts
      WHERE project_id = ?
      ORDER BY created_at
    `).all(projectId);

    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    res.json({ artifacts, projectStatus: project?.status || null });
  } catch (err: any) {
    console.error('[artifacts] Status error:', err);
    res.status(500).json({ error: err.message || 'Failed to get artifact status' });
  }
});

router.get('/:projectId/artifacts/:type', validateParams(artifactTypeParamSchema), (req, res) => {
  try {
    const { projectId, type } = req.params;

    const result = getArtifactContent(projectId, type);

    if (!result) {
      return res.status(404).json({ error: 'Artifact not found' });
    }

    res.json(result);
  } catch (err: any) {
    console.error('[artifacts] Get error:', err);
    res.status(500).json({ error: err.message || 'Failed to get artifact content' });
  }
});

// =============================================================================
// IMPORT DOCUMENT (Skip phases by importing external documents)
// =============================================================================

/**
 * POST /api/collaboration/:projectId/import-document
 * Import external documents to skip earlier phases.
 */
router.post('/:projectId/import-document', validateParams(projectIdParamSchema), validateBody(importDocumentSchema), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { phase, files } = req.body;

    const project = prepare(
      'SELECT id, status, root_path as rootPath FROM projects WHERE id = ?'
    ).get(projectId) as { id: string; status: string; rootPath: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Status guards per phase
    const allowedStatuses: Record<string, string[]> = {
      collaboration: ['not_started', 'collaborating', 'brief_generated'],
      research: ['brief_approved'],
      verification: ['research_complete'],
      analysis: ['verification_complete'],
    };

    if (!allowedStatuses[phase]?.includes(project.status)) {
      return res.status(400).json({
        error: `Cannot import to ${phase}: project status is ${project.status}`,
      });
    }

    const rootPath = project.rootPath;

    if (phase === 'collaboration') {
      // Save as research-brief.md
      const collabDir = join(rootPath, 'collaboration');
      if (!existsSync(collabDir)) mkdirSync(collabDir, { recursive: true });

      const briefPath = join(collabDir, 'research-brief.md');
      writeFileSync(briefPath, files[0].content, 'utf-8');

      // Update DB
      prepare(`
        UPDATE projects SET research_brief_path = ?, status = 'brief_approved', error_message = NULL WHERE id = ?
      `).run(briefPath, projectId);

      // Insert research_briefs row
      const { v4: uuidv4 } = await import('uuid');
      const existing = prepare('SELECT id FROM research_briefs WHERE project_id = ?').get(projectId);
      if (!existing) {
        prepare(`
          INSERT INTO research_briefs (id, project_id, file_path, status, approved_at)
          VALUES (?, ?, ?, 'approved', datetime('now'))
        `).run(uuidv4(), projectId, briefPath);
      } else {
        prepare(`
          UPDATE research_briefs SET file_path = ?, status = 'approved', approved_at = datetime('now')
          WHERE project_id = ?
        `).run(briefPath, projectId);
      }

      console.log(`[import] Imported brief for project ${projectId}`);

    } else if (phase === 'research') {
      // Save each file to research directory
      const researchDir = join(rootPath, 'research');
      if (!existsSync(researchDir)) mkdirSync(researchDir, { recursive: true });

      const resolvedResearchDir = resolve(researchDir);
      for (const file of files) {
        // Sanitize: strip directory components, allow only safe characters
        const stripped = basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
        if (!stripped || stripped === '.' || stripped === '..') {
          return res.status(400).json({ error: `Invalid filename: ${file.name}` });
        }
        const safeName = stripped.endsWith('.md') ? stripped : `${stripped}.md`;
        const filePath = resolve(researchDir, safeName);

        // Verify resolved path stays within research directory
        if (!filePath.startsWith(resolvedResearchDir + '/')) {
          return res.status(400).json({ error: `Invalid filename: ${file.name}` });
        }

        writeFileSync(filePath, file.content, 'utf-8');
      }

      prepare(`
        UPDATE projects SET status = 'research_complete', error_message = NULL WHERE id = ?
      `).run(projectId);

      console.log(`[import] Imported ${files.length} research file(s) for project ${projectId}`);

    } else if (phase === 'verification') {
      // Save as verification_report.md
      const verificationDir = join(rootPath, 'verification');
      if (!existsSync(verificationDir)) mkdirSync(verificationDir, { recursive: true });

      writeFileSync(join(verificationDir, 'verification_report.md'), files[0].content, 'utf-8');

      prepare(`
        UPDATE projects SET status = 'verification_complete', error_message = NULL WHERE id = ?
      `).run(projectId);

      console.log(`[import] Imported verification report for project ${projectId}`);

    } else if (phase === 'analysis') {
      // Save as strategic_assessment.md
      const analysisDir = join(rootPath, 'analysis');
      if (!existsSync(analysisDir)) mkdirSync(analysisDir, { recursive: true });

      writeFileSync(join(analysisDir, 'strategic_assessment.md'), files[0].content, 'utf-8');

      prepare(`
        UPDATE projects SET status = 'analysis_complete', error_message = NULL WHERE id = ?
      `).run(projectId);

      console.log(`[import] Imported strategic assessment for project ${projectId}`);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('[import] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to import document' });
  }
});

// =============================================================================
// RE-RUN PHASE (Reset status and clear downstream outputs)
// =============================================================================

/**
 * POST /api/collaboration/:projectId/rerun
 * Re-run a completed phase by resetting status and clearing downstream.
 */
router.post('/:projectId/rerun', validateParams(projectIdParamSchema), validateBody(rerunPhaseSchema), (req, res) => {
  try {
    const { projectId } = req.params;
    const { phase } = req.body;

    const project = prepare(
      'SELECT id, status, root_path as rootPath FROM projects WHERE id = ?'
    ).get(projectId) as { id: string; status: string; rootPath: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Status ordering for guard checks
    const statusOrder = [
      'not_started', 'collaborating', 'brief_generated', 'brief_generation_failed',
      'brief_approved', 'researching', 'research_failed', 'research_complete',
      'verifying', 'verification_failed', 'verification_complete',
      'analyzing', 'analysis_failed', 'analysis_complete',
      'generating_artifacts', 'artifacts_failed', 'complete',
    ];
    const currentIdx = statusOrder.indexOf(project.status);

    // Guard: phase must have been completed at some point
    const phaseCompletionIdx: Record<string, number> = {
      collaboration: statusOrder.indexOf('brief_approved'),
      research: statusOrder.indexOf('research_complete'),
      verification: statusOrder.indexOf('verification_complete'),
      analysis: statusOrder.indexOf('analysis_complete'),
      artifacts: statusOrder.indexOf('complete'),
    };

    // Also accept failed statuses and reset-to statuses (from recovery or prior re-run)
    const phaseAllowedStatuses: Record<string, string[]> = {
      collaboration: ['brief_approved', 'brief_generation_failed'],
      research: ['research_complete', 'research_failed', 'brief_approved'],
      verification: ['verification_complete', 'verification_failed', 'research_complete'],
      analysis: ['analysis_complete', 'analysis_failed', 'verification_complete'],
      artifacts: ['complete', 'artifacts_failed', 'analysis_complete'],
    };

    const allowed = phaseAllowedStatuses[phase] || [];
    if (currentIdx < phaseCompletionIdx[phase] && !allowed.includes(project.status)) {
      return res.status(400).json({
        error: `Cannot re-run ${phase}: project has not completed this phase (status: ${project.status})`,
      });
    }

    const rootPath = project.rootPath;

    // Helper to safely remove a directory
    const safeRmDir = (dir: string) => {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
      }
    };

    // Helper to clean artifacts dir: delete only *.md files, preserve exports/ and other dirs
    const cleanArtifactsMd = (dir: string) => {
      if (existsSync(dir)) {
        for (const f of readdirSync(dir)) {
          if (f.endsWith('.md')) {
            rmSync(join(dir, f), { force: true });
          }
        }
      }
    };

    // Reset logic per phase
    if (phase === 'collaboration') {
      // Clear brief + all downstream
      safeRmDir(join(rootPath, 'collaboration'));
      mkdirSync(join(rootPath, 'collaboration'), { recursive: true });
      safeRmDir(join(rootPath, 'research'));
      mkdirSync(join(rootPath, 'research'), { recursive: true });
      safeRmDir(join(rootPath, 'verification'));
      mkdirSync(join(rootPath, 'verification'), { recursive: true });
      safeRmDir(join(rootPath, 'analysis'));
      mkdirSync(join(rootPath, 'analysis'), { recursive: true });
      cleanArtifactsMd(join(rootPath, 'artifacts'));

      prepare('DELETE FROM research_briefs WHERE project_id = ?').run(projectId);
      prepare('DELETE FROM selected_artifacts WHERE project_id = ?').run(projectId);
      prepare(`
        UPDATE projects SET status = 'not_started', research_brief_path = NULL,
          researcher_project_id = NULL, verifier_task_id = NULL, error_message = NULL
        WHERE id = ?
      `).run(projectId);

    } else if (phase === 'research') {
      safeRmDir(join(rootPath, 'research'));
      mkdirSync(join(rootPath, 'research'), { recursive: true });
      safeRmDir(join(rootPath, 'verification'));
      mkdirSync(join(rootPath, 'verification'), { recursive: true });
      safeRmDir(join(rootPath, 'analysis'));
      mkdirSync(join(rootPath, 'analysis'), { recursive: true });
      cleanArtifactsMd(join(rootPath, 'artifacts'));

      prepare('DELETE FROM selected_artifacts WHERE project_id = ?').run(projectId);
      prepare(`
        UPDATE projects SET status = 'brief_approved',
          researcher_project_id = NULL, verifier_task_id = NULL, error_message = NULL
        WHERE id = ?
      `).run(projectId);

    } else if (phase === 'verification') {
      safeRmDir(join(rootPath, 'verification'));
      mkdirSync(join(rootPath, 'verification'), { recursive: true });
      safeRmDir(join(rootPath, 'analysis'));
      mkdirSync(join(rootPath, 'analysis'), { recursive: true });
      cleanArtifactsMd(join(rootPath, 'artifacts'));

      prepare('DELETE FROM selected_artifacts WHERE project_id = ?').run(projectId);
      prepare(`
        UPDATE projects SET status = 'research_complete',
          verifier_task_id = NULL, error_message = NULL
        WHERE id = ?
      `).run(projectId);

    } else if (phase === 'analysis') {
      safeRmDir(join(rootPath, 'analysis'));
      mkdirSync(join(rootPath, 'analysis'), { recursive: true });
      cleanArtifactsMd(join(rootPath, 'artifacts'));

      prepare('DELETE FROM selected_artifacts WHERE project_id = ?').run(projectId);
      prepare(`
        UPDATE projects SET status = 'verification_complete', error_message = NULL
        WHERE id = ?
      `).run(projectId);

    } else if (phase === 'artifacts') {
      cleanArtifactsMd(join(rootPath, 'artifacts'));

      prepare('DELETE FROM selected_artifacts WHERE project_id = ?').run(projectId);
      prepare(`
        UPDATE projects SET status = 'analysis_complete', error_message = NULL
        WHERE id = ?
      `).run(projectId);
    }

    console.log(`[rerun] Reset project ${projectId} to re-run ${phase}`);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[rerun] Error:', err);
    res.status(500).json({ error: err.message || 'Failed to re-run phase' });
  }
});

// =============================================================================
// RETRY ENDPOINTS (Sprint 0 — Error Handling & Resilience)
// =============================================================================

/**
 * POST /api/collaboration/:projectId/retry-synthesis
 * Retry brief synthesis after brief_generation_failed.
 */
router.post('/:projectId/retry-synthesis', validateParams(projectIdParamSchema), aiOperationLimiter, async (req, res) => {
  try {
    const { projectId } = req.params;
    try { logEvent(EVENT_TYPES.provider_retry, projectId, { phase: 'synthesis' }); } catch {}

    const project = prepare(
      'SELECT name, status FROM projects WHERE id = ?'
    ).get(projectId) as { name: string; status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.status !== 'brief_generation_failed') {
      return res.status(400).json({
        error: `Cannot retry synthesis: status is ${project.status}, expected brief_generation_failed`,
      });
    }

    // Reset status to collaborating and clear error
    prepare(`
      UPDATE projects SET status = 'collaborating', error_message = NULL
      WHERE id = ?
    `).run(projectId);

    // Re-trigger synthesis
    const result = await synthesizeBrief(projectId, project.name);

    res.json({ success: true, wordCount: result.wordCount });
  } catch (err: any) {
    console.error('[collaboration] Retry synthesis error:', err);
    const errorMessage = err.message || 'Failed to retry brief synthesis';
    prepare(`
      UPDATE projects SET status = 'brief_generation_failed', error_message = ?
      WHERE id = ?
    `).run(errorMessage, req.params.projectId);
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * POST /api/projects/:projectId/retry-research
 * Retry research after research_failed.
 */
router.post('/:projectId/retry-research', validateParams(projectIdParamSchema), aiOperationLimiter, async (req, res) => {
  try {
    const { projectId } = req.params;
    try { logEvent(EVENT_TYPES.provider_retry, projectId, { phase: 'research' }); } catch {}

    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.status !== 'research_failed' && project.status !== 'researching') {
      return res.status(400).json({
        error: `Cannot retry research: status is ${project.status}, expected research_failed or researching`,
      });
    }

    // Check research engine health
    const healthy = await checkResearchEngineHealth();
    if (!healthy) {
      return res.status(503).json({ error: 'Research engine is not available. Ensure it is running on port 4456.' });
    }

    // Reset status to brief_approved and clear error
    prepare(`
      UPDATE projects SET status = 'brief_approved', error_message = NULL
      WHERE id = ?
    `).run(projectId);

    // Re-trigger research
    const researcherProjectId = await createResearchProject(projectId);
    await startResearchQueue();

    prepare(`
      UPDATE projects SET status = 'researching' WHERE id = ?
    `).run(projectId);

    res.json({ success: true, researcherProjectId });
  } catch (err: any) {
    console.error('[research] Retry error:', err);
    const errorMessage = err.message || 'Failed to retry research';
    prepare(`
      UPDATE projects SET status = 'research_failed', error_message = ?
      WHERE id = ?
    `).run(errorMessage, req.params.projectId);
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * POST /api/projects/:projectId/retry-verification
 * Retry verification after verification_failed.
 */
router.post('/:projectId/retry-verification', validateParams(projectIdParamSchema), aiOperationLimiter, async (req, res) => {
  try {
    const { projectId } = req.params;
    try { logEvent(EVENT_TYPES.provider_retry, projectId, { phase: 'verification' }); } catch {}

    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.status !== 'verification_failed' && project.status !== 'verifying') {
      return res.status(400).json({
        error: `Cannot retry verification: status is ${project.status}, expected verification_failed or verifying`,
      });
    }

    // Check verifier health
    const healthy = await checkVerifierHealth();
    if (!healthy) {
      return res.status(503).json({ error: 'Citation verifier is not available. Ensure it is running on port 9002.' });
    }

    // Reset status to research_complete and clear error
    prepare(`
      UPDATE projects SET status = 'research_complete', error_message = NULL
      WHERE id = ?
    `).run(projectId);

    // Re-trigger verification
    const taskId = await startVerification(projectId);

    prepare(`
      UPDATE projects SET verifier_task_id = ?, status = 'verifying' WHERE id = ?
    `).run(taskId, projectId);

    res.json({ success: true, taskId });
  } catch (err: any) {
    console.error('[verification] Retry error:', err);
    const errorMessage = err.message || 'Failed to retry verification';
    prepare(`
      UPDATE projects SET status = 'verification_failed', error_message = ?
      WHERE id = ?
    `).run(errorMessage, req.params.projectId);
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * POST /api/projects/:projectId/retry-analysis
 * Retry analysis after analysis_failed.
 */
router.post('/:projectId/retry-analysis', validateParams(projectIdParamSchema), aiOperationLimiter, (req, res) => {
  try {
    const { projectId } = req.params;
    try { logEvent(EVENT_TYPES.provider_retry, projectId, { phase: 'analysis' }); } catch {}

    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.status !== 'analysis_failed' && project.status !== 'analyzing') {
      return res.status(400).json({
        error: `Cannot retry analysis: status is ${project.status}, expected analysis_failed or analyzing`,
      });
    }

    // Reset status to verification_complete and clear error
    prepare(`
      UPDATE projects SET status = 'verification_complete', error_message = NULL
      WHERE id = ?
    `).run(projectId);

    // Update to analyzing
    prepare(`
      UPDATE projects SET status = 'analyzing' WHERE id = ?
    `).run(projectId);

    // Re-trigger analysis (fire-and-forget)
    startAnalysis(projectId);

    res.json({ success: true });
  } catch (err: any) {
    console.error('[analysis] Retry error:', err);
    const errorMessage = err.message || 'Failed to retry analysis';
    prepare(`
      UPDATE projects SET status = 'analysis_failed', error_message = ?
      WHERE id = ?
    `).run(errorMessage, req.params.projectId);
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * POST /api/projects/:projectId/retry-artifacts
 * Retry failed artifacts after artifacts_failed.
 */
router.post('/:projectId/retry-artifacts', validateParams(projectIdParamSchema), aiOperationLimiter, async (req, res) => {
  try {
    const { projectId } = req.params;
    try { logEvent(EVENT_TYPES.provider_retry, projectId, { phase: 'artifacts' }); } catch {}

    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.status !== 'artifacts_failed' && project.status !== 'generating_artifacts') {
      return res.status(400).json({
        error: `Cannot retry artifacts: status is ${project.status}, expected artifacts_failed or generating_artifacts`,
      });
    }

    // Get failed artifacts
    const failedArtifacts = prepare(`
      SELECT artifact_type FROM selected_artifacts
      WHERE project_id = ? AND status = 'failed'
    `).all(projectId) as { artifact_type: string }[];

    if (failedArtifacts.length === 0) {
      return res.status(400).json({ error: 'No failed artifacts to retry' });
    }

    // Reset failed artifacts to pending and clear their errors
    prepare(`
      UPDATE selected_artifacts
      SET status = 'generating', last_error = NULL
      WHERE project_id = ? AND status = 'failed'
    `).run(projectId);

    // Update project status
    prepare(`
      UPDATE projects SET status = 'generating_artifacts', error_message = NULL
      WHERE id = ?
    `).run(projectId);

    // Re-trigger only failed artifacts
    const failedTypes = failedArtifacts.map(a => a.artifact_type);

    // Import generateSingleArtifact dynamically
    const { generateSingleArtifact } = await import('../services/analysis.js');

    Promise.allSettled(
      failedTypes.map(type => generateSingleArtifact(projectId, type))
    ).then(() => {
      checkAndAdvanceArtifactStatus(projectId);
    });

    res.json({ success: true, retriedArtifacts: failedTypes });
  } catch (err: any) {
    console.error('[artifacts] Retry error:', err);
    const errorMessage = err.message || 'Failed to retry artifacts';
    prepare(`
      UPDATE projects SET status = 'artifacts_failed', error_message = ?
      WHERE id = ?
    `).run(errorMessage, req.params.projectId);
    res.status(500).json({ error: errorMessage });
  }
});

// =============================================================================
// SINGLE ARTIFACT RETRY (Session 13)
// =============================================================================

/**
 * POST /api/projects/:projectId/retry-artifact
 * Retry a single failed artifact without affecting others.
 */
router.post('/:projectId/retry-artifact', validateParams(projectIdParamSchema), validateBody(retryArtifactSchema), aiOperationLimiter, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { artifactType } = req.body;
    try { logEvent(EVENT_TYPES.provider_retry, projectId, { phase: 'artifacts', artifactType }); } catch {}

    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Allow retry when artifacts_failed or complete (some may have failed)
    if (project.status !== 'artifacts_failed' && project.status !== 'complete' && project.status !== 'generating_artifacts') {
      return res.status(400).json({
        error: `Cannot retry artifact: project status is ${project.status}`,
      });
    }

    // Check that the artifact exists and is failed
    const artifact = prepare(
      'SELECT status FROM selected_artifacts WHERE project_id = ? AND artifact_type = ?'
    ).get(projectId, artifactType) as { status: string } | undefined;

    if (!artifact) {
      return res.status(404).json({ error: `Artifact ${artifactType} not found for this project` });
    }

    if (artifact.status !== 'failed') {
      return res.status(400).json({
        error: `Artifact ${artifactType} is not in failed state (current: ${artifact.status})`,
      });
    }

    // Reset the single artifact to generating
    prepare(`
      UPDATE selected_artifacts SET status = 'generating', last_error = NULL
      WHERE project_id = ? AND artifact_type = ?
    `).run(projectId, artifactType);

    // Set project to generating_artifacts if not already
    prepare(`
      UPDATE projects SET status = 'generating_artifacts', error_message = NULL
      WHERE id = ? AND status IN ('artifacts_failed', 'complete')
    `).run(projectId);

    // Fire-and-forget: generate the single artifact
    generateSingleArtifact(projectId, artifactType).then(() => {
      checkAndAdvanceArtifactStatus(projectId);
    }).catch(() => {
      checkAndAdvanceArtifactStatus(projectId);
    });

    res.json({ success: true, artifactType });
  } catch (err: any) {
    console.error('[artifacts] Retry single artifact error:', err);
    res.status(500).json({ error: err.message || 'Failed to retry artifact' });
  }
});

// =============================================================================
// STOP ARTIFACT GENERATION (Session 13)
// =============================================================================

/**
 * POST /api/projects/:projectId/stop-artifacts
 * Abort all in-flight artifact generation. Already-complete artifacts preserved.
 */
router.post('/:projectId/stop-artifacts', validateParams(projectIdParamSchema), (req, res) => {
  try {
    const { projectId } = req.params;

    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.status !== 'generating_artifacts') {
      return res.status(400).json({
        error: `Cannot stop artifacts: project status is ${project.status}, expected generating_artifacts`,
      });
    }

    stopArtifactGeneration(projectId);

    // Determine final status based on artifact states
    const artifacts = prepare(
      'SELECT status FROM selected_artifacts WHERE project_id = ?'
    ).all(projectId) as { status: string }[];

    const anyComplete = artifacts.some(a => a.status === 'complete');
    const newStatus = anyComplete ? 'artifacts_failed' : 'artifacts_failed';
    const errorMessage = 'Generation stopped by user';

    prepare(`
      UPDATE projects SET status = ?, error_message = ?
      WHERE id = ?
    `).run(newStatus, errorMessage, projectId);

    res.json({ success: true });
  } catch (err: any) {
    console.error('[artifacts] Stop error:', err);
    res.status(500).json({ error: err.message || 'Failed to stop artifact generation' });
  }
});

// =============================================================================
// PER-PROVIDER RE-RUN (Sprint 7 — Research Control)
// =============================================================================

/**
 * POST /api/collaboration/:projectId/rerun-provider
 * Re-run a single research provider.
 */
router.post('/:projectId/rerun-provider', validateParams(projectIdParamSchema), validateBody(rerunProviderSchema), aiOperationLimiter, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { provider } = req.body;

    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Allow re-run when research is complete or later (but not during active research)
    const allowedStatuses = [
      'research_complete', 'verifying', 'verification_complete', 'verification_failed',
      'analyzing', 'analysis_complete', 'analysis_failed',
      'generating_artifacts', 'artifacts_failed', 'complete',
    ];
    if (!allowedStatuses.includes(project.status)) {
      return res.status(400).json({
        error: `Cannot re-run provider: project status is ${project.status}`,
      });
    }

    // Check research engine health
    const healthy = await checkResearchEngineHealth();
    if (!healthy) {
      return res.status(503).json({ error: 'Research engine is not available. Ensure it is running on port 4456.' });
    }

    await rerunSingleProvider(projectId, provider);

    res.json({ success: true, provider });
  } catch (err: any) {
    console.error('[research] Rerun provider error:', err);
    res.status(500).json({ error: err.message || 'Failed to re-run provider' });
  }
});

// =============================================================================
// STOP RESEARCH (Sprint 7 — Research Control)
// =============================================================================

/**
 * POST /api/collaboration/:projectId/stop-research
 * Stop research providers (all or specific ones).
 */
router.post('/:projectId/stop-research', validateParams(projectIdParamSchema), validateBody(stopResearchSchema), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { providers } = req.body;

    const project = prepare(
      'SELECT status FROM projects WHERE id = ?'
    ).get(projectId) as { status: string } | undefined;

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.status !== 'researching') {
      return res.status(400).json({
        error: `Cannot stop research: project status is ${project.status}, expected researching`,
      });
    }

    const result = await stopResearch(projectId, providers);

    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[research] Stop error:', err);
    res.status(500).json({ error: err.message || 'Failed to stop research' });
  }
});

export default router;
