/**
 * Research Service — Proxy between STRATEGOS backend and research engine
 *
 * Handles:
 * - Parsing the approved Research Brief into template variables
 * - Building research prompts from templates
 * - Creating research projects in the research engine
 * - Polling status and saving completed results
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path, { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { prepare } from '../db/index.js';
import { loadPrompt } from './prompt-loader.js';
import { checkResearchEngineHealth as checkHealth } from './health.js';
import { createTask, completeTask, failTask, updateTaskProgress, getActiveTask } from './task-persistence.js';
import { logEvent, EVENT_TYPES, flushDedupSummary } from './event-logger.js';
import { logLLMCall, extractAnthropicUsage } from './llm-logger.js';
import { MODELS } from '../config/models.js';

// Lazy-init Anthropic client — dotenv hasn't loaded at import time
let _anthropic: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic();
  }
  return _anthropic;
}

/** Wrapper to avoid name collisions with checkAndAdvanceStatus */
function getActiveTaskForPersistence(projectId: string, phase: string) {
  try { return getActiveTask(projectId, phase); } catch { return null; }
}

const RESEARCH_ENGINE_URL = process.env.RESEARCH_ENGINE_URL || 'http://localhost:4456';

// =============================================================================
// BRIEF PARSING
// =============================================================================

interface BriefData {
  projectTitle: string;
  researchType: string;
  decisionContext: string;
  timeline: string;
  stakeholders: string;
  primaryTarget: string;
  focusAreas: string;
  competitiveSetTable: string;
  geographicScope: string;
  temporalScope: string;
  keyQuestions: string;
  exclusions: string;
}

/**
 * Parse a structured Research Brief markdown into template variables.
 * Extracts sections by heading patterns from the brief content.
 */
export function parseBrief(briefContent: string): BriefData {
  const extract = (pattern: RegExp, fallback = ''): string => {
    const match = briefContent.match(pattern);
    return match ? match[1].trim() : fallback;
  };

  // Extract between section headings
  const extractSection = (heading: string, nextHeadings: string[]): string => {
    // Build regex that matches the heading then captures until the next heading
    const nextPattern = nextHeadings.map(h => `(?:#{1,3}\\s*${h})`).join('|');
    const regex = new RegExp(
      `#{1,3}\\s*${heading}[^\\n]*\\n([\\s\\S]*?)(?=${nextPattern}|$)`,
      'i'
    );
    const match = briefContent.match(regex);
    return match ? match[1].trim() : '';
  };

  // Section headings from the standard Research Brief template (Sections 1-5)
  const sectionHeadings = [
    'Project Overview', 'Strategic Context', 'Primary Target',
    'Competitive Set', 'Geographic Scope', 'Temporal Scope',
    'Key Intelligence Questions', 'Exclusions', 'Research Scope',
    'Scope', 'Decision Context', 'Timeline', 'Stakeholders',
    'Focus Areas', 'Source Rules', 'Acceptance',
  ];

  // Try to extract the project title from the first heading or "Project:" line
  const projectTitle = extract(/^#\s+(.+)/m, '') ||
    extract(/\*?\*?Project\*?\*?[:\s]+(.+)/im, 'Research Project');

  const researchType = extract(/\*?\*?(?:Type|Research Type)\*?\*?[:\s]+(.+)/im, 'Competitive Intelligence');

  const decisionContext = extract(/\*?\*?Decision(?:\s+being\s+informed)?(?:\s+Context)?\*?\*?[:\s]+(.+)/im, '') ||
    extractSection('Decision Context', sectionHeadings) ||
    extractSection('Strategic Context', sectionHeadings);

  const timeline = extract(/\*?\*?Timeline\*?\*?[:\s]+(.+)/im, '');
  const stakeholders = extract(/\*?\*?Stakeholders?\*?\*?[:\s]+(.+)/im, '');

  const primaryTarget = extract(/\*?\*?(?:Entity|Primary Target|Target)\*?\*?[:\s]+(.+)/im, '');
  const focusAreas = extract(/\*?\*?Focus [Aa]reas?\*?\*?[:\s]+(.+)/im, '') ||
    extractSection('Focus Areas', sectionHeadings);

  const competitiveSetTable = extractSection('Competitive Set', sectionHeadings);
  const geographicScope = extractSection('Geographic Scope', sectionHeadings) ||
    extract(/\*?\*?Geographic Scope\*?\*?[:\s]+(.+)/im, '');
  const temporalScope = extractSection('Temporal Scope', sectionHeadings) ||
    extract(/\*?\*?Temporal Scope\*?\*?[:\s]+(.+)/im, '');

  const keyQuestions = extractSection('Key Intelligence Questions', sectionHeadings) ||
    extractSection('Key Questions', sectionHeadings);

  const exclusions = extractSection('Exclusions', sectionHeadings);

  return {
    projectTitle,
    researchType,
    decisionContext,
    timeline,
    stakeholders,
    primaryTarget,
    focusAreas,
    competitiveSetTable,
    geographicScope,
    temporalScope,
    keyQuestions,
    exclusions,
  };
}

// =============================================================================
// PROMPT BUILDING
// =============================================================================

/**
 * Build the system and user prompts for research.
 * Loads templates and replaces {{VAR}} placeholders.
 *
 * When mode === 'delta', loads research-delta.md instead of research-user.md
 * and substitutes {{REFERENCE_DATE}} with the provided referenceDate.
 * Default mode ('standard') preserves existing behavior.
 */
/**
 * Check if a parsed brief has enough populated fields to use the structured template.
 * Returns true if at least 3 substantive fields (beyond title/type) are non-empty.
 */
function isBriefWellParsed(briefData: BriefData): boolean {
  const substantiveFields = [
    briefData.decisionContext, briefData.timeline, briefData.stakeholders,
    briefData.primaryTarget, briefData.focusAreas, briefData.competitiveSetTable,
    briefData.geographicScope, briefData.temporalScope, briefData.keyQuestions,
    briefData.exclusions,
  ];
  return substantiveFields.filter(f => f.length > 0).length >= 3;
}

export function buildResearchPrompts(
  briefData: BriefData,
  mode: 'standard' | 'delta' = 'standard',
  referenceDate?: string,
  briefContent?: string,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = loadPrompt('research-system.md');
  const today = new Date().toISOString().split('T')[0];

  // If the brief didn't parse well into structured fields (free-form brief),
  // use the raw brief content directly instead of a mostly-empty template
  if (mode === 'standard' && briefContent && !isBriefWellParsed(briefData)) {
    console.log('[research] Brief does not match structured template — using raw brief as research assignment');
    const userPrompt = `# RESEARCH ASSIGNMENT

**Project:** ${briefData.projectTitle}
**Date Issued:** ${today}

---

## RESEARCH BRIEF

The following is the approved research brief. Execute this research assignment thoroughly.

${briefContent}

---

## RESEARCH DEPTH REMINDER

Your output will be consumed by a downstream analysis agent that synthesizes research from multiple providers into structured deliverables. That agent needs rich, comprehensive raw material to work with.

**Do not summarize. Do not compress. Do not write an executive brief.**

Write a thorough analyst report. Include specific numbers, dates, names, URLs, quotes, and evidence throughout. When you find something interesting, explore it. When sources conflict, present both sides with evidence. When you identify a gap, note what evidence would fill it.

The single most common failure mode is producing a thin, high-level summary instead of deep research. Resist this. Depth wins.

---

**BEGIN RESEARCH.**`;
    return { systemPrompt, userPrompt };
  }

  const templateFile = mode === 'delta' ? 'research-delta.md' : 'research-user.md';
  let userPrompt = loadPrompt(templateFile);

  userPrompt = userPrompt
    .replace(/\{\{PROJECT_TITLE\}\}/g, briefData.projectTitle)
    .replace(/\{\{RESEARCH_TYPE\}\}/g, briefData.researchType)
    .replace(/\{\{DATE\}\}/g, today)
    .replace(/\{\{DECISION_CONTEXT\}\}/g, briefData.decisionContext)
    .replace(/\{\{TIMELINE\}\}/g, briefData.timeline)
    .replace(/\{\{STAKEHOLDERS\}\}/g, briefData.stakeholders)
    .replace(/\{\{PRIMARY_TARGET\}\}/g, briefData.primaryTarget)
    .replace(/\{\{FOCUS_AREAS\}\}/g, briefData.focusAreas)
    .replace(/\{\{COMPETITIVE_SET_TABLE\}\}/g, briefData.competitiveSetTable)
    .replace(/\{\{COMPETITIVE_SET\}\}/g, briefData.competitiveSetTable)
    .replace(/\{\{GEOGRAPHIC_SCOPE\}\}/g, briefData.geographicScope)
    .replace(/\{\{TEMPORAL_SCOPE\}\}/g, briefData.temporalScope)
    .replace(/\{\{KEY_QUESTIONS\}\}/g, briefData.keyQuestions)
    .replace(/\{\{EXCLUSIONS\}\}/g, briefData.exclusions)
    .replace(/\{\{INDUSTRY\}\}/g, briefData.researchType);

  if (mode === 'delta') {
    if (referenceDate) {
      userPrompt = userPrompt.replace(/\{\{REFERENCE_DATE\}\}/g, referenceDate);
    }
    if (briefContent) {
      userPrompt = userPrompt.replace(/\{\{RESEARCH_BRIEF\}\}/g, briefContent);
    }
  }

  return { systemPrompt, userPrompt };
}

/**
 * Build a natural-language research query for Gemini Deep Research.
 * Unlike the structured system+user prompt pair used by Kimi, the Gemini
 * Deep Research agent works best with an open-ended query that specifies
 * breadth and depth constraints without prescribing output format.
 */
export function buildGeminiResearchQuery(briefData: BriefData, briefContent?: string): string {
  // If brief didn't parse well, use raw content as the query
  if (briefContent && !isBriefWellParsed(briefData)) {
    console.log('[research] Gemini query: using raw brief (structured parse insufficient)');
    return `Research the following thoroughly. Provide comprehensive, evidence-backed findings with specific data points, dates, and sources.\n\n${briefContent}`;
  }

  let query = loadPrompt('gemini-research.md');

  query = query
    .replace(/\{\{PRIMARY_TARGET\}\}/g, briefData.primaryTarget)
    .replace(/\{\{COMPETITIVE_SET\}\}/g, briefData.competitiveSetTable)
    .replace(/\{\{KEY_QUESTIONS\}\}/g, briefData.keyQuestions)
    .replace(/\{\{GEOGRAPHIC_SCOPE\}\}/g, briefData.geographicScope)
    .replace(/\{\{TIMEFRAME\}\}/g, briefData.temporalScope)
    .replace(/\{\{DECISION_CONTEXT\}\}/g, briefData.decisionContext)
    .replace(/\{\{FOCUS_AREAS\}\}/g, briefData.focusAreas);

  return query;
}

/**
 * Build the expansion prompt for the Gemini two-step chain.
 * Step 2 chains to Gemini 3 Pro via previous_interaction_id,
 * carrying full Deep Research context server-side.
 */
export function buildGeminiExpansionPrompt(briefData: BriefData, briefContent?: string): string {
  // If brief didn't parse well, use a generic expansion prompt
  if (briefContent && !isBriefWellParsed(briefData)) {
    return `Based on your research above, expand with additional depth and detail. Fill gaps, add more data points, and strengthen the evidence base. Focus on areas where the initial research was thin.`;
  }

  let prompt = loadPrompt('gemini-expansion.md');

  prompt = prompt
    .replace(/\{\{PRIMARY_TARGET\}\}/g, briefData.primaryTarget)
    .replace(/\{\{COMPETITIVE_SET\}\}/g, briefData.competitiveSetTable)
    .replace(/\{\{KEY_QUESTIONS\}\}/g, briefData.keyQuestions)
    .replace(/\{\{DECISION_CONTEXT\}\}/g, briefData.decisionContext);

  return prompt;
}

// =============================================================================
// RESEARCH ENGINE PROXY
// =============================================================================

/**
 * Create a research project in the research engine.
 * Reads the approved brief, parses it, builds prompts, and POSTs to the engine.
 * Returns the researcher_project_id.
 */
export async function createResearchProject(projectId: string): Promise<number> {
  const project = prepare(`
    SELECT name, research_brief_path, root_path
    FROM projects WHERE id = ?
  `).get(projectId) as { name: string; research_brief_path: string; root_path: string } | undefined;

  if (!project) throw new Error('Project not found');
  if (!project.research_brief_path) throw new Error('No approved brief found');

  // Resolve brief path: try stored path first, fall back to canonical location
  let briefPath = project.research_brief_path;
  if (!existsSync(briefPath)) {
    const projectsRoot = process.env.PROJECTS_ROOT;
    if (projectsRoot) {
      briefPath = join(projectsRoot, projectId, 'collaboration', 'research-brief.md');
    }
  }
  const briefContent = readFileSync(briefPath, 'utf-8');
  const briefData = parseBrief(briefContent);

  // Use project name as title if parser didn't find one
  if (!briefData.projectTitle || briefData.projectTitle === 'Research Project') {
    briefData.projectTitle = project.name;
  }

  const { systemPrompt, userPrompt } = buildResearchPrompts(briefData, 'standard', undefined, briefContent);
  const geminiQuery = buildGeminiResearchQuery(briefData, briefContent);
  const geminiExpansionPrompt = buildGeminiExpansionPrompt(briefData, briefContent);

  // Create project in research engine with 1 topic (the full research assignment)
  const response = await fetch(`${RESEARCH_ENGINE_URL}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: project.name,
      system_prompt: systemPrompt,
      gemini_query: geminiQuery,
      gemini_expansion_prompt: geminiExpansionPrompt,
      topics: [
        {
          title: briefData.projectTitle,
          context: userPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Research engine error: ${(err as any).error || response.status}`);
  }

  const data = await response.json() as { id: number };

  // Store the researcher_project_id in our database
  prepare(`
    UPDATE projects SET researcher_project_id = ? WHERE id = ?
  `).run(data.id, projectId);

  // Persist task record (side-effect, non-blocking)
  try { createTask(projectId, 'research'); } catch { /* persistence is best-effort */ }
  try { logEvent(EVENT_TYPES.phase_started, projectId, { phase: 'research' }); } catch { /* non-blocking */ }

  console.log(`[research] Created research project ${data.id} for STRATEGOS project ${projectId}`);

  return data.id;
}

/**
 * Start the research queue in the research engine.
 */
export async function startResearchQueue(): Promise<void> {
  const response = await fetch(`${RESEARCH_ENGINE_URL}/api/queue/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Failed to start research queue: ${response.status}`);
  }

  console.log('[research] Queue started');
}

/**
 * Check if the research engine is healthy.
 * Re-exported from health.ts for backwards compatibility.
 */
export async function checkResearchEngineHealth(): Promise<boolean> {
  return checkHealth();
}

// =============================================================================
// STATUS & CONTENT RETRIEVAL
// =============================================================================

type ProviderStatusValue = 'pending' | 'running' | 'complete' | 'failed' | 'stopped';

interface ProviderResearchStatus {
  status: ProviderStatusValue;
  wordCount: number | null;
  startedAt: string | null;
  completedAt: string | null;
  content: string | null;
}

interface ResearchStatusResult {
  kimi: ProviderResearchStatus;
  gemini: ProviderResearchStatus;
  edr: ProviderResearchStatus;
}

const DEFAULT_PROVIDER_STATUS: ProviderResearchStatus = {
  status: 'pending',
  wordCount: null,
  startedAt: null,
  completedAt: null,
  content: null,
};

/**
 * Map research engine task status to STRATEGOS status.
 */
function mapTaskStatus(engineStatus: string): ProviderStatusValue {
  switch (engineStatus) {
    case 'queued':
      return 'pending';
    case 'running':
    case 'polling':
    case 'rate_limited':
      return 'running';
    case 'completed':
      return 'complete';
    case 'failed':
      return 'failed';
    case 'stopped':
      return 'stopped';
    default:
      return 'pending';
  }
}

/**
 * Get research status from the research engine.
 * Fetches project details, maps task statuses, saves completed content.
 */
export async function getResearchStatus(
  projectId: string,
  researcherProjectId: number,
): Promise<ResearchStatusResult> {
  const result: ResearchStatusResult = {
    kimi: { ...DEFAULT_PROVIDER_STATUS },
    gemini: { ...DEFAULT_PROVIDER_STATUS },
    edr: { ...DEFAULT_PROVIDER_STATUS },
  };

  // Get the project's root_path for fallback checks
  const project = prepare(
    'SELECT root_path FROM projects WHERE id = ?'
  ).get(projectId) as { root_path: string } | undefined;

  try {
    const response = await fetch(`${RESEARCH_ENGINE_URL}/api/projects/${researcherProjectId}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`[research] Failed to fetch project ${researcherProjectId}: ${response.status}`);
      // Fall through to filesystem fallback checks below
    } else {
      const data = await response.json() as {
        topics: Array<{
          tasks: Array<{
            provider: string;
            status: string;
            started_at: string | null;
            completed_at: string | null;
          }>;
        }>;
      };

      // Get the first (only) topic's tasks
      const tasks = data.topics?.[0]?.tasks || [];

      for (const task of tasks) {
        const provider = task.provider as keyof ResearchStatusResult;
        if (!result[provider]) continue;

        result[provider].status = mapTaskStatus(task.status);
        result[provider].startedAt = task.started_at;
        result[provider].completedAt = task.completed_at;

        // If completed, try to get the content
        if (task.status === 'completed' && project) {
          const content = await fetchAndSaveProviderContent(
            projectId,
            researcherProjectId,
            provider,
            project.root_path,
          );
          if (content) {
            result[provider].content = content;
            result[provider].wordCount = content.split(/\s+/).filter(Boolean).length;
          }
        }
      }
    }
  } catch (err: unknown) {
    console.error('[research] Status fetch error:', (err as Error).message);
    // Fall through to filesystem fallback checks below
  }

  // Fallback: If any provider shows failed or pending status but has output file on disk, treat as complete.
  // This handles two scenarios:
  // 1. Provider failed but output was saved before failure
  // 2. Research engine restarted and reset provider to 'pending' even though files exist
  if (project) {
    const providers: Array<keyof ResearchStatusResult> = ['kimi', 'gemini', 'edr'];
    for (const provider of providers) {
      if ((result[provider].status === 'failed' || result[provider].status === 'pending') && !result[provider].content) {
        const diskContent = checkDiskForProviderOutput(provider, project.root_path);
        if (diskContent) {
          console.log(`[research] Fallback: Found ${provider}.md on disk (${diskContent.length} bytes), promoting ${result[provider].status} → complete`);
          result[provider].status = 'complete';
          result[provider].content = diskContent;
          result[provider].wordCount = diskContent.split(/\s+/).filter(Boolean).length;
          result[provider].completedAt = new Date().toISOString();
        }
      }
    }
  }

  return result;
}

/**
 * Check disk for provider output file.
 * Returns content if file exists and is >100 bytes, otherwise null.
 */
function checkDiskForProviderOutput(provider: string, rootPath: string): string | null {
  const researchDir = join(rootPath, 'research');
  const filePath = join(researchDir, `${provider}.md`);

  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      if (content.length > 100) {
        return content;
      }
    } catch {
      // File read error, return null
    }
  }
  return null;
}

/**
 * Fetch completed task content from research engine and save to local filesystem.
 */
async function fetchAndSaveProviderContent(
  projectId: string,
  researcherProjectId: number,
  provider: string,
  rootPath: string,
): Promise<string | null> {
  const researchDir = join(rootPath, 'research');
  const filePath = join(researchDir, `${provider}.md`);

  // If we already saved this file, read from disk
  if (existsSync(filePath)) {
    try {
      return readFileSync(filePath, 'utf-8');
    } catch {
      // Fall through to fetch
    }
  }

  // Fetch from research engine — get the project to find the task
  try {
    const response = await fetch(`${RESEARCH_ENGINE_URL}/api/projects/${researcherProjectId}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      topics: Array<{
        tasks: Array<{
          id: number;
          provider: string;
          status: string;
        }>;
      }>;
    };

    const tasks = data.topics?.[0]?.tasks || [];
    const task = tasks.find((t: any) => t.provider === provider && t.status === 'completed');
    if (!task) return null;

    // Get the task result
    const taskResponse = await fetch(`${RESEARCH_ENGINE_URL}/api/tasks/${task.id}/result`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!taskResponse.ok) return null;

    const taskData = await taskResponse.json() as { result: string | null };
    if (!taskData.result) return null;

    // Save to filesystem
    if (!existsSync(researchDir)) {
      mkdirSync(researchDir, { recursive: true });
    }
    writeFileSync(filePath, taskData.result, 'utf-8');
    console.log(`[research] Saved ${provider} content to ${filePath}`);

    // Apply hallucination filter to KIMI output (idempotency-guarded)
    if (provider === 'kimi' && !hasKimiFilterBeenApplied(projectId)) {
      await filterKimiOutput(filePath, projectId);
    }

    return taskData.result;
  } catch (err) {
    console.error(`[research] Failed to fetch ${provider} content:`, (err as Error).message);
    return null;
  }
}

/**
 * Re-run a single research provider.
 * Deletes the provider's output file and restarts just that provider in the research engine.
 */
export async function rerunSingleProvider(projectId: string, provider: string): Promise<void> {
  const project = prepare(`
    SELECT researcher_project_id, root_path FROM projects WHERE id = ?
  `).get(projectId) as { researcher_project_id: number | null; root_path: string } | undefined;

  if (!project) throw new Error('Project not found');
  if (!project.researcher_project_id) throw new Error('No research project found — research must be started first');

  // Delete the provider's output file from disk
  const outputPath = join(project.root_path, 'research', `${provider}.md`);
  if (existsSync(outputPath)) {
    const { unlinkSync } = await import('fs');
    unlinkSync(outputPath);
    console.log(`[research] Deleted provider output: ${outputPath}`);
  }

  // Call research engine to restart this provider
  const response = await fetch(`${RESEARCH_ENGINE_URL}/api/research/${project.researcher_project_id}/restart-provider`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Research engine error: ${(err as any).error || response.status}`);
  }

  // Set project status back to researching
  prepare(`
    UPDATE projects SET status = 'researching', error_message = NULL WHERE id = ?
  `).run(projectId);

  console.log(`[research] Re-running provider ${provider} for project ${projectId}`);
}

/**
 * Stop research providers.
 * Aborts active connections and deletes partial output.
 */
export async function stopResearch(projectId: string, providers?: string[]): Promise<{
  providerStatuses: Record<string, string>;
  allStopped: boolean;
  anyComplete: boolean;
}> {
  const project = prepare(`
    SELECT researcher_project_id, root_path FROM projects WHERE id = ?
  `).get(projectId) as { researcher_project_id: number | null; root_path: string } | undefined;

  if (!project) throw new Error('Project not found');
  if (!project.researcher_project_id) throw new Error('No research project found');

  // Call research engine to stop providers
  const response = await fetch(`${RESEARCH_ENGINE_URL}/api/research/${project.researcher_project_id}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providers }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Research engine error: ${(err as any).error || response.status}`);
  }

  const data = await response.json() as { providerStatuses: Record<string, string> };

  // Delete stopped providers' output files from STRATEGOS project dir
  const allProviders = providers || ['kimi', 'gemini', 'edr'];
  for (const provider of allProviders) {
    if (data.providerStatuses[provider] === 'stopped') {
      const outputPath = join(project.root_path, 'research', `${provider}.md`);
      if (existsSync(outputPath)) {
        const { unlinkSync } = await import('fs');
        unlinkSync(outputPath);
        console.log(`[research] Deleted stopped provider output: ${outputPath}`);
      }
    }
  }

  // Determine overall status
  const statusValues = Object.values(data.providerStatuses);
  const allStopped = statusValues.every(s => s === 'stopped');
  const anyComplete = statusValues.some(s => s === 'completed');

  // Update project status based on result
  if (allStopped) {
    prepare(`
      UPDATE projects SET status = 'research_failed', error_message = 'Research stopped by user'
      WHERE id = ?
    `).run(projectId);
  } else if (anyComplete && !statusValues.some(s => ['queued', 'running', 'polling', 'rate_limited'].includes(s))) {
    // Some complete, some stopped, none still running
    prepare(`
      UPDATE projects SET status = 'research_complete', error_message = NULL
      WHERE id = ?
    `).run(projectId);
  }

  console.log(`[research] Stop result for project ${projectId}:`, data.providerStatuses);

  return {
    providerStatuses: data.providerStatuses,
    allStopped,
    anyComplete,
  };
}

// =============================================================================
// KIMI POST-GENERATION FILTER
// =============================================================================

/**
 * Check if the kimi filter has already been applied for a given project.
 * Queries the events table for a kimi_filter_applied event.
 */
function hasKimiFilterBeenApplied(projectId: string): boolean {
  try {
    const row = prepare(`
      SELECT id FROM events
      WHERE project_id = ? AND event_type = 'kimi_filter_applied'
      LIMIT 1
    `).get(projectId);
    return !!row;
  } catch {
    // If events table query fails, assume not applied (fail-open)
    return false;
  }
}

/**
 * Post-generation hallucination filter for KIMI output.
 * Uses Claude Haiku to remove ungrounded claims (named individuals in
 * internal roles, specific internal decisions, overly granular metrics).
 *
 * Fail-open: if the Anthropic API call throws, logs a warning and allows
 * the unfiltered file to proceed. Never throws.
 */
export async function filterKimiOutput(filePath: string, projectId: string): Promise<void> {
  let basename = '';
  try {
    basename = path.basename(filePath);
    const content = await readFile(filePath, 'utf-8');
    const wordsBefore = content.split(/\s+/).length;

    const filterPrompt = loadPrompt('kimi-filter.md');
    const anthropic = getAnthropicClient();

    const filterStart = Date.now();
    // Use streaming to avoid Anthropic SDK 10-minute timeout on large inputs
    const stream = anthropic.messages.stream({
      model: MODELS.kimiFilter,
      max_tokens: 24000,
      messages: [{ role: 'user', content: `${filterPrompt}\n\n---\n\n${content}` }],
    });
    const response = await stream.finalMessage();
    const filterDuration = Date.now() - filterStart;

    try { logLLMCall({ project_id: projectId, phase: 'research', model: MODELS.kimiFilter, provider: 'anthropic', ...extractAnthropicUsage(response), duration_ms: filterDuration }); } catch { /* non-blocking */ }

    const filtered = response.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    const wordsAfter = filtered.split(/\s+/).length;

    await writeFile(filePath, filtered, 'utf-8');

    logEvent(EVENT_TYPES.kimi_filter_applied, projectId, {
      filePath: basename,
      wordsBefore,
      wordsAfter,
      removedWords: wordsBefore - wordsAfter,
    });

    console.log(`[kimi-filter] Filtered ${basename}: ${wordsBefore} → ${wordsAfter} words (removed ${wordsBefore - wordsAfter})`);
  } catch (err) {
    console.warn(`[kimi-filter] Filter step failed for ${basename}, continuing with unfiltered output:`, err);
  }
}

/**
 * Check research status and advance the project status if appropriate.
 * Also detects failures and timeouts.
 */
export function checkAndAdvanceStatus(
  projectId: string,
  research: ResearchStatusResult,
): void {
  const statuses = [research.kimi.status, research.gemini.status, research.edr.status];
  const providers = [
    { name: 'kimi', data: research.kimi },
    { name: 'gemini', data: research.gemini },
    { name: 'edr', data: research.edr },
  ];

  const anyRunning = statuses.some(s => s === 'running');
  const allComplete = statuses.every(s => s === 'complete');
  const anyFailed = statuses.some(s => s === 'failed');
  const anyStopped = statuses.some(s => s === 'stopped');
  const allStoppedOrComplete = statuses.every(s => s === 'stopped' || s === 'complete');

  // Check for timeout: if any provider has been running for more than 45 minutes
  const TIMEOUT_MS = 45 * 60 * 1000;
  const now = Date.now();
  for (const provider of providers) {
    if (provider.data.status === 'running' && provider.data.startedAt) {
      const startedAt = new Date(provider.data.startedAt).getTime();
      if (now - startedAt > TIMEOUT_MS) {
        console.error(`[research] ${provider.name} provider timed out after 45 minutes`);
        const errorMessage = `Research timed out: ${provider.name} provider exceeded 45-minute limit`;
        prepare(`
          UPDATE projects SET status = 'research_failed', error_message = ?
          WHERE id = ? AND status = 'researching'
        `).run(errorMessage, projectId);
        try {
          const active = getActiveTaskForPersistence(projectId, 'research');
          if (active) failTask(active.id, errorMessage);
        } catch { /* persistence is best-effort */ }
        try { logEvent(EVENT_TYPES.provider_timeout, projectId, { provider: provider.name, phase: 'research' }); } catch { /* non-blocking */ }
        try { logEvent(EVENT_TYPES.phase_failed, projectId, { phase: 'research', error: errorMessage }); } catch { /* non-blocking */ }
        return;
      }
    }
  }

  // Terminal states: complete, failed, stopped
  const allTerminal = statuses.every(s => s === 'complete' || s === 'failed' || s === 'stopped');
  const anyComplete = statuses.some(s => s === 'complete');
  const allFailed = statuses.every(s => s === 'failed');

  // Log individual provider failures as they occur (even if others are still running)
  for (const p of providers.filter(p => p.data.status === 'failed')) {
    try { logEvent(EVENT_TYPES.provider_failure, projectId, { provider: p.name, phase: 'research', error: `Provider ${p.name} returned failure status` }); } catch { /* non-blocking */ }
  }

  if (allTerminal) {
    // Log per-provider metrics at terminal state
    for (const p of providers) {
      const durationMs = (p.data.startedAt && p.data.completedAt)
        ? new Date(p.data.completedAt).getTime() - new Date(p.data.startedAt).getTime()
        : null;
      try {
        logEvent(EVENT_TYPES.provider_completed, projectId, {
          provider: p.name,
          status: p.data.status,
          duration_ms: durationMs,
          word_count: p.data.wordCount,
        });
      } catch { /* non-blocking */ }
    }

    // Flush dedup summary for suppressed failure/retry events
    try { flushDedupSummary(projectId); } catch { /* non-blocking */ }

    if (anyComplete) {
      // At least one provider completed — advance to research_complete
      const completedProviders = providers.filter(p => p.data.status === 'complete').map(p => p.name);
      const failedProviders = providers.filter(p => p.data.status === 'failed').map(p => p.name);
      const stoppedProviders = providers.filter(p => p.data.status === 'stopped').map(p => p.name);
      const isDegraded = failedProviders.length > 0 || stoppedProviders.length > 0;

      prepare(`
        UPDATE projects SET status = 'research_complete', error_message = NULL
        WHERE id = ? AND status = 'researching'
      `).run(projectId);

      try {
        const active = getActiveTaskForPersistence(projectId, 'research');
        if (active) {
          const progressMap: Record<string, string> = {};
          for (const p of providers) { progressMap[p.name] = p.data.status; }
          updateTaskProgress(active.id, progressMap);
          completeTask(active.id);
        }
      } catch { /* persistence is best-effort */ }

      if (isDegraded) {
        try {
          logEvent(EVENT_TYPES.research_degraded, projectId, {
            phase: 'research',
            completedProviders,
            failedProviders,
            stoppedProviders,
          });
        } catch { /* non-blocking */ }
        console.log(`[research] Project ${projectId} → research_complete (degraded: ${completedProviders.length}/3 providers)`);
      } else {
        console.log(`[research] Project ${projectId} → research_complete`);
      }
      try { logEvent(EVENT_TYPES.phase_completed, projectId, { phase: 'research' }); } catch { /* non-blocking */ }
    } else if (allFailed) {
      // All providers failed — mark research as failed
      const failedNames = providers.map(p => p.name).join(', ');
      const errorMessage = `Research failed: all providers [${failedNames}] returned failure status`;
      prepare(`
        UPDATE projects SET status = 'research_failed', error_message = ?
        WHERE id = ? AND status = 'researching'
      `).run(errorMessage, projectId);
      try {
        const active = getActiveTaskForPersistence(projectId, 'research');
        if (active) failTask(active.id, errorMessage);
      } catch { /* persistence is best-effort */ }
      try { logEvent(EVENT_TYPES.phase_failed, projectId, { phase: 'research', error: errorMessage }); } catch { /* non-blocking */ }
      console.error(`[research] ${errorMessage}`);
    } else {
      // All stopped (no completions, no failures that aren't stopped)
      prepare(`
        UPDATE projects SET status = 'research_failed', error_message = ?
        WHERE id = ? AND status = 'researching'
      `).run('Research stopped by user', projectId);
      console.log(`[research] Project ${projectId} → research_failed (all providers stopped)`);
    }
  } else if (anyRunning) {
    // Still in progress — ensure status is 'researching'
    prepare(`
      UPDATE projects SET status = 'researching'
      WHERE id = ? AND status IN ('brief_approved', 'researching')
    `).run(projectId);
  }
  // else: some providers pending/failed but not all terminal — keep polling
}
