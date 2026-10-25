import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  parseVerificationReport,
  calculateConfidence,
  DEFAULT_THRESHOLDS,
  type VerificationData,
  type ConfidenceThresholds,
} from '../services/confidence.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECTS_ROOT = join(__dirname, '..', '..', 'projects');
const PM_REPORT_PATH = join(PROJECTS_ROOT, '24b7f95b-e550-4247-97b6-e9ba8d4c4613', 'verification', 'verification_report.md');
const CLOUD_REPORT_PATH = join(PROJECTS_ROOT, 'b16d4373-52ae-4580-8c84-b5f8ef757198', 'verification', 'verification_report.md');

// =============================================================================
// Parser Tests
// =============================================================================

describe('parseVerificationReport', () => {
  it('should parse the PM corpus report correctly', () => {
    if (!existsSync(PM_REPORT_PATH)) return; // skip if no test data

    const markdown = readFileSync(PM_REPORT_PATH, 'utf-8');
    const data = parseVerificationReport(markdown);

    // Quality gate
    expect(data.qualityGate.result).toBe('REVIEW_RECOMMENDED');
    expect(data.qualityGate.totalClaims).toBe(161);
    expect(data.qualityGate.issueRate).toBeCloseTo(0.277, 2);

    // Verdict distribution
    expect(data.verdictDistribution.verified).toBe(86);
    expect(data.verdictDistribution.conflictingEvidence).toBe(29);
    expect(data.verdictDistribution.unsupportedClaim).toBe(1);
    expect(data.verdictDistribution.insufficientEvidence).toBe(42);

    // Claims should be parsed
    expect(data.claims.length).toBeGreaterThan(0);

    // Check a known claim
    const edr001 = data.claims.find(c => c.id === 'EDR-001');
    expect(edr001).toBeDefined();
    expect(edr001!.verdict).toBe('conflicting_evidence');
    expect(edr001!.sourceProvider).toBe('edr');
  });

  it('should parse the Cloud corpus report correctly', () => {
    if (!existsSync(CLOUD_REPORT_PATH)) return;

    const markdown = readFileSync(CLOUD_REPORT_PATH, 'utf-8');
    const data = parseVerificationReport(markdown);

    expect(data.qualityGate.result).toBe('REVIEW_RECOMMENDED');
    expect(data.qualityGate.totalClaims).toBe(89);
    expect(data.qualityGate.issueRate).toBeCloseTo(0.247, 2);

    expect(data.verdictDistribution.verified).toBe(52);
    expect(data.verdictDistribution.conflictingEvidence).toBe(14);
    expect(data.verdictDistribution.unsupportedClaim).toBe(2);
    expect(data.verdictDistribution.insufficientEvidence).toBe(21);
  });

  it('should handle empty/malformed input gracefully', () => {
    const empty = parseVerificationReport('');
    expect(empty.qualityGate.totalClaims).toBe(0);
    expect(empty.claims).toHaveLength(0);

    const malformed = parseVerificationReport('# Not a verification report\n\nRandom text.');
    expect(malformed.qualityGate.totalClaims).toBe(0);
    expect(malformed.verdictDistribution.verified).toBe(0);

    // Should not throw on null-like input
    const nullish = parseVerificationReport(null as unknown as string);
    expect(nullish.qualityGate.totalClaims).toBe(0);
  });
});

// =============================================================================
// Calculator Tests
// =============================================================================

describe('calculateConfidence', () => {
  const recentDate = new Date(); // today = 0 days old

  function makeData(overrides: Partial<VerificationData> = {}): VerificationData {
    return {
      qualityGate: { result: 'PASSED', issueRate: 0.05, totalClaims: 100 },
      verdictDistribution: { verified: 80, conflictingEvidence: 10, unsupportedClaim: 5, insufficientEvidence: 5 },
      claims: [],
      sourceAccessDates: [],
      ...overrides,
    };
  }

  it('should produce High for 5% issue rate + recent sources + majority verified', () => {
    const data = makeData({
      qualityGate: { result: 'PASSED', issueRate: 0.05, totalClaims: 100 },
      verdictDistribution: { verified: 80, conflictingEvidence: 10, unsupportedClaim: 5, insufficientEvidence: 5 },
    });

    const result = calculateConfidence(data, recentDate);
    expect(result.rating).toBe('High');
    expect(result.verifiedPercent).toBe(80);
    expect(result.issueRate).toBe(5);
    expect(result.factors.some(f => f.includes('High'))).toBe(true);
  });

  it('should produce Medium for mixed data (issue rate 15-30%)', () => {
    const data = makeData({
      qualityGate: { result: 'REVIEW_RECOMMENDED', issueRate: 0.25, totalClaims: 100 },
      verdictDistribution: { verified: 60, conflictingEvidence: 15, unsupportedClaim: 5, insufficientEvidence: 20 },
    });

    const result = calculateConfidence(data, recentDate);
    expect(result.rating).toBe('Medium');
  });

  it('should produce Low for 50% issue rate + old sources', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 200);

    const data = makeData({
      qualityGate: { result: 'REVIEW_RECOMMENDED', issueRate: 0.50, totalClaims: 100 },
      verdictDistribution: { verified: 30, conflictingEvidence: 30, unsupportedClaim: 10, insufficientEvidence: 30 },
    });

    const result = calculateConfidence(data, oldDate);
    expect(result.rating).toBe('Low');
  });

  it('should respect custom thresholds', () => {
    const data = makeData({
      qualityGate: { result: 'REVIEW_RECOMMENDED', issueRate: 0.20, totalClaims: 100 },
      verdictDistribution: { verified: 60, conflictingEvidence: 20, unsupportedClaim: 0, insufficientEvidence: 20 },
    });

    // With default thresholds, 20% issue rate -> Medium
    const defaultResult = calculateConfidence(data, recentDate);
    expect(defaultResult.rating).toBe('Medium');

    // With relaxed thresholds (issueRateLow = 0.25), 20% -> High
    const relaxed: ConfidenceThresholds = {
      ...DEFAULT_THRESHOLDS,
      issueRateLow: 0.25,
    };
    const relaxedResult = calculateConfidence(data, recentDate, relaxed);
    expect(relaxedResult.rating).toBe('High');
  });

  it('should produce Medium for PM corpus (27.7% issue rate)', () => {
    if (!existsSync(PM_REPORT_PATH)) return;

    const markdown = readFileSync(PM_REPORT_PATH, 'utf-8');
    const data = parseVerificationReport(markdown);
    const result = calculateConfidence(data, recentDate);

    // 27.7% is between issueRateLow (15%) and issueRateMedium (30%) -> Medium
    expect(result.rating).toBe('Medium');
    expect(result.issueRate).toBeCloseTo(27.7, 0);
  });

  it('should produce Medium for Cloud corpus (24.7% issue rate)', () => {
    if (!existsSync(CLOUD_REPORT_PATH)) return;

    const markdown = readFileSync(CLOUD_REPORT_PATH, 'utf-8');
    const data = parseVerificationReport(markdown);
    const result = calculateConfidence(data, recentDate);

    // 24.7% is between 15% and 30% -> Medium
    expect(result.rating).toBe('Medium');
    expect(result.issueRate).toBeCloseTo(24.7, 0);
  });
});

// =============================================================================
// Confidence Data Structure Tests
// =============================================================================

describe('ConfidenceData structure', () => {
  it('should return correct structure from calculateConfidence', () => {
    const data: VerificationData = {
      qualityGate: { result: 'PASSED', issueRate: 0.10, totalClaims: 50 },
      verdictDistribution: { verified: 40, conflictingEvidence: 5, unsupportedClaim: 0, insufficientEvidence: 5 },
      claims: [],
      sourceAccessDates: [],
    };

    const result = calculateConfidence(data, new Date());

    expect(result).toHaveProperty('rating');
    expect(result).toHaveProperty('verifiedPercent');
    expect(result).toHaveProperty('issueRate');
    expect(result).toHaveProperty('recencyDays');
    expect(result).toHaveProperty('factors');
    expect(['High', 'Medium', 'Low']).toContain(result.rating);
    expect(typeof result.verifiedPercent).toBe('number');
    expect(typeof result.issueRate).toBe('number');
    expect(typeof result.recencyDays).toBe('number');
    expect(Array.isArray(result.factors)).toBe(true);
    expect(result.factors.length).toBeGreaterThan(0);
  });
});
