/**
 * Sprint 3 tests — Research depth validation.
 *
 * Verifies that the v2 prompt files enforce deep research output
 * rather than compressed summaries. Reads prompt files from disk
 * and asserts on their content.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, '../../../prompts');

const systemPrompt = readFileSync(resolve(PROMPTS_DIR, 'research-system.md'), 'utf-8');
const userPrompt = readFileSync(resolve(PROMPTS_DIR, 'research-user.md'), 'utf-8');

describe('Sprint 3: Research Depth Validation', () => {

  describe('research-system.md — no compression instructions', () => {
    it('should NOT contain "concise" as a formatting instruction', () => {
      // The word "concise" should not appear as an instruction to compress output.
      // It may appear in a negative context (e.g., "not a concise summary") which is acceptable,
      // but should not appear as a directive to BE concise.
      const lines = systemPrompt.split('\n');
      const conciseLines = lines.filter(
        (line) => /\bconcise\b/i.test(line) && !/not\b.*\bconcise/i.test(line)
      );
      expect(conciseLines.length).toBe(0);
    });

    it('should NOT contain "1 page maximum" or similar page limits', () => {
      expect(systemPrompt).not.toMatch(/1\s*page\s*maximum/i);
      expect(systemPrompt).not.toMatch(/limit.*to.*one\s*page/i);
      expect(systemPrompt).not.toMatch(/single[- ]page/i);
    });

    it('should NOT contain "executive-level" as a brevity directive', () => {
      // "executive-level" as a formatting instruction implies compression
      expect(systemPrompt).not.toMatch(/executive[- ]level\s+(summary|brief|overview)/i);
    });

    it('should NOT contain "avoid dense text" or similar anti-depth instructions', () => {
      expect(systemPrompt).not.toMatch(/avoid\s+dense\s+text/i);
      expect(systemPrompt).not.toMatch(/keep\s+it\s+(short|brief)/i);
      expect(systemPrompt).not.toMatch(/brevity\s+over\s+depth/i);
    });
  });

  describe('research-system.md — depth expectations present', () => {
    it('should contain "Research Depth Expectations" section', () => {
      expect(systemPrompt).toContain('Research Depth Expectations');
    });

    it('should contain qualitative depth guidance for primary target', () => {
      expect(systemPrompt).toMatch(/Primary target/i);
      expect(systemPrompt).toMatch(/deepest.*most exhaustive coverage/i);
    });

    it('should contain qualitative depth guidance for direct competitors', () => {
      expect(systemPrompt).toMatch(/Direct competitors/i);
      expect(systemPrompt).toMatch(/comparable thoroughness/i);
    });

    it('should contain qualitative depth guidance for secondary entities', () => {
      expect(systemPrompt).toMatch(/Secondary.*watchlist/i);
      expect(systemPrompt).toMatch(/proportional to what the evidence reveals/i);
    });

    it('should contain "Do not compress" instruction', () => {
      expect(systemPrompt).toMatch(/Do not compress/i);
    });

    it('should contain "thorough" depth guidance', () => {
      // The system prompt should explain what thorough means with examples
      expect(systemPrompt).toContain('What "thorough" means in practice');
    });
  });

  describe('research-user.md — all 13 template variables present', () => {
    const expectedVariables = [
      '{{PROJECT_TITLE}}',
      '{{RESEARCH_TYPE}}',
      '{{DATE}}',
      '{{DECISION_CONTEXT}}',
      '{{TIMELINE}}',
      '{{STAKEHOLDERS}}',
      '{{PRIMARY_TARGET}}',
      '{{FOCUS_AREAS}}',
      '{{COMPETITIVE_SET_TABLE}}',
      '{{GEOGRAPHIC_SCOPE}}',
      '{{TEMPORAL_SCOPE}}',
      '{{KEY_QUESTIONS}}',
      '{{EXCLUSIONS}}',
    ];

    it('should contain all 13 template variables', () => {
      for (const variable of expectedVariables) {
        expect(userPrompt).toContain(variable);
      }
    });

    it('should contain exactly 13 distinct template variables (excluding meta comments)', () => {
      // The prompt file has a meta comment line with {{VAR}} as documentation.
      // We skip lines that are blockquote meta comments (starting with ">")
      // and only count actual template variable placeholders.
      const found = new Set<string>();
      const lines = userPrompt.split('\n');
      for (const line of lines) {
        if (line.trimStart().startsWith('>')) continue; // skip meta/comment lines
        const regex = /\{\{([A-Z_]+)\}\}/g;
        let match;
        while ((match = regex.exec(line)) !== null) {
          found.add(match[1]);
        }
      }
      expect(found.size).toBe(13);
    });
  });

  describe('research-user.md — depth enforcement sections', () => {
    it('should contain "Research Depth Reminder" section', () => {
      expect(userPrompt).toContain('## RESEARCH DEPTH REMINDER');
    });

    it('should contain anti-compression directive in depth reminder', () => {
      expect(userPrompt).toMatch(/Do not summarize.*Do not compress/s);
    });

    it('should contain acceptance checklist with qualitative depth guidance', () => {
      expect(userPrompt).toContain('## ACCEPTANCE CHECKLIST');
      // Check that the checklist evaluates depth qualitatively
      expect(userPrompt).toMatch(/depth is proportional to strategic importance/i);
    });

    it('should contain per-tier depth guidance in competitive set section', () => {
      // The user prompt should have qualitative depth guidance per competitor tier
      expect(userPrompt).toMatch(/Direct.*primary.*competitors.*Full evidence coverage/s);
      expect(userPrompt).toMatch(/Adjacent.*secondary.*competitors.*strategically relevant signals/s);
    });
  });
});
