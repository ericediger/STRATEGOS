/**
 * LLM Call Logger — Writes token usage records to the llm_calls table.
 *
 * Non-blocking companion layer (Rule 11): all writes wrapped in try-catch,
 * never blocks primary operations. If logging fails, the pipeline continues.
 */

import { randomUUID } from 'crypto';
import { prepare } from '../db/index.js';

// =============================================================================
// TYPES
// =============================================================================

export interface LLMCallRecord {
  project_id: string;
  phase: string;
  model: string;
  provider: string;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  status?: string;
  error?: string;
}

// =============================================================================
// CORE OPERATION
// =============================================================================

/**
 * Log an LLM API call to the llm_calls table. Non-blocking — never throws.
 */
export function logLLMCall(record: LLMCallRecord): void {
  try {
    const id = randomUUID();
    const totalTokens = (record.input_tokens ?? 0) + (record.output_tokens ?? 0);

    prepare(`
      INSERT INTO llm_calls (id, project_id, phase, provider, model, prompt_tokens, completion_tokens, total_tokens, latency_ms, status, error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      id,
      record.project_id,
      record.phase,
      record.provider,
      record.model,
      record.input_tokens,
      record.output_tokens,
      totalTokens || null,
      record.duration_ms,
      record.status ?? 'success',
      record.error ?? null,
    );
  } catch (err) {
    console.warn('[llm-logger] logLLMCall failed:', (err as Error).message);
  }
}

// =============================================================================
// HELPERS — Extract usage from SDK responses
// =============================================================================

/**
 * Extract token usage from an Anthropic response.
 */
export function extractAnthropicUsage(response: { usage?: { input_tokens?: number; output_tokens?: number } }): {
  input_tokens: number | null;
  output_tokens: number | null;
} {
  return {
    input_tokens: response.usage?.input_tokens ?? null,
    output_tokens: response.usage?.output_tokens ?? null,
  };
}

/**
 * Extract token usage from an OpenAI response (non-streaming).
 */
export function extractOpenAIUsage(response: { usage?: { prompt_tokens?: number; completion_tokens?: number } | null }): {
  input_tokens: number | null;
  output_tokens: number | null;
} {
  return {
    input_tokens: response.usage?.prompt_tokens ?? null,
    output_tokens: response.usage?.completion_tokens ?? null,
  };
}
