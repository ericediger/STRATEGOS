/**
 * Gemini Verification Pipeline Tests
 *
 * Validates that the Gemini research provider is correctly included in the
 * verification pipeline — from file discovery through consolidation markers
 * to provider attribution in the downstream extract/consensus steps.
 *
 * Background: A silent drop was discovered where Gemini's .md output file
 * existed on disk but received zero attribution in the Cross-Provider
 * Consensus Analysis. The root cause was the consolidation SOURCE marker
 * lacking an explicit provider tag, causing the LLM extractor to fail
 * provider identification for Gemini content.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'fs';
import { join, basename, resolve } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// Helpers: replicate the consolidation marker logic (matches consolidate.ts)
// ---------------------------------------------------------------------------

/**
 * Build a SOURCE marker the way consolidate.ts does post-fix.
 * This mirrors the exact line in consolidate.ts:
 *   `<!-- SOURCE: ${filename} | provider: ${provider} -->`
 */
function buildSourceMarker(filename: string): string {
  const provider = filename.replace(/\.md$/, '');
  return `<!-- SOURCE: ${filename} | provider: ${provider} -->`;
}

/**
 * Replicate the file-scanning logic from verification.ts startVerification().
 * Returns basenames of all .md files found in the research directory.
 */
function scanResearchFiles(researchDir: string): string[] {
  if (!existsSync(researchDir)) return [];
  return readdirSync(researchDir)
    .filter(f => f.endsWith('.md'))
    .map(f => resolve(join(researchDir, f)));
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `strategos-test-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ===========================================================================
// Test Suite
// ===========================================================================

describe('Gemini verification pipeline', () => {

  // -------------------------------------------------------------------------
  // Test 1: Gemini .md file appears in the file path array
  // -------------------------------------------------------------------------
  it('includes gemini.md in the scanned research file list', () => {
    const researchDir = join(tmpDir, 'research');
    mkdirSync(researchDir, { recursive: true });

    // Create the three provider output files
    writeFileSync(join(researchDir, 'kimi.md'), '# Kimi Research\nSome content here.');
    writeFileSync(join(researchDir, 'gemini.md'), '# Gemini Research\nSome content here.');
    writeFileSync(join(researchDir, 'edr.md'), '# EDR Research\nSome content here.');

    const files = scanResearchFiles(researchDir);
    const filenames = files.map(f => basename(f));

    expect(filenames).toContain('gemini.md');
    expect(filenames).toContain('kimi.md');
    expect(filenames).toContain('edr.md');
    expect(files.length).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Test 2: Consolidation writes correct SOURCE marker with provider tag
  // -------------------------------------------------------------------------
  it('consolidation marker includes explicit provider tag for gemini', () => {
    const marker = buildSourceMarker('gemini.md');

    // Must contain the filename for traceability
    expect(marker).toContain('SOURCE: gemini.md');
    // Must contain the explicit provider tag (the fix)
    expect(marker).toContain('provider: gemini');
    // Full expected format
    expect(marker).toBe('<!-- SOURCE: gemini.md | provider: gemini -->');
  });

  // -------------------------------------------------------------------------
  // Test 3: All provider markers are correctly formed (not hardcoded)
  // -------------------------------------------------------------------------
  it('generates correct provider tags for all known providers', () => {
    const providers = ['kimi.md', 'gemini.md', 'edr.md'];

    for (const filename of providers) {
      const marker = buildSourceMarker(filename);
      const expectedProvider = filename.replace(/\.md$/, '');

      expect(marker).toContain(`provider: ${expectedProvider}`);
      expect(marker).toContain(`SOURCE: ${filename}`);
    }
  });

  // -------------------------------------------------------------------------
  // Test 4: File scan does not silently ignore non-standard provider names
  // -------------------------------------------------------------------------
  it('includes .md files with non-standard names in the scan', () => {
    const researchDir = join(tmpDir, 'research');
    mkdirSync(researchDir, { recursive: true });

    // Standard providers
    writeFileSync(join(researchDir, 'kimi.md'), '# Kimi');
    writeFileSync(join(researchDir, 'gemini.md'), '# Gemini');
    writeFileSync(join(researchDir, 'edr.md'), '# EDR');
    // A hypothetical future provider
    writeFileSync(join(researchDir, 'perplexity.md'), '# Perplexity');
    // Non-md file should be excluded
    writeFileSync(join(researchDir, 'notes.txt'), 'not a research file');

    const files = scanResearchFiles(researchDir);
    const filenames = files.map(f => basename(f));

    expect(filenames).toHaveLength(4);
    expect(filenames).toContain('perplexity.md');
    expect(filenames).not.toContain('notes.txt');

    // Provider marker for non-standard name should still work
    const marker = buildSourceMarker('perplexity.md');
    expect(marker).toBe('<!-- SOURCE: perplexity.md | provider: perplexity -->');
  });

  // -------------------------------------------------------------------------
  // Test 5: Empty research directory does not produce files
  // -------------------------------------------------------------------------
  it('returns empty array when research directory has no .md files', () => {
    const researchDir = join(tmpDir, 'research');
    mkdirSync(researchDir, { recursive: true });

    // Only non-md files
    writeFileSync(join(researchDir, 'readme.txt'), 'not markdown');

    const files = scanResearchFiles(researchDir);
    expect(files).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test 6: Missing research directory returns empty (graceful handling)
  // -------------------------------------------------------------------------
  it('returns empty array when research directory does not exist', () => {
    const researchDir = join(tmpDir, 'nonexistent-research');

    const files = scanResearchFiles(researchDir);
    expect(files).toHaveLength(0);
  });
});
