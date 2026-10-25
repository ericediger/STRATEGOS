import { callKimiChat } from '../utils/api.js';
import { readPrompt } from '../utils/files.js';
import { appendTokenRecord } from '../utils/token-logger.js';
import { MODELS } from '../models.js';
import type { Claim } from '../types.js';

/**
 * Step 1: Extract Claims
 * Use Kimi to extract verifiable claims from consolidated document.
 */
export async function runExtractStep(consolidatedText: string): Promise<Claim[]> {
  const systemPrompt = await readPrompt('extractor.md');

  const wordCount = consolidatedText.split(/\s+/).length;
  const sizeKB = (Buffer.byteLength(consolidatedText, 'utf-8') / 1024).toFixed(1);
  console.log(`  [extract] Sending to ${MODELS.chat} — ${consolidatedText.length} chars, ${wordCount} words, ${sizeKB} KB`);

  const MAX_RETRIES = 3;
  const BACKOFF_MS = [10_000, 30_000, 60_000]; // 10s, 30s, 60s

  let response;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await callKimiChat(consolidatedText, systemPrompt, 32768);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = msg.includes('timeout') || msg.includes('abort') || msg.includes('429') || msg.includes('overloaded');
      if (!isRetryable || attempt === MAX_RETRIES) {
        throw err;
      }
      const delay = BACKOFF_MS[attempt - 1];
      console.log(`  [extract] Attempt ${attempt}/${MAX_RETRIES} failed (${msg}), retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.log(`  [extract] Tokens: ${response!.input_tokens} in / ${response!.output_tokens} out`);
  appendTokenRecord('extract', MODELS.chat, response!.input_tokens, response!.output_tokens);

  const claims = parseClaimsResponse(response!.content);
  console.log(`  [extract] Extracted ${claims.length} claims`);

  return claims;
}

function parseClaimsResponse(content: string): Claim[] {
  // Strip markdown code fences if present
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Truncated JSON recovery: find last complete object and close the array
      const lastComplete = cleaned.lastIndexOf('}');
      if (lastComplete > 0) {
        const truncated = cleaned.substring(0, lastComplete + 1) + ']';
        console.log(`  [extract] Attempting truncated JSON recovery (cut at char ${lastComplete})`);
        parsed = JSON.parse(truncated);
      } else {
        throw new Error('Cannot recover truncated JSON');
      }
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Expected JSON array of claims');
    }
    return parsed.map((c: any) => ({
      id: c.id || 'UNKNOWN',
      statement: c.statement || '',
      citation: c.citation || '',
      source_doc: c.source_doc || '',
      location: c.location || '',
    }));
  } catch (err) {
    throw new Error(`Failed to parse claims JSON: ${err instanceof Error ? err.message : err}\nRaw: ${content.substring(0, 500)}`);
  }
}
