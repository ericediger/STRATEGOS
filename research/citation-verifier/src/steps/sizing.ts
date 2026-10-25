import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { callKimiChat } from '../utils/api.js';
import { readPrompt, readIntermediate } from '../utils/files.js';
import { MODELS } from '../models.js';
import type { SizingParams } from '../types.js';

interface SizingResult {
  structural_allocation: number | null;
  formula_target: number;
  outline_expansion_estimate: number | null;
  research_density_cap_words: number;
  recommended_range: [number, number];
  recommended_target: number;
  reconciliation_notes: string;
  section_breakdown: Array<{ section: string; target_words: number }>;
  report: string;
}

/**
 * Step 5: Sizing
 * Calculate word count targets using Kimi.
 */
export async function runSizingStep(
  projectId: number,
  unitNumber: number,
  unitTitle: string,
  unitContext: string,
  sizingParams: SizingParams,
  outlineFile?: string,
  specFile?: string,
  specContent?: string,
): Promise<SizingResult> {
  const systemPrompt = await readPrompt('sizing.md');

  // Build user prompt with available documents
  const userPrompt = await buildSizingPrompt(
    projectId, unitNumber, unitTitle, unitContext,
    sizingParams, outlineFile, specFile, specContent,
  );

  console.log(`  [sizing] Sending to ${MODELS.chat} (${userPrompt.length} chars)`);

  const response = await callKimiChat(userPrompt, systemPrompt, 8000);

  console.log(`  [sizing] Tokens: ${response.input_tokens} in / ${response.output_tokens} out`);

  return parseSizingResponse(response.content);
}

async function buildSizingPrompt(
  projectId: number,
  unitNumber: number,
  unitTitle: string,
  unitContext: string,
  params: SizingParams,
  outlineFile?: string,
  specFile?: string,
  specContent?: string,
): Promise<string> {
  const sections: string[] = [];

  sections.push(`# Sizing Request: Unit ${unitNumber} — ${unitTitle}`);
  sections.push('');
  sections.push(`## Parameters`);
  sections.push(`- Reading time: ${params.reading_time} minutes`);
  sections.push(`- Complexity: ${params.complexity}`);
  sections.push(`- Style: ${params.style}`);
  sections.push('');

  // OUTLINE
  sections.push('## OUTLINE');
  if (outlineFile && existsSync(outlineFile)) {
    const outline = await readFile(outlineFile, 'utf-8');
    sections.push(outline);
  } else if (unitContext) {
    sections.push(unitContext);
  } else {
    sections.push('(No outline available)');
  }
  sections.push('');

  // SUPPORTING RESEARCH — try to read verification report from intermediates
  sections.push('## SUPPORTING RESEARCH');
  try {
    const verificationReport = await readIntermediate(
      projectId, unitNumber,
      `ch${String(unitNumber).padStart(2, '0')}_verification_report.md`,
    );
    sections.push(verificationReport.substring(0, 5000)); // Cap to avoid token overflow
  } catch {
    sections.push('(No verification report available)');
  }
  sections.push('');

  // REFERENCE — book specification context
  sections.push('## REFERENCE — Book Specification Context');
  if (specFile && existsSync(specFile)) {
    const spec = await readFile(specFile, 'utf-8');
    sections.push(spec.substring(0, 8000)); // Cap
  } else if (specContent) {
    sections.push(specContent.substring(0, 8000)); // Cap
  } else {
    sections.push('(No book specification context available)');
  }

  return sections.join('\n');
}

function parseSizingResponse(content: string): SizingResult {
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      structural_allocation: parsed.structural_allocation ?? null,
      formula_target: parsed.formula_target ?? 0,
      outline_expansion_estimate: parsed.outline_expansion_estimate ?? null,
      research_density_cap_words: parsed.research_density_cap_words ?? 0,
      recommended_range: parsed.recommended_range ?? [0, 0],
      recommended_target: parsed.recommended_target ?? 0,
      reconciliation_notes: parsed.reconciliation_notes ?? '',
      section_breakdown: parsed.section_breakdown ?? [],
      report: parsed.report ?? '',
    };
  } catch (err) {
    throw new Error(`Failed to parse sizing JSON: ${err instanceof Error ? err.message : err}\nRaw: ${content.substring(0, 500)}`);
  }
}
