/**
 * Provider-specific prompt tests.
 *
 * Validates that buildGeminiResearchQuery() produces a natural-language
 * research query distinct from the structured template used by Kimi,
 * and that buildResearchPrompts() remains unchanged (regression).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildResearchPrompts, buildGeminiResearchQuery, buildGeminiExpansionPrompt, parseBrief } from '../services/research.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '../../../prompts');

// A realistic brief fixture for testing
const SAMPLE_BRIEF = `# AI Coding Assistants Research

**Type:** Competitive Intelligence
**Decision being informed:** Evaluating competitive positioning of GitHub Copilot in the AI coding tools market
**Timeline:** Q1 2026
**Stakeholders:** Product leadership, strategy team

## Primary Target

**Entity:** GitHub Copilot
**Focus areas:** Market position, pricing strategy, enterprise adoption, technical architecture

## Competitive Set

| Competitor | Tier | Rationale |
|-----------|------|-----------|
| Cursor | Direct | IDE-integrated AI coding, rapid growth |
| Sourcegraph Cody | Direct | Enterprise code intelligence + AI |
| Amazon CodeWhisperer | Adjacent | Cloud-integrated coding assistant |

## Geographic Scope

North America and Europe

## Temporal Scope

January 2025 – present

## Key Intelligence Questions

1. How has Copilot's market share evolved in the last 12 months?
2. What is Copilot's enterprise pricing vs competitors?
3. How do users rate Copilot vs alternatives in independent reviews?
4. What technical moat does Copilot have (model, data, integrations)?

## Exclusions

- Open-source local LLM tools (Ollama, LM Studio)
- Academic research on code generation
`;

const briefData = parseBrief(SAMPLE_BRIEF);

describe('Provider-Specific Prompts', () => {

  describe('buildGeminiResearchQuery()', () => {

    it('returns a non-empty string with all template vars substituted', () => {
      const query = buildGeminiResearchQuery(briefData);
      expect(query.length).toBeGreaterThan(100);
      // No unsubstituted template variables should remain
      expect(query).not.toMatch(/\{\{[A-Z_]+\}\}/);
    });

    it('does NOT contain structured section headers like SWOT, PESTLE, or dossier format', () => {
      const query = buildGeminiResearchQuery(briefData);
      expect(query).not.toMatch(/\bSWOT\b/i);
      expect(query).not.toMatch(/\bPESTLE\b/i);
      expect(query).not.toMatch(/\bFive Forces\b/i);
      expect(query).not.toMatch(/\bOvert Profile\b/i);
      expect(query).not.toMatch(/\bCovert Signals\b/i);
      expect(query).not.toMatch(/\bExecutive Threat Brief\b/i);
    });

    it('contains investigation topics for depth', () => {
      const query = buildGeminiResearchQuery(briefData);
      // Should list specific investigation areas
      expect(query).toMatch(/revenue trajectory/i);
      expect(query).toMatch(/pricing structures/i);
      expect(query).toMatch(/leadership changes/i);
    });

    it('contains data specificity instruction', () => {
      const query = buildGeminiResearchQuery(briefData);
      // Should ask for specific data points, not general characterizations
      expect(query).toMatch(/specific (data points|figures)/i);
      expect(query).toMatch(/conflicting information/i);
    });

    it('contains anti-compression directive', () => {
      const query = buildGeminiResearchQuery(briefData);
      expect(query).toMatch(/Do not summarize/i);
      expect(query).toMatch(/thorough.*evidence-rich|evidence-rich.*raw material/i);
    });

    it('contains the primary target from the brief', () => {
      const query = buildGeminiResearchQuery(briefData);
      expect(query).toContain('GitHub Copilot');
    });

    it('contains key questions from the brief', () => {
      const query = buildGeminiResearchQuery(briefData);
      expect(query).toContain('market share');
      expect(query).toContain('enterprise pricing');
    });

    it('contains the competitive set from the brief', () => {
      const query = buildGeminiResearchQuery(briefData);
      expect(query).toContain('Cursor');
      expect(query).toContain('Sourcegraph Cody');
    });

    it('contains geographic scope from the brief', () => {
      const query = buildGeminiResearchQuery(briefData);
      expect(query).toContain('North America and Europe');
    });
  });

  describe('buildResearchPrompts() — regression', () => {

    it('returns systemPrompt and userPrompt as non-empty strings', () => {
      const { systemPrompt, userPrompt } = buildResearchPrompts(briefData);
      expect(systemPrompt.length).toBeGreaterThan(100);
      expect(userPrompt.length).toBeGreaterThan(100);
    });

    it('systemPrompt contains Research Depth Expectations section', () => {
      const { systemPrompt } = buildResearchPrompts(briefData);
      expect(systemPrompt).toContain('Research Depth Expectations');
    });

    it('userPrompt contains all 13 substituted template variables', () => {
      const { userPrompt } = buildResearchPrompts(briefData);
      // After substitution, no {{VAR}} should remain in the body
      // (meta comment lines with > prefix are OK)
      const bodyLines = userPrompt.split('\n').filter(line => !line.trimStart().startsWith('>'));
      const body = bodyLines.join('\n');
      // Should contain the brief data
      expect(body).toContain('GitHub Copilot');
      expect(body).toContain('Competitive Intelligence');
      // No leftover template vars (except possibly {{DATE}} replacement which is dynamic)
      const remaining = body.match(/\{\{[A-Z_]+\}\}/g) || [];
      expect(remaining.length).toBe(0);
    });

    it('userPrompt contains structured sections (RESEARCH ASSIGNMENT, ACCEPTANCE CHECKLIST)', () => {
      const { userPrompt } = buildResearchPrompts(briefData);
      expect(userPrompt).toContain('## RESEARCH ASSIGNMENT');
      expect(userPrompt).toContain('## ACCEPTANCE CHECKLIST');
      expect(userPrompt).toContain('## KEY INTELLIGENCE QUESTIONS');
    });
  });

  describe('All prompt functions handle the same brief input without errors', () => {

    it('all three produce valid output from the same BriefData', () => {
      expect(() => buildResearchPrompts(briefData)).not.toThrow();
      expect(() => buildGeminiResearchQuery(briefData)).not.toThrow();
      expect(() => buildGeminiExpansionPrompt(briefData)).not.toThrow();
    });

    it('Gemini query is structurally different from Kimi user prompt', () => {
      const { userPrompt } = buildResearchPrompts(briefData);
      const geminiQuery = buildGeminiResearchQuery(briefData);

      // Kimi uses structured sections, Gemini does not
      expect(userPrompt).toContain('## RESEARCH ASSIGNMENT');
      expect(geminiQuery).not.toContain('## RESEARCH ASSIGNMENT');

      expect(userPrompt).toContain('## ACCEPTANCE CHECKLIST');
      expect(geminiQuery).not.toContain('## ACCEPTANCE CHECKLIST');
    });
  });

  describe('buildGeminiExpansionPrompt()', () => {

    it('returns a non-empty string with all template vars substituted', () => {
      const prompt = buildGeminiExpansionPrompt(briefData);
      expect(prompt.length).toBeGreaterThan(100);
      expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
    });

    it('contains the primary target from the brief', () => {
      const prompt = buildGeminiExpansionPrompt(briefData);
      expect(prompt).toContain('GitHub Copilot');
    });

    it('contains key questions from the brief', () => {
      const prompt = buildGeminiExpansionPrompt(briefData);
      expect(prompt).toContain('market share');
      expect(prompt).toContain('enterprise pricing');
    });

    it('contains the competitive set from the brief', () => {
      const prompt = buildGeminiExpansionPrompt(briefData);
      expect(prompt).toContain('Cursor');
      expect(prompt).toContain('Sourcegraph Cody');
    });

    it('contains anti-compression directive', () => {
      const prompt = buildGeminiExpansionPrompt(briefData);
      expect(prompt).toMatch(/Do not summarize/i);
    });

    it('references the previous interaction context', () => {
      const prompt = buildGeminiExpansionPrompt(briefData);
      expect(prompt).toMatch(/previous interaction/i);
    });
  });

  describe('gemini-expansion.md template file', () => {

    it('exists and is a valid prompt file', () => {
      const content = readFileSync(resolve(PROMPTS_DIR, 'gemini-expansion.md'), 'utf-8');
      expect(content.length).toBeGreaterThan(100);
    });

    it('uses only the expected template variables', () => {
      const content = readFileSync(resolve(PROMPTS_DIR, 'gemini-expansion.md'), 'utf-8');
      const vars = content.match(/\{\{([A-Z_]+)\}\}/g) || [];
      const uniqueVars = [...new Set(vars)];
      const allowedVars = [
        '{{PRIMARY_TARGET}}', '{{COMPETITIVE_SET}}', '{{KEY_QUESTIONS}}',
        '{{DECISION_CONTEXT}}',
      ];
      for (const v of uniqueVars) {
        expect(allowedVars).toContain(v);
      }
    });

    it('contains em-dash prohibition', () => {
      const content = readFileSync(resolve(PROMPTS_DIR, 'gemini-expansion.md'), 'utf-8');
      expect(content).toMatch(/em-dash/i);
    });
  });

  describe('gemini-research.md template file', () => {

    it('exists and is a valid prompt file', () => {
      const content = readFileSync(resolve(PROMPTS_DIR, 'gemini-research.md'), 'utf-8');
      expect(content.length).toBeGreaterThan(100);
    });

    it('uses only the expected template variables', () => {
      const content = readFileSync(resolve(PROMPTS_DIR, 'gemini-research.md'), 'utf-8');
      const vars = content.match(/\{\{([A-Z_]+)\}\}/g) || [];
      const uniqueVars = [...new Set(vars)];
      // Should use a subset of the brief variables
      const allowedVars = [
        '{{PRIMARY_TARGET}}', '{{COMPETITIVE_SET}}', '{{KEY_QUESTIONS}}',
        '{{GEOGRAPHIC_SCOPE}}', '{{TIMEFRAME}}', '{{DECISION_CONTEXT}}',
        '{{FOCUS_AREAS}}',
      ];
      for (const v of uniqueVars) {
        expect(allowedVars).toContain(v);
      }
    });

    it('does NOT contain structured output format constraints', () => {
      const content = readFileSync(resolve(PROMPTS_DIR, 'gemini-research.md'), 'utf-8');
      // Should not prescribe a specific report structure
      expect(content).not.toContain('## RESEARCH ASSIGNMENT');
      expect(content).not.toContain('## ACCEPTANCE CHECKLIST');
      expect(content).not.toMatch(/organize your (response|output|report) as/i);
    });
  });

  // ===========================================================================
  // Delta Prompt Tests (Session 35, EP-07)
  // ===========================================================================

  describe('research-delta.md template file', () => {

    it('exists and contains {{REFERENCE_DATE}} variable', () => {
      const content = readFileSync(resolve(PROMPTS_DIR, 'research-delta.md'), 'utf-8');
      expect(content.length).toBeGreaterThan(100);
      expect(content).toContain('{{REFERENCE_DATE}}');
    });

    it('contains anti-compression directive and em-dash prohibition', () => {
      const content = readFileSync(resolve(PROMPTS_DIR, 'research-delta.md'), 'utf-8');
      expect(content).toMatch(/Do not summarize/i);
      expect(content).toMatch(/em-dash/i);
    });
  });

  describe('buildResearchPrompts() delta mode', () => {

    it('loads research-delta.md and substitutes {{REFERENCE_DATE}} when mode is delta', () => {
      const referenceDate = '2026-01-15';
      const { userPrompt } = buildResearchPrompts(briefData, 'delta', referenceDate);

      expect(userPrompt).toContain(referenceDate);
      expect(userPrompt).toContain('Delta Intelligence Refresh');
      // Should not contain unsubstituted REFERENCE_DATE
      expect(userPrompt).not.toContain('{{REFERENCE_DATE}}');
    });

    it('default mode (standard) is unchanged — no regressions', () => {
      const { userPrompt: standard } = buildResearchPrompts(briefData);
      const { userPrompt: explicit } = buildResearchPrompts(briefData, 'standard');

      // Both should produce the same output
      expect(standard).toBe(explicit);
      // Standard prompt should NOT contain delta-specific content
      expect(standard).not.toContain('Delta Intelligence Refresh');
      expect(standard).not.toContain('REFERENCE_DATE');
    });
  });
});
