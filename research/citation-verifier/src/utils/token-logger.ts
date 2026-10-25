/**
 * Token Logger — Appends token usage records to a JSONL file.
 *
 * Non-blocking: all writes wrapped in try-catch.
 * Lazy file creation: file is created on first write.
 * Append-only: one JSON object per line.
 */

import { appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_LOG_PATH = join(__dirname, '../../token-log.jsonl');

export interface TokenRecord {
  timestamp: string;
  step: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  project_id?: number;
  unit_number?: number;
}

/** Current pipeline context — set by the pipeline before step execution. */
let currentContext: { project_id?: number; unit_number?: number } = {};

/**
 * Set the project context for subsequent token log entries.
 * Call this at the start of each pipeline run.
 */
export function setTokenLogContext(project_id: number, unit_number: number): void {
  currentContext = { project_id, unit_number };
}

/**
 * Clear the project context after pipeline completion.
 */
export function clearTokenLogContext(): void {
  currentContext = {};
}

/**
 * Append a token usage record to the JSONL file.
 * Non-blocking — never throws.
 */
export function appendTokenRecord(step: string, model: string, input_tokens: number, output_tokens: number): void {
  try {
    const record: TokenRecord = {
      timestamp: new Date().toISOString(),
      step,
      model,
      input_tokens,
      output_tokens,
      ...currentContext,
    };

    appendFileSync(TOKEN_LOG_PATH, JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    console.warn(`[token-logger] appendTokenRecord failed: ${err instanceof Error ? err.message : err}`);
  }
}
