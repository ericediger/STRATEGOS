/**
 * Phase 0: Research Collaboration Service
 *
 * Handles the conversational research collaboration flow:
 * 1. User chats with AI to define research requirements
 * 2. AI synthesizes conversation into a Research Brief
 * 3. User reviews and approves the Brief
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { prepare } from '../db/index.js';
import { loadPrompt } from './prompt-loader.js';
import { logLLMCall, extractAnthropicUsage } from './llm-logger.js';
import { MODELS } from '../config/models.js';

// Lazy init — dotenv hasn't loaded yet at import time
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic();
  }
  return _anthropic;
}

// =============================================================================
// CHAT
// =============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

/**
 * Get conversation history for a project.
 */
export function getChatHistory(projectId: string): ChatMessage[] {
  const session = prepare(
    'SELECT messages FROM collaboration_sessions WHERE project_id = ?'
  ).get(projectId) as { messages: string } | undefined;

  if (!session?.messages) return [];

  try {
    return JSON.parse(session.messages);
  } catch {
    return [];
  }
}

/**
 * Send a message and get an AI response.
 * Uses the collaborator-system.md prompt.
 */
export async function sendChat(
  projectId: string,
  projectName: string,
  userMessage: string,
): Promise<{ reply: string; messageCount: number }> {
  const history = getChatHistory(projectId);

  const now = new Date().toISOString();
  history.push({ role: 'user', content: userMessage, timestamp: now });

  const systemPrompt = loadPrompt('collaborator-system.md');
  const messages = history.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const callStart = Date.now();
  const response = await getAnthropic().messages.create({
    model: MODELS.collaboration,
    max_tokens: 2048,
    system: systemPrompt,
    messages,
  });
  const callDuration = Date.now() - callStart;

  try { logLLMCall({ project_id: projectId, phase: 'collaboration', model: MODELS.collaboration, provider: 'anthropic', ...extractAnthropicUsage(response), duration_ms: callDuration }); } catch { /* non-blocking */ }

  const reply = response.content
    .filter(block => block.type === 'text')
    .map(block => block.type === 'text' ? block.text : '')
    .join('');

  history.push({ role: 'assistant', content: reply, timestamp: new Date().toISOString() });

  // Persist conversation (upsert)
  const existing = prepare(
    'SELECT id FROM collaboration_sessions WHERE project_id = ?'
  ).get(projectId);

  if (existing) {
    prepare(
      'UPDATE collaboration_sessions SET messages = ?, updated_at = datetime(\'now\') WHERE project_id = ?'
    ).run(JSON.stringify(history), projectId);
  } else {
    const { v4: uuidv4 } = await import('uuid');
    prepare(
      'INSERT INTO collaboration_sessions (id, project_id, messages) VALUES (?, ?, ?)'
    ).run(uuidv4(), projectId, JSON.stringify(history));
  }

  // Update status to 'collaborating' if still 'not_started'
  prepare(`
    UPDATE projects SET status = 'collaborating'
    WHERE id = ? AND status = 'not_started'
  `).run(projectId);

  return { reply, messageCount: history.length };
}

// =============================================================================
// BRIEF SYNTHESIS
// =============================================================================

/**
 * Synthesize the conversation into a Research Brief.
 * Uses MODELS.briefSynthesis with adaptive thinking.
 */
export async function synthesizeBrief(
  projectId: string,
  projectName: string,
): Promise<{ brief: string; wordCount: number }> {
  const history = getChatHistory(projectId);

  if (history.length < 4) {
    throw new Error('Need at least 4 messages before generating a Research Brief');
  }

  const systemPrompt = loadPrompt('brief-synthesis.md');

  const transcript = history
    .map(m => `**${m.role === 'user' ? 'User' : 'Research Collaborator'}:** ${m.content}`)
    .join('\n\n');

  const userPrompt = `## Research Collaboration Transcript\n\n${transcript}\n\n---\n\nPlease synthesize the above conversation into a structured Research Brief.`;

  const synthStart = Date.now();
  const response = await getAnthropic().messages.create({
    model: MODELS.briefSynthesis,
    max_tokens: 16000,
    thinking: {
      type: 'adaptive',
    },
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const synthDuration = Date.now() - synthStart;

  try { logLLMCall({ project_id: projectId, phase: 'synthesis', model: MODELS.briefSynthesis, provider: 'anthropic', ...extractAnthropicUsage(response), duration_ms: synthDuration }); } catch { /* non-blocking */ }

  const brief = response.content
    .filter(block => block.type === 'text')
    .map(block => block.type === 'text' ? block.text : '')
    .join('');

  const wordCount = brief.split(/\s+/).filter(Boolean).length;

  // Save brief to filesystem
  const project = prepare(
    'SELECT root_path FROM projects WHERE id = ?'
  ).get(projectId) as { root_path: string };

  const { writeFileSync } = await import('fs');
  const { join } = await import('path');
  const briefPath = join(project.root_path, 'collaboration', 'research-brief.md');
  writeFileSync(briefPath, brief, 'utf-8');

  // Update database
  prepare(`
    UPDATE projects
    SET status = 'brief_generated',
        research_brief_path = ?
    WHERE id = ?
  `).run(briefPath, projectId);

  // Create research_briefs record
  const { v4: uuidv4 } = await import('uuid');
  prepare(`
    INSERT INTO research_briefs (id, project_id, file_path, status)
    VALUES (?, ?, ?, 'draft')
  `).run(uuidv4(), projectId, briefPath);

  return { brief, wordCount };
}

// =============================================================================
// BRIEF APPROVAL
// =============================================================================

/**
 * Approve the Research Brief, advancing the project to Phase 1.
 */
export function approveBrief(projectId: string): void {
  prepare(`
    UPDATE research_briefs
    SET status = 'approved', approved_at = datetime('now')
    WHERE project_id = ? AND status = 'draft'
  `).run(projectId);

  prepare(`
    UPDATE projects
    SET status = 'brief_approved'
    WHERE id = ? AND status = 'brief_generated'
  `).run(projectId);
}

/**
 * Update the Research Brief content.
 * Writes new content to disk and updates the DB row timestamp.
 */
export function updateBrief(projectId: string, content: string): { success: boolean; updatedAt: string } {
  const project = prepare(
    'SELECT root_path FROM projects WHERE id = ?'
  ).get(projectId) as { root_path: string } | undefined;

  if (!project) {
    throw new Error('Project not found');
  }

  const collabDir = join(project.root_path, 'collaboration');
  if (!existsSync(collabDir)) mkdirSync(collabDir, { recursive: true });

  const briefPath = join(collabDir, 'research-brief.md');
  writeFileSync(briefPath, content, 'utf-8');

  // Update research_briefs row timestamp
  prepare(`
    UPDATE research_briefs SET file_path = ? WHERE project_id = ?
  `).run(briefPath, projectId);

  // Ensure project has the brief path set
  prepare(`
    UPDATE projects SET research_brief_path = ? WHERE id = ?
  `).run(briefPath, projectId);

  const updatedAt = new Date().toISOString();
  return { success: true, updatedAt };
}

/**
 * Get the Research Brief content.
 */
export function getBrief(projectId: string): { content: string; wordCount: number; status: string } | null {
  const brief = prepare(`
    SELECT file_path, status FROM research_briefs WHERE project_id = ?
  `).get(projectId) as { file_path: string; status: string } | undefined;

  if (!brief) return null;

  try {
    // Try stored path first; fall back to canonical path under PROJECTS_ROOT
    let filePath = brief.file_path;
    if (!existsSync(filePath)) {
      const projectsRoot = process.env.PROJECTS_ROOT;
      if (projectsRoot) {
        filePath = join(projectsRoot, projectId, 'collaboration', 'research-brief.md');
      }
    }
    const content = readFileSync(filePath, 'utf-8');
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    return { content, wordCount, status: brief.status };
  } catch {
    return null;
  }
}
