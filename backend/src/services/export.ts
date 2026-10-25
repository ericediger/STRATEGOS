/**
 * Document Export Service
 *
 * Generates professional DOCX/PPTX exports of completed artifacts.
 * Uses Claude Opus 4.6 to generate Node.js scripts that create the documents,
 * then executes those scripts in a sandboxed temp directory.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, rmSync, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { prepare } from '../db/index.js';
import { loadPrompt } from './prompt-loader.js';
import { getProjectConfidence } from './confidence.js';
import type { ConfidenceData } from './confidence.js';
import { logLLMCall, extractAnthropicUsage } from './llm-logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, '..', '..');
const PROJECTS_ROOT = process.env.PROJECTS_ROOT || join(BACKEND_DIR, 'projects');
const NODE_MODULES_DIR = join(BACKEND_DIR, 'node_modules');
const LOGO_PATH = join(BACKEND_DIR, 'assets', 'logo-white.png');
const PPTX_MASTER_PATH = join(__dirname, '..', 'templates', 'pptx-master.js');

// =============================================================================
// EXPORT CONCURRENCY GUARD
// =============================================================================

const activeExports = new Map<string, string>(); // projectId -> export description

/**
 * Check if an export is currently active for the given project.
 */
export function isExportActive(projectId: string): boolean {
  return activeExports.has(projectId);
}

/**
 * Get the active export description for a project, or null if none.
 */
export function getActiveExportDescription(projectId: string): string | null {
  return activeExports.get(projectId) ?? null;
}

/** @internal — Test helpers for export concurrency tests */
export function _testSetExportActive(projectId: string, description: string): void {
  activeExports.set(projectId, description);
}
export function _testClearExportActive(projectId: string): void {
  activeExports.delete(projectId);
}

/** Map export artifact type keys (underscores) to file-system keys (hyphens) */
export const ARTIFACT_DISPLAY_NAMES: Record<string, string> = {
  swot: 'SWOT Analysis',
  pestle: 'PESTLE Analysis',
  'five-forces': "Porter's Five Forces",
  positioning: 'Competitive Positioning Matrix',
  pricing: 'Pricing & Feature Comparison',
  'executive-summary': 'Executive Summary',
  'battle-card': 'Battle Card',
};

// Lazy init — dotenv hasn't loaded yet at import time
let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic({ timeout: 5 * 60 * 1000 });
  }
  return _anthropic;
}

/** Resolve the canonical project directory */
function resolveProjectRoot(projectId: string): string {
  const root = process.env.PROJECTS_ROOT || PROJECTS_ROOT;
  return join(root, projectId);
}

/**
 * Generate a DOCX or PPTX export of a completed artifact.
 *
 * 1. Reads the artifact markdown from disk
 * 2. Loads prompt templates and substitutes variables
 * 3. Calls Claude to generate a Node.js script
 * 4. Executes the script in a temp directory
 * 5. Verifies output file and moves to exports directory
 */
export async function exportArtifact(
  projectId: string,
  artifactType: string,
  format: 'docx' | 'pptx',
): Promise<{ filename: string; filepath: string }> {
  // Validate artifact type
  if (!ARTIFACT_DISPLAY_NAMES[artifactType]) {
    throw new Error(`Unknown artifact type: ${artifactType}`);
  }

  activeExports.set(projectId, `${artifactType}.${format}`);
  try {
    // Get project info from DB
    const project = prepare(
      'SELECT name, root_path as rootPath FROM projects WHERE id = ?'
    ).get(projectId) as { name: string; rootPath: string } | undefined;

    if (!project) {
      throw new Error('Project not found');
    }

    const projectRoot = resolveProjectRoot(projectId);
    const artifactPath = join(projectRoot, 'artifacts', `${artifactType}.md`);

    if (!existsSync(artifactPath)) {
      throw new Error(`Artifact file not found: ${artifactType}.md`);
    }

    // Replace em-dashes with ', ' to prevent encoding issues in generated scripts
    const artifactContent = readFileSync(artifactPath, 'utf-8').replace(/\u2014/g, ', ');

    // Prepare output directory
    const exportsDir = join(projectRoot, 'exports');
    if (!existsSync(exportsDir)) {
      mkdirSync(exportsDir, { recursive: true });
    }

    const filename = `${artifactType}.${format}`;
    const outputPath = resolve(join(exportsDir, filename));

    // Load prompt templates
    const systemPromptFile = format === 'docx' ? 'export-docx-system.md' : 'export-pptx-system.md';
    const systemPrompt = loadPrompt(systemPromptFile);
    let userPrompt = loadPrompt('export-user.md');

    // Substitute template variables
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const displayName = ARTIFACT_DISPLAY_NAMES[artifactType] || artifactType;

    // Write content to a temp file so the generated script reads it at runtime
    // (avoids string escaping issues when content contains \, ", backticks, etc.)
    const contentTempDir = join('/tmp', `strategos-export-content-${randomUUID()}`);
    mkdirSync(contentTempDir, { recursive: true });
    const contentFilePath = join(contentTempDir, 'content.md');
    writeFileSync(contentFilePath, artifactContent, 'utf-8');

    userPrompt = userPrompt
      .replace(/\{\{FORMAT\}\}/g, format)
      .replace(/\{\{PROJECT_TITLE\}\}/g, project.name)
      .replace(/\{\{ARTIFACT_TYPE\}\}/g, displayName)
      .replace(/\{\{DATE\}\}/g, today)
      .replace(/\{\{OUTPUT_PATH\}\}/g, outputPath)
      .replace(/\{\{LOGO_PATH\}\}/g, LOGO_PATH)
      .replace(/\{\{CONTENT_PATH\}\}/g, contentFilePath)
      .replace(/\{\{CONTENT\}\}/g, artifactContent);

    console.log(`[export] Calling Claude for ${artifactType} → ${format} (project ${projectId})`);

    // Call Claude to generate the script (no thinking — prescriptive code generation)
    const exportCallStart = Date.now();
    const response = await getAnthropic().messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 16000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const exportCallDuration = Date.now() - exportCallStart;

    try { logLLMCall({ project_id: projectId, phase: 'export', model: 'claude-opus-4-6', provider: 'anthropic', ...extractAnthropicUsage(response), duration_ms: exportCallDuration }); } catch { /* non-blocking */ }

    let script = response.content
      .filter(block => block.type === 'text')
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('');

    // Strip markdown fences if present
    script = stripMarkdownFences(script);

    // Validate script references the expected package (or the master template for PPTX)
    if (format === 'docx') {
      if (!script.includes('docx')) {
        throw new Error('Generated script does not reference expected package: docx');
      }
    } else {
      if (!script.includes('pptxgenjs') && !script.includes('pptx-master')) {
        throw new Error('Generated script does not reference pptxgenjs or pptx-master module');
      }
    }

    // Build list of extra files to copy into the sandbox for PPTX exports
    const sandboxFiles: Array<{ src: string; destName: string }> = [];
    if (format === 'pptx') {
      sandboxFiles.push({ src: PPTX_MASTER_PATH, destName: 'pptx-master.js' });
      if (existsSync(LOGO_PATH)) {
        sandboxFiles.push({ src: LOGO_PATH, destName: 'logo-white.png' });
      }
      // Inject confidence data for trust layer rendering
      try {
        const confidence = getProjectConfidence(projectId, PROJECTS_ROOT);
        if (confidence) {
          const confPath = join(contentTempDir, 'confidence.json');
          writeFileSync(confPath, JSON.stringify(confidence, null, 2), 'utf-8');
          sandboxFiles.push({ src: confPath, destName: 'confidence.json' });
        }
      } catch { /* confidence is optional */ }
    }

    // Execute script
    try {
      await executeScript(script, outputPath, sandboxFiles);
    } catch (firstError) {
      console.warn(`[export] First attempt failed, retrying with error context...`);

      // Retry: send error back to Claude
      const retryStart = Date.now();
      const retryResponse = await getAnthropic().messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 16000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: script },
          {
            role: 'user',
            content: `The script above failed with this error:\n\n${(firstError as Error).message}\n\nFix the error and return the complete corrected script. Return ONLY the script — no explanation.`,
          },
        ],
      });
      const retryDuration = Date.now() - retryStart;

      try { logLLMCall({ project_id: projectId, phase: 'export', model: 'claude-opus-4-6', provider: 'anthropic', ...extractAnthropicUsage(retryResponse), duration_ms: retryDuration }); } catch { /* non-blocking */ }

      let retryScript = retryResponse.content
        .filter(block => block.type === 'text')
        .map(block => (block.type === 'text' ? block.text : ''))
        .join('');

      retryScript = stripMarkdownFences(retryScript);

      await executeScript(retryScript, outputPath, sandboxFiles);
    }

    // Clean up content temp file
    try { rmSync(contentTempDir, { recursive: true, force: true }); } catch { /* ignore */ }

    // Update last_exported_at on the artifact row
    prepare(`
      UPDATE selected_artifacts SET last_exported_at = datetime('now')
      WHERE project_id = ? AND artifact_type = ?
    `).run(projectId, artifactType);

    console.log(`[export] Successfully generated ${filename} for project ${projectId}`);
    return { filename, filepath: outputPath };
  } finally {
    activeExports.delete(projectId);
  }
}

/**
 * Execute a generated Node.js script in a temp directory.
 * sandboxFiles: optional array of extra files to copy into the sandbox (e.g. pptx-master.js, logo).
 */
async function executeScript(
  script: string,
  expectedOutputPath: string,
  sandboxFiles: Array<{ src: string; destName: string }> = [],
  timeoutMs: number = 60000,
): Promise<void> {
  const tempDir = join('/tmp', `strategos-export-${randomUUID()}`);
  mkdirSync(tempDir, { recursive: true });

  // Copy extra files into sandbox (template module, logo, etc.)
  for (const file of sandboxFiles) {
    if (existsSync(file.src)) {
      copyFileSync(file.src, join(tempDir, file.destName));
    }
  }

  const scriptPath = join(tempDir, 'generate.js');
  writeFileSync(scriptPath, script, 'utf-8');

  // Ensure the output directory exists
  const outputDir = dirname(expectedOutputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        'node',
        [scriptPath],
        {
          timeout: timeoutMs,
          env: {
            ...process.env,
            NODE_PATH: NODE_MODULES_DIR,
          },
          cwd: tempDir,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            const errorMsg = stderr || error.message;
            reject(new Error(`Script execution failed: ${errorMsg}`));
            return;
          }
          resolve();
        },
      );
    });

    // Verify output file exists and is non-empty
    if (!existsSync(expectedOutputPath)) {
      throw new Error(`Output file was not created at ${expectedOutputPath}`);
    }

    const stats = readFileSync(expectedOutputPath);
    if (stats.length === 0) {
      unlinkSync(expectedOutputPath);
      throw new Error('Output file is empty');
    }
  } finally {
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

// =============================================================================
// COMPETITIVE PACKET ASSEMBLY
// =============================================================================

/** A single section in the packet manifest */
export interface PacketSection {
  artifactType: string;
  sectionTitle: string;
  required: boolean;
  dividerFraming: string;
}

/** Configurable packet manifest */
export interface PacketManifest {
  sections: PacketSection[];
  includeClosingSlide: boolean;
  includeSourcesSlide: boolean;
}

/** Section configuration map -- divider content for each artifact type */
export const SECTION_CONFIG: Record<string, { name: string; framing: string }> = {
  'executive-summary': {
    name: 'Executive Overview',
    framing: 'The following section provides the strategic verdict, key findings, and recommended actions derived from verified competitive intelligence.',
  },
  positioning: {
    name: 'Competitive Positioning',
    framing: 'Building on the strategic overview, this section maps where each competitor stands on enterprise readiness and growth momentum.',
  },
  swot: {
    name: 'Strategic Analysis',
    framing: 'With competitive positions established, this section examines the strengths, weaknesses, opportunities, and threats shaping the landscape.',
  },
  pricing: {
    name: 'Pricing & Packaging',
    framing: 'Strategic positioning is ultimately tested at the point of purchase; this section compares how each competitor packages and prices its platform.',
  },
  pestle: {
    name: 'Industry & Regulatory Context',
    framing: 'Beyond company-level competition, this section examines the macro forces -- political, economic, social, technological, legal, and environmental -- shaping the market.',
  },
  'five-forces': {
    name: 'Competitive Forces',
    framing: 'This section analyzes the structural profitability and competitive intensity of the market through the lens of Porter\'s Five Forces framework.',
  },
  'battle-card': {
    name: 'Competitive Quick-Reference',
    framing: 'The following battle cards distill competitive intelligence into actionable quick-reference guides for sales and strategy teams.',
  },
};

/** Default packet manifest -- narrative spec ordering */
export const DEFAULT_PACKET_MANIFEST: PacketManifest = {
  sections: [
    {
      artifactType: 'executive-summary',
      sectionTitle: SECTION_CONFIG['executive-summary'].name,
      required: true,
      dividerFraming: SECTION_CONFIG['executive-summary'].framing,
    },
    {
      artifactType: 'positioning',
      sectionTitle: SECTION_CONFIG['positioning'].name,
      required: true,
      dividerFraming: SECTION_CONFIG['positioning'].framing,
    },
    {
      artifactType: 'swot',
      sectionTitle: SECTION_CONFIG['swot'].name,
      required: true,
      dividerFraming: SECTION_CONFIG['swot'].framing,
    },
    {
      artifactType: 'battle-card',
      sectionTitle: SECTION_CONFIG['battle-card'].name,
      required: false,
      dividerFraming: SECTION_CONFIG['battle-card'].framing,
    },
    {
      artifactType: 'pricing',
      sectionTitle: SECTION_CONFIG['pricing'].name,
      required: true,
      dividerFraming: SECTION_CONFIG['pricing'].framing,
    },
  ],
  includeClosingSlide: true,
  includeSourcesSlide: true,
};

/**
 * Extract competitive set (list of competitor names) from the research brief.
 * Falls back to positioning artifact H2 headers, then empty string.
 */
function extractCompetitorList(projectRoot: string): string {
  // Try research brief first
  const briefPath = join(projectRoot, 'collaboration', 'research-brief.md');
  if (existsSync(briefPath)) {
    const brief = readFileSync(briefPath, 'utf-8');
    // Look for parenthetical list after "vs" or "competitors"
    const parenMatch = brief.match(/(?:vs\.?|versus|competitors?)\s*\(([^)]+)\)/i);
    if (parenMatch) {
      return parenMatch[1].trim();
    }
    // Look for comma-separated names after "vs" on the same line
    const vsMatch = brief.match(/vs\.?\s+(.+?)(?:\.|$)/im);
    if (vsMatch) {
      return vsMatch[1].trim();
    }
  }

  // Try positioning artifact H2 headers
  const posPath = join(projectRoot, 'artifacts', 'positioning.md');
  if (existsSync(posPath)) {
    const posContent = readFileSync(posPath, 'utf-8');
    const h2s = posContent.match(/^## (.+)$/gm);
    if (h2s && h2s.length > 1) {
      return h2s.map(h => h.replace(/^## /, '')).slice(0, 8).join(', ');
    }
  }

  return '';
}

/**
 * Extract verification summary for the sources slide.
 */
function extractVerificationSummary(projectRoot: string): {
  claimCount: string;
  qualityGate: string;
  evidenceRate: string;
  verificationDate: string;
} {
  const defaults = {
    claimCount: 'N/A',
    qualityGate: 'N/A',
    evidenceRate: 'N/A',
    verificationDate: 'N/A',
  };

  const reportPath = join(projectRoot, 'verification', 'verification_report.md');
  if (!existsSync(reportPath)) return defaults;

  const report = readFileSync(reportPath, 'utf-8');

  // Extract claim count
  const claimMatch = report.match(/Claim Groups[:\s|]*(\d+)/i);
  if (claimMatch) defaults.claimCount = claimMatch[1];

  // Extract quality gate status
  const gateMatch = report.match(/(STRONG_SOURCE_QUALITY|REVIEW_RECOMMENDED)/i);
  if (gateMatch) defaults.qualityGate = gateMatch[1];

  // Extract evidence rate
  const rateMatch = report.match(/(\d+\.?\d*)\s*%.*evidence/i) || report.match(/evidence.*?(\d+\.?\d*)\s*%/i);
  if (rateMatch) defaults.evidenceRate = `${rateMatch[1]}%`;

  // Extract verification date
  const dateMatch = report.match(/Generated:?\s*(.+)/i);
  if (dateMatch) defaults.verificationDate = dateMatch[1].trim();

  return defaults;
}

/**
 * Generate a complete Competitive Packet PPTX from all default-tier artifacts.
 *
 * 1. Reads project metadata and artifact markdown from disk
 * 2. Constructs the Claude prompt with all artifact content
 * 3. Calls Claude to generate a pptxgenjs script
 * 4. Executes the script with 180s timeout
 * 5. Returns the file path
 */
/** Options for customer-ready packet export */
export interface PacketExportOptions {
  customerReady?: boolean;
  excludeSections?: string[];
  includeWarnings?: boolean;
}

export async function generatePacket(
  projectId: string,
  manifest: PacketManifest = DEFAULT_PACKET_MANIFEST,
  options: PacketExportOptions = {},
): Promise<{ filename: string; filepath: string }> {
  const startTime = Date.now();

  // Get project info from DB
  const project = prepare(
    'SELECT name, root_path as rootPath FROM projects WHERE id = ?'
  ).get(projectId) as { name: string; rootPath: string } | undefined;

  if (!project) {
    throw new Error('Project not found');
  }

  activeExports.set(projectId, 'competitive-packet');
  try {
    const projectRoot = resolveProjectRoot(projectId);

    // Apply section filtering when excludeSections is provided
    if (options.excludeSections && options.excludeSections.length > 0) {
      manifest = {
        ...manifest,
        sections: manifest.sections.filter(
          s => !options.excludeSections!.includes(s.artifactType)
        ),
      };
    }

    // Collect artifact markdown for each manifest section
    const artifactSections: Array<{
      artifactType: string;
      sectionTitle: string;
      dividerFraming: string;
      content: string;
    }> = [];

    const missingRequired: string[] = [];

    for (const section of manifest.sections) {
      const artifactPath = join(projectRoot, 'artifacts', `${section.artifactType}.md`);
      if (!existsSync(artifactPath)) {
        if (section.required) {
          const displayName = ARTIFACT_DISPLAY_NAMES[section.artifactType] || section.artifactType;
          missingRequired.push(displayName);
        }
        continue;
      }

      const rawContent = readFileSync(artifactPath, 'utf-8');
      if (rawContent.trim().length === 0) {
        if (section.required) {
          const displayName = ARTIFACT_DISPLAY_NAMES[section.artifactType] || section.artifactType;
          missingRequired.push(displayName);
        }
        continue;
      }

      // Strip em-dashes
      const content = rawContent.replace(/\u2014/g, ', ');
      artifactSections.push({
        artifactType: section.artifactType,
        sectionTitle: section.sectionTitle,
        dividerFraming: section.dividerFraming,
        content,
      });
    }

    if (missingRequired.length > 0) {
      throw new Error(`Cannot generate packet: missing required artifacts: ${missingRequired.join(', ')}`);
    }

    if (artifactSections.length === 0) {
      throw new Error('No completed artifacts available for packet assembly.');
    }

    // Extract metadata
    const competitorList = extractCompetitorList(projectRoot);
    const verificationSummary = extractVerificationSummary(projectRoot);
    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Prepare output
    const exportsDir = join(projectRoot, 'exports');
    if (!existsSync(exportsDir)) {
      mkdirSync(exportsDir, { recursive: true });
    }
    const filename = 'competitive-packet.pptx';
    const outputPath = resolve(join(exportsDir, filename));

    // Write artifact content to temp files (avoids string escaping issues)
    const contentTempDir = join('/tmp', `strategos-packet-content-${randomUUID()}`);
    mkdirSync(contentTempDir, { recursive: true });

    const sectionFiles: Array<{ artifactType: string; filePath: string; sectionTitle: string; dividerFraming: string }> = [];
    for (const section of artifactSections) {
      const filePath = join(contentTempDir, `${section.artifactType}.md`);
      writeFileSync(filePath, section.content, 'utf-8');
      sectionFiles.push({
        artifactType: section.artifactType,
        filePath,
        sectionTitle: section.sectionTitle,
        dividerFraming: section.dividerFraming,
      });
    }

    // Load system prompt
    const systemPrompt = loadPrompt('export-packet-system.md');

    // Build user prompt
    const manifestJson = JSON.stringify(
      sectionFiles.map(s => ({
        artifactType: s.artifactType,
        sectionTitle: s.sectionTitle,
        dividerFraming: s.dividerFraming,
        contentFilePath: s.filePath,
      })),
      null,
      2,
    );

    const userPrompt = `## Project Metadata
Title: ${project.name}
Date: ${today}
Competitors: ${competitorList || 'Not specified'}

## Output Path
${outputPath}

## Slide Manifest (ordered sections)
${manifestJson}

## Verification Summary (for Sources slide)
- Claims verified: ${verificationSummary.claimCount}
- Quality gate: ${verificationSummary.qualityGate}
- Evidence rate: ${verificationSummary.evidenceRate}
- Verification date: ${verificationSummary.verificationDate}

## Artifact Content

${artifactSections.map(s => `### Section: ${s.sectionTitle} (${s.artifactType})
File: ${join(contentTempDir, `${s.artifactType}.md`)}

${s.content}
`).join('\n---\n\n')}

## Instructions
Write a complete Node.js script that generates the competitive packet PPTX at the output path above.
The script MUST read each artifact's content from the file paths specified in the manifest (do NOT embed content as string literals).
Follow the slide sequence rules from your system prompt exactly.
Return ONLY the script -- no explanation, no markdown fences.

// OUTPUT: ${outputPath}`;

    console.log(`[packet] Calling Claude for competitive packet (project ${projectId})`);
    const apiStart = Date.now();

    // Call Claude to generate the script (no thinking -- prescriptive code generation)
    const response = await getAnthropic().messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 32000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const apiDurationMs = Date.now() - apiStart;
    const apiDuration = (apiDurationMs / 1000).toFixed(1);
    console.log(`[packet] Claude API call took ${apiDuration}s`);

    try { logLLMCall({ project_id: projectId, phase: 'export', model: 'claude-opus-4-6', provider: 'anthropic', ...extractAnthropicUsage(response), duration_ms: apiDurationMs }); } catch { /* non-blocking */ }

    let script = response.content
      .filter(block => block.type === 'text')
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('');

    script = stripMarkdownFences(script);

    // Validate script references the master template
    if (!script.includes('pptxgenjs') && !script.includes('pptx-master')) {
      throw new Error('Generated packet script does not reference pptxgenjs or pptx-master module');
    }

    const scriptLines = script.split('\n').length;
    console.log(`[packet] Generated script: ${scriptLines} lines`);

    // Sandbox files
    const sandboxFiles: Array<{ src: string; destName: string }> = [
      { src: PPTX_MASTER_PATH, destName: 'pptx-master.js' },
    ];
    if (existsSync(LOGO_PATH)) {
      sandboxFiles.push({ src: LOGO_PATH, destName: 'logo-white.png' });
    }

    // Inject confidence data for trust layer rendering
    try {
      const confidence = getProjectConfidence(projectId, PROJECTS_ROOT);
      if (confidence) {
        const confData: Record<string, unknown> = { ...confidence };
        if (options.customerReady) {
          confData.customerReadyMode = true;
        }
        if (options.includeWarnings) {
          confData.includeWarnings = true;
        }
        const confPath = join(contentTempDir, 'confidence.json');
        writeFileSync(confPath, JSON.stringify(confData, null, 2), 'utf-8');
        sandboxFiles.push({ src: confPath, destName: 'confidence.json' });
      }
    } catch { /* confidence is optional */ }

    // Execute with 180s timeout
    const execStart = Date.now();
    try {
      await executeScript(script, outputPath, sandboxFiles, 180000);
    } catch (firstError) {
      console.warn(`[packet] First attempt failed, retrying with error context...`);

      // Retry: send error back to Claude
      const packetRetryStart = Date.now();
      const retryResponse = await getAnthropic().messages.create({
        model: 'claude-opus-4-6',
        max_tokens: 32000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: script },
          {
            role: 'user',
            content: `The script above failed with this error:\n\n${(firstError as Error).message}\n\nFix the error and return the complete corrected script. Return ONLY the script -- no explanation.`,
          },
        ],
      });
      const packetRetryDuration = Date.now() - packetRetryStart;

      try { logLLMCall({ project_id: projectId, phase: 'export', model: 'claude-opus-4-6', provider: 'anthropic', ...extractAnthropicUsage(retryResponse), duration_ms: packetRetryDuration }); } catch { /* non-blocking */ }

      let retryScript = retryResponse.content
        .filter(block => block.type === 'text')
        .map(block => (block.type === 'text' ? block.text : ''))
        .join('');

      retryScript = stripMarkdownFences(retryScript);

      await executeScript(retryScript, outputPath, sandboxFiles, 180000);
    }

    const execDuration = ((Date.now() - execStart) / 1000).toFixed(1);
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[packet] Script execution took ${execDuration}s, total ${totalDuration}s`);

    // Clean up content temp files
    try { rmSync(contentTempDir, { recursive: true, force: true }); } catch { /* ignore */ }

    console.log(`[packet] Successfully generated ${filename} for project ${projectId}`);
    return { filename, filepath: outputPath };
  } finally {
    activeExports.delete(projectId);
  }
}

/**
 * Strip leading/trailing markdown code fences from Claude's response.
 */
function stripMarkdownFences(text: string): string {
  let result = text.trim();

  // Remove leading fence (```javascript, ```js, or just ```)
  if (result.startsWith('```')) {
    const firstNewline = result.indexOf('\n');
    if (firstNewline !== -1) {
      result = result.slice(firstNewline + 1);
    }
  }

  // Remove trailing fence
  if (result.endsWith('```')) {
    result = result.slice(0, -3).trimEnd();
  }

  return result;
}
