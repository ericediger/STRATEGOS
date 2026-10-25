/**
 * Prompt Loader — Load and cache prompt files
 *
 * Loads prompt markdown files from STRATEGOS/prompts/ directory.
 * Files are cached in memory after first load.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// backend/src/services/ → STRATEGOS/
const PROMPTS_DIR = join(__dirname, '..', '..', '..', 'prompts');

const promptCache = new Map<string, string>();

/**
 * Load a prompt file by filename.
 * Caches in memory after first load (production only).
 * In dev mode, always reads from disk for hot-reload.
 */
export function loadPrompt(filename: string): string {
  const isDev = process.env.NODE_ENV !== 'production';

  if (!isDev && promptCache.has(filename)) {
    return promptCache.get(filename)!;
  }

  const filePath = join(PROMPTS_DIR, filename);
  try {
    const content = readFileSync(filePath, 'utf-8');
    if (!isDev) {
      promptCache.set(filename, content);
    }
    return content;
  } catch (err) {
    console.error(`[prompt-loader] Failed to load prompt: ${filename}`, err);
    throw new Error(`Prompt file not found: ${filename}`);
  }
}

/**
 * Clear the prompt cache (useful for development hot-reload).
 */
export function clearPromptCache(): void {
  promptCache.clear();
}
