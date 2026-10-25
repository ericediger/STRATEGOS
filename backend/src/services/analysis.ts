/**
 * Analysis + Artifact Generation Service (Phases 3 & 4)
 *
 * Phase 3: Strategic Analysis — synthesizes all research inputs into a
 *          Unified Strategic Intelligence Assessment via Claude Opus 4.6.
 * Phase 4: Artifact Generation — generates selected deliverables (SWOT,
 *          PESTLE, Five Forces, etc.) concurrently via Claude Opus 4.6.
 *
 * Uses fire-and-forget with in-memory task tracking (same pattern as verification).
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { prepare } from '../db/index.js';
import { loadPrompt } from './prompt-loader.js';
import { parseBrief } from './research.js';
import { createTask as createPersistentTask, completeTask as completePersistentTask, failTask as failPersistentTask, getActiveTask as getActivePersistentTask } from './task-persistence.js';
import { logEvent, EVENT_TYPES } from './event-logger.js';
import { logLLMCall, extractAnthropicUsage } from './llm-logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_ROOT = process.env.PROJECTS_ROOT || join(__dirname, '../../projects');

/** Resolve the canonical project directory — prefers PROJECTS_ROOT/{id} over stored path (which may be stale from an old installation). */
function resolveProjectRoot(storedRoot: string, projectId: string): string {
  const canonical = join(PROJECTS_ROOT, projectId);
  if (existsSync(canonical)) {
    if (canonical !== storedRoot) {
      console.log(`[analysis] Path resolved: using canonical ${canonical} (stored: ${storedRoot})`);
    }
    return canonical;
  }
  return storedRoot; // Fall back to stored path
}

// Lazy init — dotenv hasn't loaded yet at import time
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ timeout: 15 * 60 * 1000 });
  }
  return _anthropic;
}

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI();
  }
  return _openai;
}

// =============================================================================
// IN-MEMORY TASK TRACKING
// =============================================================================

interface AnalysisTask {
  status: 'running' | 'complete' | 'failed';
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  updatedAt: number;
}

const analysisTasks = new Map<string, AnalysisTask>();

// TTL cleanup: remove completed/failed tasks older than 2 hours
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [taskId, task] of analysisTasks) {
    if ((task.status === 'complete' || task.status === 'failed') && task.updatedAt < cutoff) {
      analysisTasks.delete(taskId);
      console.log(`[analysis] TTL cleanup: removed task ${taskId}`);
    }
  }
}, 30 * 60 * 1000);

export function getAnalysisTaskStatus(projectId: string): AnalysisTask | null {
  return analysisTasks.get(projectId) || null;
}

// =============================================================================
// ARTIFACT ABORT CONTROLLERS (stop generation)
// =============================================================================

const artifactControllers = new Map<string, AbortController>();

/** Abort all in-flight artifact generation for a project. Already-complete artifacts are preserved. */
export function stopArtifactGeneration(projectId: string): void {
  const controller = artifactControllers.get(projectId);
  if (controller) {
    controller.abort();
    artifactControllers.delete(projectId);
    console.log(`[artifacts] Stopped generation for project ${projectId}`);
  }

  // Mark all still-generating artifacts as failed (already-complete preserved)
  prepare(`
    UPDATE selected_artifacts SET status = 'failed', last_error = 'Generation stopped by user'
    WHERE project_id = ? AND status = 'generating'
  `).run(projectId);
}

// =============================================================================
// ARTIFACT TYPE REGISTRY
// =============================================================================

export const ARTIFACT_TYPES: Record<string, { promptFile: string; label: string }> = {
  swot: { promptFile: 'artifact-swot.md', label: 'SWOT Analysis' },
  pestle: { promptFile: 'artifact-pestle.md', label: 'PESTLE Analysis' },
  'five-forces': { promptFile: 'artifact-five-forces.md', label: "Porter's Five Forces" },
  positioning: { promptFile: 'artifact-positioning.md', label: 'Competitive Positioning Matrix' },
  pricing: { promptFile: 'artifact-pricing.md', label: 'Pricing & Feature Comparison' },
  'executive-summary': { promptFile: 'artifact-executive-summary.md', label: 'Executive Summary' },
  'battle-card': { promptFile: 'artifact-battle-card.md', label: 'Battle Card' },
};

// =============================================================================
// PHASE 3: STRATEGIC ANALYSIS
// =============================================================================

/**
 * Fire-and-forget. Sets in-memory status to running, kicks off runAnalysis.
 */
export function startAnalysis(projectId: string): void {
  // Clear any previous error
  prepare(`
    UPDATE projects SET error_message = NULL WHERE id = ?
  `).run(projectId);

  analysisTasks.set(projectId, {
    status: 'running',
    error: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    updatedAt: Date.now(),
  });

  // Persist task record (side-effect, non-blocking)
  try { createPersistentTask(projectId, 'analysis'); } catch { /* persistence is best-effort */ }
  try { logEvent(EVENT_TYPES.phase_started, projectId, { phase: 'analysis' }); } catch { /* non-blocking */ }

  runAnalysis(projectId).catch((err) => {
    console.error(`[analysis] Failed for project ${projectId}:`, err);
    const errorMessage = (err as Error).message || 'Strategic analysis failed';

    analysisTasks.set(projectId, {
      status: 'failed',
      error: errorMessage,
      startedAt: analysisTasks.get(projectId)?.startedAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      updatedAt: Date.now(),
    });

    // Set failure status in DB
    prepare(`
      UPDATE projects SET status = 'analysis_failed', error_message = ?
      WHERE id = ? AND status = 'analyzing'
    `).run(errorMessage, projectId);

    // Persist failure (side-effect, non-blocking)
    try {
      const active = getActivePersistentTask(projectId, 'analysis');
      if (active) failPersistentTask(active.id, errorMessage);
    } catch { /* persistence is best-effort */ }
    try { logEvent(EVENT_TYPES.provider_failure, projectId, { provider: 'openai', phase: 'analysis', error: errorMessage?.slice(0, 500) }); } catch { /* non-blocking */ }
    try { logEvent(EVENT_TYPES.phase_failed, projectId, { phase: 'analysis', error: errorMessage }); } catch { /* non-blocking */ }
  });
}

/**
 * Run the strategic analysis: load all inputs, substitute template, call Claude.
 */
async function runAnalysis(projectId: string): Promise<void> {
  const project = prepare(
    'SELECT root_path as rootPath, research_brief_path as researchBriefPath FROM projects WHERE id = ?'
  ).get(projectId) as { rootPath: string; researchBriefPath: string } | undefined;

  if (!project) throw new Error('Project not found');

  // Resolve paths — fall back to canonical directory when stored path is stale
  const projectRoot = resolveProjectRoot(project.rootPath, projectId);
  const briefPath = existsSync(project.researchBriefPath)
    ? project.researchBriefPath
    : join(projectRoot, 'collaboration', 'research-brief.md');

  // Load all input documents
  const briefContent = readFileSync(briefPath, 'utf-8');
  const briefData = parseBrief(briefContent);

  const researchDir = join(projectRoot, 'research');

  // Dynamic scan: read all .md files in research directory
  const researchFiles = existsSync(researchDir) ? readdirSync(researchDir).filter(f => f.endsWith('.md')) : [];
  const researchDocuments = researchFiles.map(f => {
    const name = f.replace('.md', '');
    const content = safeReadFile(join(researchDir, f));
    return `## Research Document: ${name}\n\n${content}`;
  }).join('\n\n---\n\n');

  const verificationReport = safeReadFile(join(projectRoot, 'verification', 'verification_report.md'));

  // Build prompts
  const systemPrompt = loadPrompt('analysis-system.md');
  let userPrompt = loadPrompt('analysis-user.md');

  const today = new Date().toISOString().split('T')[0];

  userPrompt = userPrompt
    .replace(/\{\{RESEARCH_BRIEF\}\}/g, briefContent)
    .replace(/\{\{RESEARCH_DOCUMENTS\}\}/g, researchDocuments)
    .replace(/\{\{VERIFICATION_REPORT\}\}/g, verificationReport)
    .replace(/\{\{KEY_QUESTIONS\}\}/g, briefData.keyQuestions)
    .replace(/\{\{DECISION_CONTEXT\}\}/g, briefData.decisionContext)
    .replace(/\{\{PROJECT_TITLE\}\}/g, briefData.projectTitle)
    .replace(/\{\{DATE\}\}/g, today)
    .replace(/\{\{RESEARCH_TYPE\}\}/g, briefData.researchType);

  console.log(`[analysis] Calling GPT-5.2 (reasoning: high, streaming) for project ${projectId}...`);

  const analysisStart = Date.now();
  const stream = await getOpenAI().chat.completions.create({
    model: 'gpt-5.2',
    reasoning_effort: 'high',
    stream: true,
    stream_options: { include_usage: true },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const chunks: string[] = [];
  let streamUsage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) chunks.push(content);
    if (chunk.usage) streamUsage = chunk.usage;
  }
  const assessment = chunks.join('');
  const analysisDuration = Date.now() - analysisStart;

  try { logLLMCall({ project_id: projectId, phase: 'analysis', model: 'gpt-5.2', provider: 'openai', input_tokens: streamUsage?.prompt_tokens ?? null, output_tokens: streamUsage?.completion_tokens ?? null, duration_ms: analysisDuration }); } catch { /* non-blocking */ }

  // Save to filesystem
  const analysisDir = join(projectRoot, 'analysis');
  if (!existsSync(analysisDir)) {
    mkdirSync(analysisDir, { recursive: true });
  }
  const assessmentPath = join(analysisDir, 'strategic_assessment.md');
  writeFileSync(assessmentPath, assessment, 'utf-8');

  // Advance status and clear any error
  prepare(`
    UPDATE projects SET status = 'analysis_complete', error_message = NULL
    WHERE id = ? AND status = 'analyzing'
  `).run(projectId);

  // Update in-memory task
  analysisTasks.set(projectId, {
    status: 'complete',
    error: null,
    startedAt: analysisTasks.get(projectId)?.startedAt || new Date().toISOString(),
    completedAt: new Date().toISOString(),
    updatedAt: Date.now(),
  });

  // Persist completion (side-effect, non-blocking)
  try {
    const active = getActivePersistentTask(projectId, 'analysis');
    if (active) completePersistentTask(active.id);
  } catch { /* persistence is best-effort */ }

  const wordCount = assessment.split(/\s+/).filter(Boolean).length;
  console.log(`[analysis] Complete for project ${projectId}: ${wordCount} words`);
  try { logEvent(EVENT_TYPES.phase_completed, projectId, { phase: 'analysis', wordCount }); } catch { /* non-blocking */ }
}

/**
 * Read the strategic assessment from disk.
 */
export function getAnalysisResult(projectId: string): { content: string; wordCount: number } | null {
  const project = prepare(
    'SELECT root_path as rootPath FROM projects WHERE id = ?'
  ).get(projectId) as { rootPath: string } | undefined;

  if (!project) return null;

  const projectRoot = resolveProjectRoot(project.rootPath, projectId);
  const assessmentPath = join(projectRoot, 'analysis', 'strategic_assessment.md');
  if (!existsSync(assessmentPath)) return null;

  try {
    const content = readFileSync(assessmentPath, 'utf-8');
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    return { content, wordCount };
  } catch {
    return null;
  }
}

// =============================================================================
// PHASE 4: ARTIFACT GENERATION
// =============================================================================

/**
 * Insert selected_artifacts rows, update status, fire off concurrent generation.
 */
export async function selectAndGenerateArtifacts(
  projectId: string,
  types: string[],
): Promise<void> {
  const { v4: uuidv4 } = await import('uuid');

  // Clear project-level error
  prepare(`
    UPDATE projects SET error_message = NULL WHERE id = ?
  `).run(projectId);

  try { logEvent(EVENT_TYPES.artifact_selected, projectId, { selectedTypes: types }); } catch { /* non-blocking */ }

  // Insert rows for each selected type
  for (const type of types) {
    const artifactDef = ARTIFACT_TYPES[type];
    if (!artifactDef) continue;

    // Check if already exists
    const existing = prepare(
      'SELECT id FROM selected_artifacts WHERE project_id = ? AND artifact_type = ?'
    ).get(projectId, type);

    if (!existing) {
      prepare(`
        INSERT INTO selected_artifacts (id, project_id, artifact_type, label, status)
        VALUES (?, ?, ?, ?, 'generating')
      `).run(uuidv4(), projectId, type, artifactDef.label);
    }
  }

  // Update project status (accept both analysis_complete and generating_artifacts for add-more flow)
  prepare(`
    UPDATE projects SET status = 'generating_artifacts'
    WHERE id = ? AND status IN ('analysis_complete', 'generating_artifacts', 'complete')
  `).run(projectId);

  // Create AbortController for this generation run
  const controller = new AbortController();
  artifactControllers.set(projectId, controller);

  // Fire off concurrent generation (fire-and-forget)
  Promise.allSettled(
    types.map(type => generateSingleArtifact(projectId, type, controller.signal))
  ).then((results) => {
    // Check if ALL artifacts failed
    const allFailed = results.every(r => r.status === 'rejected');
    if (allFailed) {
      const errorMessage = 'All artifacts failed to generate';
      prepare(`
        UPDATE projects SET status = 'artifacts_failed', error_message = ?
        WHERE id = ? AND status = 'generating_artifacts'
      `).run(errorMessage, projectId);
      console.error(`[artifacts] ${errorMessage} for project ${projectId}`);
    } else {
      checkAndAdvanceArtifactStatus(projectId);
    }
  }).finally(() => {
    artifactControllers.delete(projectId);
  });
}

/**
 * Generate a single artifact: load prompt, split at marker, substitute, call Claude.
 * Exported for retry endpoint use.
 */
export async function generateSingleArtifact(projectId: string, type: string, signal?: AbortSignal): Promise<void> {
  const artifactDef = ARTIFACT_TYPES[type];
  if (!artifactDef) throw new Error(`Unknown artifact type: ${type}`);

  try {
    // Update status to generating
    prepare(`
      UPDATE selected_artifacts SET status = 'generating'
      WHERE project_id = ? AND artifact_type = ?
    `).run(projectId, type);

    const project = prepare(
      'SELECT root_path as rootPath, research_brief_path as researchBriefPath FROM projects WHERE id = ?'
    ).get(projectId) as { rootPath: string; researchBriefPath: string } | undefined;

    if (!project) throw new Error('Project not found');

    // Resolve paths — fall back to canonical directory when stored path is stale
    const projectRoot = resolveProjectRoot(project.rootPath, projectId);
    const briefPath = existsSync(project.researchBriefPath)
      ? project.researchBriefPath
      : join(projectRoot, 'collaboration', 'research-brief.md');

    // Load all context documents
    const briefContent = readFileSync(briefPath, 'utf-8');
    const briefData = parseBrief(briefContent);

    const researchDir = join(projectRoot, 'research');
    const researchFiles = existsSync(researchDir) ? readdirSync(researchDir).filter(f => f.endsWith('.md')) : [];
    const consolidatedResearch = researchFiles.map(f => {
      const name = f.replace('.md', '');
      return `## ${name} Research\n\n` + safeReadFile(join(researchDir, f));
    }).join('\n\n---\n\n');

    const verificationReport = safeReadFile(join(projectRoot, 'verification', 'verification_report.md'));
    const strategicAssessment = safeReadFile(join(projectRoot, 'analysis', 'strategic_assessment.md'));

    // Load and split prompt at "## User Prompt Template"
    const fullPrompt = loadPrompt(artifactDef.promptFile);
    const marker = '## User Prompt Template';
    const markerIndex = fullPrompt.indexOf(marker);

    let systemPrompt: string;
    let userTemplate: string;

    if (markerIndex >= 0) {
      systemPrompt = fullPrompt.slice(0, markerIndex).trim();
      userTemplate = fullPrompt.slice(markerIndex + marker.length).trim();
    } else {
      // Fallback: use entire prompt as system, build simple user prompt
      systemPrompt = fullPrompt;
      userTemplate = 'Generate the {{PROJECT_TITLE}} artifact based on the provided research and analysis.';
    }

    const today = new Date().toISOString().split('T')[0];

    // Substitute template variables
    userTemplate = userTemplate
      .replace(/\{\{PROJECT_TITLE\}\}/g, briefData.projectTitle)
      .replace(/\{\{DATE\}\}/g, today)
      .replace(/\{\{DECISION_CONTEXT\}\}/g, briefData.decisionContext)
      .replace(/\{\{RESEARCH_BRIEF\}\}/g, briefContent)
      .replace(/\{\{CONSOLIDATED_RESEARCH\}\}/g, consolidatedResearch)
      .replace(/\{\{VERIFICATION_REPORT\}\}/g, verificationReport)
      .replace(/\{\{STRATEGIC_ASSESSMENT\}\}/g, strategicAssessment);

    // Check if already aborted before making API call
    if (signal?.aborted) {
      throw new Error('Generation stopped by user');
    }

    console.log(`[artifacts] Generating ${type} for project ${projectId}...`);
    const artifactStartTime = Date.now();
    try { logEvent(EVENT_TYPES.artifact_generation_started, projectId, { artifactType: type }); } catch { /* non-blocking */ }

    const response = await getAnthropic().messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 16000,
      thinking: {
        type: 'adaptive',
      },
      system: systemPrompt,
      messages: [{ role: 'user', content: userTemplate }],
    }, { signal: signal as AbortSignal | undefined });
    const artifactCallDuration = Date.now() - artifactStartTime;

    try { logLLMCall({ project_id: projectId, phase: 'artifacts', model: 'claude-opus-4-6', provider: 'anthropic', ...extractAnthropicUsage(response), duration_ms: artifactCallDuration }); } catch { /* non-blocking */ }

    const content = response.content
      .filter(block => block.type === 'text')
      .map(block => block.type === 'text' ? block.text : '')
      .join('');

    // Don't save if aborted (no partial saves)
    if (signal?.aborted) {
      throw new Error('Generation stopped by user');
    }

    // Save to filesystem
    const artifactsDir = join(projectRoot, 'artifacts');
    if (!existsSync(artifactsDir)) {
      mkdirSync(artifactsDir, { recursive: true });
    }
    const outputPath = join(artifactsDir, `${type}.md`);
    writeFileSync(outputPath, content, 'utf-8');

    // Update DB row
    prepare(`
      UPDATE selected_artifacts
      SET status = 'complete', output_path = ?, completed_at = datetime('now')
      WHERE project_id = ? AND artifact_type = ?
    `).run(outputPath, projectId, type);

    const wordCount = content.split(/\s+/).filter(Boolean).length;
    console.log(`[artifacts] ${type} complete for project ${projectId}: ${wordCount} words`);
    try { logEvent(EVENT_TYPES.artifact_generation_completed, projectId, { artifactType: type, durationMs: Date.now() - artifactStartTime }); } catch { /* non-blocking */ }
  } catch (err) {
    console.error(`[artifacts] ${type} failed for project ${projectId}:`, err);
    const errorMessage = (err as Error).message || 'Artifact generation failed';
    prepare(`
      UPDATE selected_artifacts
      SET status = 'failed', last_error = ?
      WHERE project_id = ? AND artifact_type = ?
    `).run(errorMessage, projectId, type);
    try { logEvent(EVENT_TYPES.artifact_generation_failed, projectId, { artifactType: type, error: errorMessage }); } catch { /* non-blocking */ }
  }
}

/**
 * Read artifact content from disk.
 */
export function getArtifactContent(projectId: string, type: string): { content: string; wordCount: number } | null {
  const project = prepare(
    'SELECT root_path as rootPath FROM projects WHERE id = ?'
  ).get(projectId) as { rootPath: string } | undefined;

  if (!project) return null;

  const projectRoot = resolveProjectRoot(project.rootPath, projectId);
  const artifactPath = join(projectRoot, 'artifacts', `${type}.md`);
  if (!existsSync(artifactPath)) return null;

  try {
    const content = readFileSync(artifactPath, 'utf-8');
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    return { content, wordCount };
  } catch {
    return null;
  }
}

/**
 * Check if all selected artifacts are done. If so, advance status.
 * - If ALL failed → artifacts_failed
 * - If SOME failed → artifacts_failed (with partial completion)
 * - If ALL complete → complete
 */
export function checkAndAdvanceArtifactStatus(projectId: string): void {
  const artifacts = prepare(
    'SELECT status FROM selected_artifacts WHERE project_id = ?'
  ).all(projectId) as { status: string }[];

  if (artifacts.length === 0) return;

  const allDone = artifacts.every(a => a.status === 'complete' || a.status === 'failed');

  if (allDone) {
    const anyFailed = artifacts.some(a => a.status === 'failed');
    const allFailed = artifacts.every(a => a.status === 'failed');

    if (allFailed) {
      // Already handled in selectAndGenerateArtifacts, but ensure it's set
      const errorMessage = 'All artifacts failed to generate';
      prepare(`
        UPDATE projects SET status = 'artifacts_failed', error_message = ?
        WHERE id = ? AND status = 'generating_artifacts'
      `).run(errorMessage, projectId);
      console.error(`[artifacts] ${errorMessage} for project ${projectId}`);
    } else if (anyFailed) {
      // Some failed, some succeeded
      const failedCount = artifacts.filter(a => a.status === 'failed').length;
      const errorMessage = `${failedCount} of ${artifacts.length} artifacts failed to generate`;
      prepare(`
        UPDATE projects SET status = 'artifacts_failed', error_message = ?
        WHERE id = ? AND status = 'generating_artifacts'
      `).run(errorMessage, projectId);
      console.error(`[artifacts] ${errorMessage} for project ${projectId}`);
    } else {
      // All complete
      prepare(`
        UPDATE projects SET status = 'complete', error_message = NULL
        WHERE id = ? AND status = 'generating_artifacts'
      `).run(projectId);
      console.log(`[artifacts] Project ${projectId} → complete`);
    }
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function safeReadFile(filePath: string): string {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8');
    }
  } catch { /* ignore */ }
  return '[Document not available]';
}
