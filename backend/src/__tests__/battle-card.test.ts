/**
 * Battle card artifact type tests.
 *
 * Validates:
 * - 'battle-card' is accepted by Zod schema
 * - Prompt template exists with correct structure
 * - ARTIFACT_TYPES registry includes battle-card
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { selectArtifactsSchema, exportBodySchema } from '../middleware/schemas.js';
import { ARTIFACT_TYPES } from '../services/analysis.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '../../../prompts');

describe('Battle Card Artifact Type', () => {

  describe('Zod schema validation', () => {

    it("'battle-card' is accepted by selectArtifactsSchema", () => {
      const result = selectArtifactsSchema.safeParse({ types: ['battle-card'] });
      expect(result.success).toBe(true);
    });

    it("'battle-card' is accepted alongside other types", () => {
      const result = selectArtifactsSchema.safeParse({ types: ['swot', 'battle-card', 'pestle'] });
      expect(result.success).toBe(true);
    });

    it("'battle-card' is accepted by exportBodySchema", () => {
      const result = exportBodySchema.safeParse({ artifactType: 'battle-card', format: 'docx' });
      expect(result.success).toBe(true);
    });

    it('invalid artifact type is still rejected', () => {
      const result = selectArtifactsSchema.safeParse({ types: ['not-a-type'] });
      expect(result.success).toBe(false);
    });
  });

  describe('ARTIFACT_TYPES registry', () => {

    it("includes 'battle-card' with correct prompt file", () => {
      expect(ARTIFACT_TYPES['battle-card']).toBeDefined();
      expect(ARTIFACT_TYPES['battle-card'].promptFile).toBe('artifact-battle-card.md');
      expect(ARTIFACT_TYPES['battle-card'].label).toBe('Battle Card');
    });
  });

  describe('Prompt template: artifact-battle-card.md', () => {
    const promptPath = resolve(PROMPTS_DIR, 'artifact-battle-card.md');
    let content: string;

    it('exists and is readable', () => {
      content = readFileSync(promptPath, 'utf-8');
      expect(content.length).toBeGreaterThan(500);
    });

    it('contains the ## User Prompt Template delimiter', () => {
      if (!content) content = readFileSync(promptPath, 'utf-8');
      expect(content).toContain('## User Prompt Template');
    });

    it('contains all seven template variables in the user prompt section', () => {
      if (!content) content = readFileSync(promptPath, 'utf-8');
      const markerIndex = content.indexOf('## User Prompt Template');
      const userSection = content.slice(markerIndex);

      const requiredVars = [
        '{{PROJECT_TITLE}}',
        '{{DATE}}',
        '{{DECISION_CONTEXT}}',
        '{{RESEARCH_BRIEF}}',
        '{{CONSOLIDATED_RESEARCH}}',
        '{{VERIFICATION_REPORT}}',
        '{{STRATEGIC_ASSESSMENT}}',
      ];

      for (const v of requiredVars) {
        expect(userSection).toContain(v);
      }
    });

    it('contains em-dash prohibition in the system prompt', () => {
      if (!content) content = readFileSync(promptPath, 'utf-8');
      expect(content).toMatch(/em-dash/i);
      expect(content).toMatch(/[Nn]ever use em-dashes/);
    });

    it('specifies the five output sections', () => {
      if (!content) content = readFileSync(promptPath, 'utf-8');
      expect(content).toContain('At a Glance');
      expect(content).toContain('Key Differentiators');
      expect(content).toContain('Talk Tracks');
      expect(content).toContain('Objection Handling');
      expect(content).toContain('Pricing Quick Compare');
    });

    it('contains verification-aware citation instructions', () => {
      if (!content) content = readFileSync(promptPath, 'utf-8');
      expect(content).toContain('Verified');
      expect(content).toContain('Conflicting Evidence');
      expect(content).toContain('Unsupported Claim');
      expect(content).toContain('Insufficient Evidence');
    });
  });
});
