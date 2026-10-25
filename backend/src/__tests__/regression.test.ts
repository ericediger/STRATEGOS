/**
 * Regression Test Suite — Full Pipeline via Cached Fixtures
 *
 * Validates the complete STRATEGOS pipeline using the import-document endpoint
 * and direct file/DB operations for artifacts. No external API calls in the
 * default path. Export tests are gated behind ANTHROPIC_API_KEY.
 *
 * Test flow:
 *   1. Create project
 *   2. Import brief        → brief_approved
 *   3. Import research      → research_complete
 *   4. Import verification  → verification_complete
 *   5. Import assessment    → analysis_complete
 *   6. Write artifacts + DB → complete
 *   7. Confidence endpoint  → valid ConfidenceData
 *   8. Export (conditional) → PPTX/DOCX if API key present
 *   9. Delete project       → cleanup
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';
import request from 'supertest';
import type { Express } from 'express';

// ---------------------------------------------------------------------------
// Test Fixture Data (synthetic — no PII)
// ---------------------------------------------------------------------------

const BRIEF_CONTENT = `# Research Brief: Widget Platform Competitive Analysis

## Objective
Competitive intelligence analysis of the enterprise widget platform market.

## Scope
Analysis of WidgetCo vs competitors (AlphaTech, BetaSoft, GammaCorp).

## Key Questions
1. Market positioning and growth trajectories
2. Pricing and packaging comparison
3. Enterprise readiness assessment
`;

const RESEARCH_FILES = [
  {
    name: 'kimi.md',
    content: `# Competitive Research: Widget Platforms (Kimi)
**Research Date:** 2026-02-15

## Market Overview
The enterprise widget platform market is valued at $12B globally.

## WidgetCo Analysis
WidgetCo reported FY2025 revenue of $800M with 25% YoY growth.
Customer base exceeds 150,000 organizations across 190 countries.

## Competitor Profiles
### AlphaTech
Revenue: $600M. Strong in manufacturing vertical.

### BetaSoft
Revenue: $450M. Growing rapidly in SMB segment.

### GammaCorp
Revenue: $350M. Recently acquired by private equity.
`,
  },
  {
    name: 'gemini.md',
    content: `# Competitive Research: Widget Platforms (Gemini)
**Research Date:** 2026-02-15

## Market Overview
Enterprise widget market estimated at $11.8B with 18% CAGR projected through 2028.

## WidgetCo Performance
FY2025 revenue reached $800M. Operating margin improved to 14%.
Net dollar retention rate of 112% for enterprise accounts.

## Competitive Landscape
AlphaTech leads in manufacturing. BetaSoft gaining SMB share.
GammaCorp under PE ownership pivoting to enterprise-only strategy.
`,
  },
  {
    name: 'edr.md',
    content: `# Competitive Research: Widget Platforms (EDR)
**Research Date:** 2026-02-15

## Executive Summary
WidgetCo maintains market leadership in the enterprise widget space.

## Financial Analysis
WidgetCo FY2025: $800M revenue, 25% growth, $112M operating income.
Cash position: $1.2B with zero debt.

## Product Comparison
| Feature | WidgetCo | AlphaTech | BetaSoft | GammaCorp |
|---------|----------|-----------|----------|-----------|
| API Coverage | 95% | 80% | 70% | 85% |
| Uptime SLA | 99.99% | 99.95% | 99.9% | 99.95% |
`,
  },
];

const VERIFICATION_REPORT = `# Verification Report -- Research Verification

**Generated:** 2026-02-15T10:00:00.000Z

## Consensus Quality Gate (Primary)

| Metric | Value |
|--------|-------|
| **Status** | **REVIEW_RECOMMENDED** |
| Claim Groups | 20 |
| Verified | 12 |
| Conflicting Evidence | 3 |
| Unsupported Claim | 1 |
| Insufficient Evidence | 4 |
| Claims Requiring Additional Evidence | 25.0% (threshold: 15%) |

### Systematic Issues

- Source access issues detected in 2 providers.

## Per-Provider Quality Gate (Reference)

| Metric | Value |
|--------|-------|
| **Status** | **REVIEW_RECOMMENDED** |
| Total Claims | 18 |
| Verified | 11 |
| Conflicting Evidence | 3 |
| Unsupported Claim | 1 |
| Insufficient Evidence | 3 |
| Claims Requiring Additional Evidence | 22.2% (threshold: 15%) |

## Cross-Provider Consensus Analysis

### High-Confidence Claims (Unanimous Verification)

- **GRP-001**: WidgetCo FY2025 revenue _(edr, gemini, kimi)_

### Claims Requiring Human Review

#### GRP-002: WidgetCo operating margin

**Consensus:** REVIEW -- No clear majority (V:1 CE:1 UC:0 IE:0). Flagged for review.

- \\u2705 **EDR-002** (edr): Verified -- Operating margin confirmed at 14%.
- \\u26A0\\uFE0F **KIMI-002** (kimi): Conflicting Evidence -- Sources suggest 12% not 14%.

### Single-Provider Claims (Reduced Confidence)

- \\u2705 **GRP-010** (edr): WidgetCo API coverage claim -- Verified
- \\u2705 **GRP-011** (gemini): Market size estimate -- Verified
- \\u2705 **GRP-012** (kimi): Customer count claim -- Verified
- \\u26A0\\uFE0F **GRP-013** (edr): Revenue growth rate -- Conflicting Evidence
- \\u274C **GRP-014** (kimi): Debt-free claim -- Unsupported Claim
- \\u2753 **GRP-015** (edr): Cash position -- Insufficient Evidence
- \\u2753 **GRP-016** (gemini): NDR rate -- Insufficient Evidence
- \\u2753 **GRP-017** (kimi): Employee count -- Insufficient Evidence
- \\u2753 **GRP-018** (edr): Geographic distribution -- Insufficient Evidence
- \\u2705 **GRP-019** (gemini): CAGR projection -- Verified
- \\u2705 **GRP-020** (edr): Uptime SLA claim -- Verified
- \\u2705 **GRP-021** (kimi): Enterprise account growth -- Verified
- \\u2705 **GRP-022** (gemini): PE acquisition of GammaCorp -- Verified
- \\u2705 **GRP-023** (edr): AlphaTech manufacturing focus -- Verified
- \\u2705 **GRP-024** (kimi): BetaSoft SMB growth -- Verified
- \\u26A0\\uFE0F **GRP-025** (gemini): Pricing tier comparison -- Conflicting Evidence

## Detailed Claim Resolution

Detailed resolution data omitted for brevity.
`;

const STRATEGIC_ASSESSMENT = `## 1. Executive Command Brief

### Strategic Verdict
WidgetCo maintains market leadership but faces increasing pressure from PE-backed GammaCorp
and fast-growing BetaSoft in the SMB segment.

### Threat Level
**Medium** -- Competitive intensity rising but WidgetCo's financial position is strong.

## 2. Competitive Positioning

WidgetCo leads on platform breadth and enterprise readiness.
AlphaTech dominates manufacturing vertical. BetaSoft wins on price.

## 3. Strategic Recommendations

1. Accelerate enterprise feature development
2. Introduce competitive pricing tier for SMB
3. Strengthen integration ecosystem
`;

const DEFAULT_ARTIFACT_TYPES = ['swot', 'positioning', 'pricing', 'executive-summary', 'battle-card'] as const;
const ALL_ARTIFACT_TYPES = [...DEFAULT_ARTIFACT_TYPES, 'pestle', 'five-forces'] as const;

const ARTIFACT_CONTENT: Record<string, string> = {
  swot: `# SWOT Analysis: Widget Platforms
## Strengths
- Market leader with $800M revenue and 25% growth
- 150,000+ customer organizations globally
- 99.99% uptime SLA

## Weaknesses
- Limited presence in manufacturing vertical (AlphaTech dominance)
- Higher price point than BetaSoft for SMB segment

## Opportunities
- Enterprise widget market growing at 18% CAGR
- AI/automation features as competitive differentiator
- Geographic expansion in APAC

## Threats
- GammaCorp PE-backed pivot to enterprise-only
- BetaSoft rapid SMB adoption eroding pipeline
- Pricing pressure from open-source alternatives
`,
  positioning: `# Competitive Positioning Matrix
## WidgetCo
Enterprise readiness: High | Growth momentum: High | Market share: 35%

## AlphaTech
Enterprise readiness: High | Growth momentum: Medium | Market share: 25%

## BetaSoft
Enterprise readiness: Medium | Growth momentum: High | Market share: 18%

## GammaCorp
Enterprise readiness: Medium | Growth momentum: Low | Market share: 15%
`,
  pricing: `# Pricing & Feature Comparison
## WidgetCo
- Free: Up to 3 users
- Standard: $12/user/mo
- Pro: $20/user/mo
- Enterprise: Custom pricing

## AlphaTech
- Starter: $10/user/mo
- Business: $18/user/mo
- Enterprise: Custom

## BetaSoft
- Free: Up to 5 users
- Team: $8/user/mo
- Business: $15/user/mo
`,
  'executive-summary': `# Executive Summary
## Strategic Verdict
WidgetCo maintains a strong competitive position with market-leading revenue growth
and enterprise adoption. Key risks include GammaCorp's PE-backed enterprise pivot and
BetaSoft's aggressive SMB pricing strategy.

## Key Findings
1. WidgetCo's 25% revenue growth outpaces the 18% market CAGR
2. Net dollar retention of 112% indicates strong enterprise stickiness
3. Verification confidence: Medium (25% of claims require additional evidence)

## Recommended Actions
- Defend enterprise positioning against GammaCorp
- Launch competitive SMB tier to counter BetaSoft
- Invest in AI/automation differentiators
`,
  'battle-card': `# Battle Card: WidgetCo vs Competitors
## Quick Stats
| Metric | WidgetCo | AlphaTech | BetaSoft | GammaCorp |
|--------|----------|-----------|----------|-----------|
| Revenue | $800M | $600M | $450M | $350M |
| Growth | 25% | 15% | 30% | 5% |
| Customers | 150K | 80K | 200K | 40K |

## Win Themes
- Superior uptime (99.99% vs 99.9-99.95%)
- Broadest API coverage (95%)
- Strongest financial position ($1.2B cash)

## Objection Handling
**"AlphaTech has deeper manufacturing features"**
Response: WidgetCo covers 95% of manufacturing use cases with our industry templates.

**"BetaSoft is cheaper"**
Response: TCO analysis shows WidgetCo delivers 40% better value at enterprise scale.
`,
  pestle: `# PESTLE Analysis
## Political
Increasing data sovereignty regulations favor vendors with multi-region deployment.

## Economic
Enterprise IT budgets growing 8% YoY despite macro uncertainty.

## Social
Remote/hybrid work driving demand for collaborative platforms.

## Technological
AI/ML integration becoming table stakes for enterprise platforms.

## Legal
GDPR compliance requirements create barriers for smaller vendors.

## Environmental
Carbon-neutral cloud commitments becoming procurement criteria.
`,
  'five-forces': `# Porter's Five Forces Analysis
## Threat of New Entrants: Medium
High capital requirements but open-source alternatives lowering barriers.

## Bargaining Power of Suppliers: Low
Cloud infrastructure commoditized across major providers.

## Bargaining Power of Buyers: Medium
Enterprise buyers have negotiating leverage but high switching costs.

## Threat of Substitutes: Medium
Point solutions and spreadsheets still used for simple workflows.

## Competitive Rivalry: High
Four major players competing aggressively on features and pricing.
`,
};

// ---------------------------------------------------------------------------
// Test Setup
// ---------------------------------------------------------------------------

let app: Express;
let tmpDir: string;
let projectId: string;
let projectsRoot: string;

beforeAll(async () => {
  // 1. Create isolated temp directory
  tmpDir = mkdtempSync(join(tmpdir(), 'strategos-regression-'));
  projectsRoot = join(tmpDir, 'projects');
  mkdirSync(projectsRoot, { recursive: true });
  process.env.PROJECTS_ROOT = projectsRoot;

  // 2. Initialize DB (must happen before route imports)
  const { initDb } = await import('../db/index.js');
  initDb(join(tmpDir, 'test.db'));

  // 3. Import routes dynamically (after DB + env ready)
  const [
    { default: projectRoutes },
    { default: collaborationRoutes },
    { default: exportRoutes },
  ] = await Promise.all([
    import('../routes/projects.js'),
    import('../routes/collaboration.js'),
    import('../routes/exports.js'),
  ]);

  // 4. Build test Express app (no CORS, no helmet, no rate limiting)
  app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/projects', projectRoutes);
  app.use('/api/collaboration', collaborationRoutes);
  app.use('/api/projects', exportRoutes);
});

afterAll(async () => {
  // Clean up test project via API (if it exists)
  if (projectId && app) {
    try {
      await request(app).delete(`/api/projects/${projectId}`);
    } catch { /* ignore cleanup errors */ }
  }

  // Close DB
  try {
    const { closeDb } = await import('../db/index.js');
    closeDb();
  } catch { /* ignore */ }

  // Remove temp directory
  if (tmpDir) {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// Helper: get project status from DB via the API
// ---------------------------------------------------------------------------

async function getProjectStatus(): Promise<string> {
  const res = await request(app).get(`/api/projects/${projectId}`);
  return res.body.project?.status ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Regression: Full Pipeline via Cached Fixtures', () => {

  // =========================================================================
  // Project Creation
  // =========================================================================

  describe('Project creation', () => {
    it('should create a new project', async () => {
      const res = await request(app)
        .post('/api/projects')
        .send({ name: 'Regression Test Project' })
        .expect(201);

      expect(res.body.project).toBeDefined();
      expect(res.body.project.id).toBeDefined();
      expect(res.body.project.status).toBe('not_started');

      projectId = res.body.project.id;
    });
  });

  // =========================================================================
  // Phase 0: Brief Import
  // =========================================================================

  describe('Phase 0: Brief import', () => {
    it('should import a research brief and advance to brief_approved', async () => {
      const res = await request(app)
        .post(`/api/collaboration/${projectId}/import-document`)
        .send({
          phase: 'collaboration',
          files: [{ name: 'brief.md', content: BRIEF_CONTENT }],
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const status = await getProjectStatus();
      expect(status).toBe('brief_approved');
    });
  });

  // =========================================================================
  // Phase 1: Research Import
  // =========================================================================

  describe('Phase 1: Research import', () => {
    it('should import 3 research files and advance to research_complete', async () => {
      const res = await request(app)
        .post(`/api/collaboration/${projectId}/import-document`)
        .send({
          phase: 'research',
          files: RESEARCH_FILES,
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const status = await getProjectStatus();
      expect(status).toBe('research_complete');
    });

    it('should show research data in project dashboard', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}`)
        .expect(200);

      const { research } = res.body;
      expect(research).toBeDefined();

      // Imported research should have keys matching filenames (without .md)
      const researchKeys = Object.keys(research);
      expect(researchKeys).toContain('kimi');
      expect(researchKeys).toContain('gemini');
      expect(researchKeys).toContain('edr');

      // Each provider should be complete with non-null content
      for (const key of ['kimi', 'gemini', 'edr']) {
        expect(research[key].status).toBe('complete');
        expect(research[key].wordCount).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // Phase 2: Verification Import
  // =========================================================================

  describe('Phase 2: Verification import', () => {
    it('should import verification report and advance to verification_complete', async () => {
      const res = await request(app)
        .post(`/api/collaboration/${projectId}/import-document`)
        .send({
          phase: 'verification',
          files: [{ name: 'verification_report.md', content: VERIFICATION_REPORT }],
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const status = await getProjectStatus();
      expect(status).toBe('verification_complete');
    });
  });

  // =========================================================================
  // Phase 3: Strategic Assessment Import
  // =========================================================================

  describe('Phase 3: Strategic assessment import', () => {
    it('should import strategic assessment and advance to analysis_complete', async () => {
      const res = await request(app)
        .post(`/api/collaboration/${projectId}/import-document`)
        .send({
          phase: 'analysis',
          files: [{ name: 'strategic_assessment.md', content: STRATEGIC_ASSESSMENT }],
        })
        .expect(200);

      expect(res.body.success).toBe(true);

      const status = await getProjectStatus();
      expect(status).toBe('analysis_complete');
    });
  });

  // =========================================================================
  // Phase 4: Artifact Validation
  // =========================================================================

  describe('Phase 4: Artifact validation', () => {
    it('should set up artifacts on disk and in DB', async () => {
      // Write all artifact files to disk
      const artifactsDir = join(projectsRoot, projectId, 'artifacts');
      mkdirSync(artifactsDir, { recursive: true });

      for (const [type, content] of Object.entries(ARTIFACT_CONTENT)) {
        writeFileSync(join(artifactsDir, `${type}.md`), content, 'utf-8');
      }

      // Insert artifact rows into selected_artifacts table
      const { prepare } = await import('../db/index.js');

      for (const type of DEFAULT_ARTIFACT_TYPES) {
        const label = {
          swot: 'SWOT Analysis',
          positioning: 'Competitive Positioning Matrix',
          pricing: 'Pricing & Feature Comparison',
          'executive-summary': 'Executive Summary',
          'battle-card': 'Battle Card',
        }[type];

        prepare(`
          INSERT INTO selected_artifacts (id, project_id, artifact_type, label, status, output_path, completed_at)
          VALUES (?, ?, ?, ?, 'complete', ?, datetime('now'))
        `).run(
          uuidv4(),
          projectId,
          type,
          label,
          join(artifactsDir, `${type}.md`),
        );
      }

      // Advance project to complete
      prepare(`UPDATE projects SET status = 'complete' WHERE id = ?`).run(projectId);

      const status = await getProjectStatus();
      expect(status).toBe('complete');
    });

    it('should list all default-tier artifacts in dashboard response', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}`)
        .expect(200);

      const { artifacts } = res.body;
      expect(artifacts).toBeDefined();
      expect(artifacts.length).toBeGreaterThanOrEqual(DEFAULT_ARTIFACT_TYPES.length);

      const artifactTypes = artifacts.map((a: any) => a.artifactType);
      for (const type of DEFAULT_ARTIFACT_TYPES) {
        expect(artifactTypes).toContain(type);
      }

      // Every artifact should be complete and have a non-null outputPath
      for (const artifact of artifacts) {
        expect(artifact.status).toBe('complete');
        expect(artifact.outputPath).toBeTruthy();
      }
    });

    it('should return non-empty content for each artifact type', async () => {
      for (const type of DEFAULT_ARTIFACT_TYPES) {
        const res = await request(app)
          .get(`/api/collaboration/${projectId}/artifacts/${type}`)
          .expect(200);

        expect(res.body.content).toBeTruthy();
        expect(res.body.content.length).toBeGreaterThan(0);
        expect(res.body.wordCount).toBeGreaterThan(0);
      }
    });
  });

  // =========================================================================
  // Confidence Endpoint
  // =========================================================================

  describe('Confidence data', () => {
    it('should return valid ConfidenceData structure', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/confidence`)
        .expect(200);

      const confidence = res.body;

      // Top-level structure
      expect(confidence).toHaveProperty('overall');
      expect(confidence).toHaveProperty('perSection');
      expect(confidence).toHaveProperty('verificationDate');
      expect(confidence).toHaveProperty('thresholds');

      // Overall rating must be High, Medium, or Low
      expect(['High', 'Medium', 'Low']).toContain(confidence.overall.rating);
      expect(typeof confidence.overall.verifiedPercent).toBe('number');
      expect(typeof confidence.overall.issueRate).toBe('number');
      expect(typeof confidence.overall.recencyDays).toBe('number');
      expect(Array.isArray(confidence.overall.factors)).toBe(true);

      // perSection should cover all 7 artifact types
      const sectionKeys = Object.keys(confidence.perSection);
      for (const type of ALL_ARTIFACT_TYPES) {
        expect(sectionKeys).toContain(type);
      }

      // Thresholds should have expected fields
      expect(confidence.thresholds).toHaveProperty('recencyHighDays');
      expect(confidence.thresholds).toHaveProperty('recencyMediumDays');
      expect(confidence.thresholds).toHaveProperty('verifiedMajority');
      expect(confidence.thresholds).toHaveProperty('issueRateLow');
      expect(confidence.thresholds).toHaveProperty('issueRateMedium');
    });

    it('should parse quality gate values from the verification report', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/confidence`)
        .expect(200);

      const { overall } = res.body;

      // Our fixture has 12 verified out of 20 claims = 60%
      expect(overall.verifiedPercent).toBe(60);

      // Issue rate: 25% from the fixture
      expect(overall.issueRate).toBe(25);
    });
  });

  // =========================================================================
  // Export Tests (Conditional — requires ANTHROPIC_API_KEY)
  // =========================================================================

  describe('Export generation', () => {
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

    it.skipIf(!hasApiKey)(
      'should generate a PPTX export for swot artifact',
      async () => {
        const res = await request(app)
          .post(`/api/projects/${projectId}/export`)
          .send({ artifactType: 'swot', format: 'pptx' })
          .expect(200);

        expect(res.body.status).toBe('complete');
        expect(res.body.filename).toBe('swot.pptx');
      },
      120_000,
    );

    it.skipIf(!hasApiKey)(
      'should generate a DOCX export for executive-summary artifact',
      async () => {
        const res = await request(app)
          .post(`/api/projects/${projectId}/export`)
          .send({ artifactType: 'executive-summary', format: 'docx' })
          .expect(200);

        expect(res.body.status).toBe('complete');
        expect(res.body.filename).toBe('executive-summary.docx');
      },
      120_000,
    );

    it.skipIf(!hasApiKey)(
      'should generate a competitive packet PPTX',
      async () => {
        const res = await request(app)
          .post(`/api/projects/${projectId}/export/packet`)
          .send({})
          .expect(200);

        expect(res.body.status).toBe('complete');
        expect(res.body.filename).toBe('competitive-packet.pptx');
      },
      300_000,
    );

    it('documents skipped export tests when API key is absent', () => {
      if (!hasApiKey) {
        console.log(
          '[regression] Export tests skipped: ANTHROPIC_API_KEY not set.\n' +
          '  To run export tests, set ANTHROPIC_API_KEY in backend/.env or environment.',
        );
      }
      // Always passes — informational only
      expect(true).toBe(true);
    });
  });

  // =========================================================================
  // Import Guard Tests (status must be correct for each phase)
  // =========================================================================

  describe('Import guards', () => {
    it('should reject brief import when project is past collaboration phase', async () => {
      // Project is at 'complete' — cannot import a brief
      const res = await request(app)
        .post(`/api/collaboration/${projectId}/import-document`)
        .send({
          phase: 'collaboration',
          files: [{ name: 'brief.md', content: 'stale brief' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot import');
    });

    it('should reject research import when project is past research phase', async () => {
      const res = await request(app)
        .post(`/api/collaboration/${projectId}/import-document`)
        .send({
          phase: 'research',
          files: [{ name: 'test.md', content: 'stale research' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot import');
    });
  });

  // =========================================================================
  // Cleanup Validation
  // =========================================================================

  describe('Cleanup', () => {
    it('should delete the test project', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectId}`)
        .expect(200);

      expect(res.body.success).toBe(true);

      // Verify project is gone
      const getRes = await request(app).get(`/api/projects/${projectId}`);
      expect(getRes.status).toBe(404);

      // Prevent afterAll from trying to delete again
      projectId = '';
    });
  });
});
