import { callKimiReasoner } from '../utils/api.js';
import { readPrompt } from '../utils/files.js';
import { appendTokenRecord } from '../utils/token-logger.js';
import type { Claim, InvestigationResult, AdjudicationResult, ClaimVerdict } from '../types.js';

/**
 * Step 3: Batch Adjudicate
 * Single Kimi K2.5 reasoner call to verify all claims against evidence.
 */
export async function runAdjudicateStep(
  claims: Claim[],
  investigations: InvestigationResult[],
): Promise<AdjudicationResult> {
  const systemPrompt = await readPrompt('batch-adjudicator.md');

  const batchPrompt = buildBatchPrompt(systemPrompt, claims, investigations);

  console.log(`  [adjudicate] Sending batch of ${claims.length} claims to Kimi K2.5`);
  console.log(`  [adjudicate] Prompt size: ${batchPrompt.length} chars`);

  const MAX_RETRIES = 3;
  const BACKOFF_MS = [10_000, 30_000, 60_000]; // 10s, 30s, 60s

  let response;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await callKimiReasoner(batchPrompt, 32768);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = msg.includes('timeout') || msg.includes('abort') || msg.includes('429') || msg.includes('overloaded');
      if (!isRetryable || attempt === MAX_RETRIES) {
        throw err;
      }
      const delay = BACKOFF_MS[attempt - 1];
      console.log(`  [adjudicate] Attempt ${attempt}/${MAX_RETRIES} failed (${msg}), retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.log(`  [adjudicate] Tokens: ${response!.input_tokens} in / ${response!.output_tokens} out`);
  appendTokenRecord('adjudicate', 'kimi-k2.5-reasoner', response!.input_tokens, response!.output_tokens);

  const result = parseAdjudicationResponse(response!.content);
  return result;
}

function buildBatchPrompt(
  systemPrompt: string,
  claims: Claim[],
  investigations: InvestigationResult[],
): string {
  const investigationMap = new Map(investigations.map(i => [i.claim_id, i]));

  let prompt = `${systemPrompt}\n\n---\n\n# Claims to Verify\n\n`;

  for (const claim of claims) {
    const investigation = investigationMap.get(claim.id);
    prompt += `## CLAIM ${claim.id}\n`;
    prompt += `**Document:** ${claim.source_doc}\n`;
    prompt += `**Statement:** ${claim.statement}\n`;
    prompt += `**Citation:** ${claim.citation}\n`;
    prompt += `**Location:** ${claim.location}\n\n`;

    if (investigation && investigation.sources.length > 0) {
      prompt += `### Evidence Found\n`;
      for (const source of investigation.sources) {
        prompt += `- **${source.title}** (${source.url})\n`;
        const content = (source.content || '').substring(0, 800);
        prompt += `  ${content}\n\n`;
      }
    } else {
      prompt += `### Evidence Found\nNo sources retrieved.\n\n`;
    }

    prompt += `---\n\n`;
  }

  return prompt;
}

function parseAdjudicationResponse(content: string): AdjudicationResult {
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Truncated JSON recovery: close open structures
      let truncated = cleaned;
      const lastBrace = truncated.lastIndexOf('}');
      if (lastBrace > 0) {
        truncated = truncated.substring(0, lastBrace + 1);
        // Close verdicts array and outer object if needed
        if (!truncated.endsWith(']}')) {
          truncated += ']}';
        }
        console.log(`  [adjudicate] Attempting truncated JSON recovery`);
        parsed = JSON.parse(truncated);
      } else {
        throw new Error('Cannot recover truncated JSON');
      }
    }
    return {
      verdicts: (parsed.verdicts || []).map((v: any): ClaimVerdict => ({
        claim_id: v.claim_id || '',
        verdict: v.verdict || 'Insufficient Evidence',
        confidence: v.confidence ?? 0.5,
        reasoning: v.reasoning || '',
        evidence_summary: v.evidence_summary || '',
        sources_checked: v.sources_checked || [],
      })),
      summary: parsed.summary || '',
    };
  } catch (err) {
    throw new Error(`Failed to parse adjudication JSON: ${err instanceof Error ? err.message : err}\nRaw: ${content.substring(0, 500)}`);
  }
}
