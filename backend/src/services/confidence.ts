/**
 * Confidence Calculation Service
 *
 * Parses verification reports and calculates confidence ratings
 * for the trust layer. Provides caching with mtime-based invalidation.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// =============================================================================
// TYPES
// =============================================================================

export interface QualityGate {
  result: 'PASSED' | 'REVIEW_RECOMMENDED';
  issueRate: number;
  totalClaims: number;
}

export interface VerdictDistribution {
  verified: number;
  conflictingEvidence: number;
  unsupportedClaim: number;
  insufficientEvidence: number;
}

export interface ClaimRecord {
  id: string;
  verdict: 'verified' | 'conflicting_evidence' | 'unsupported_claim' | 'insufficient_evidence';
  sourceProvider: string;
}

export interface SourceAccessDate {
  url: string;
  accessDate: string;
}

export interface VerificationData {
  qualityGate: QualityGate;
  verdictDistribution: VerdictDistribution;
  claims: ClaimRecord[];
  sourceAccessDates: SourceAccessDate[];
}

export interface ConfidenceThresholds {
  recencyHighDays: number;
  recencyMediumDays: number;
  verifiedMajority: number;
  issueRateLow: number;
  issueRateMedium: number;
}

export interface SectionConfidence {
  rating: 'High' | 'Medium' | 'Low';
  verifiedPercent: number;
  issueRate: number;
  recencyDays: number;
  factors: string[];
}

export interface ConfidenceData {
  overall: SectionConfidence;
  perSection: Record<string, SectionConfidence>;
  verificationDate: string;
  thresholds: ConfidenceThresholds;
}

// =============================================================================
// DEFAULT THRESHOLDS
// =============================================================================

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  recencyHighDays: 90,
  recencyMediumDays: 180,
  verifiedMajority: 0.5,
  issueRateLow: 0.15,
  issueRateMedium: 0.30,
};

// =============================================================================
// PARSER
// =============================================================================

/**
 * Parse a verification report markdown into structured data.
 * Defensive: returns partial data on format mismatch, never throws.
 */
export function parseVerificationReport(reportMarkdown: string): VerificationData {
  const result: VerificationData = {
    qualityGate: { result: 'REVIEW_RECOMMENDED', issueRate: 0, totalClaims: 0 },
    verdictDistribution: { verified: 0, conflictingEvidence: 0, unsupportedClaim: 0, insufficientEvidence: 0 },
    claims: [],
    sourceAccessDates: [],
  };

  if (!reportMarkdown || typeof reportMarkdown !== 'string') {
    console.warn('[confidence] Empty or invalid report markdown');
    return result;
  }

  // --- Parse Consensus Quality Gate ---
  try {
    const consensusSection = reportMarkdown.match(
      /## Consensus Quality Gate \(Primary\)([\s\S]*?)(?=\n## )/
    );
    if (consensusSection) {
      const section = consensusSection[1];

      // Status
      const statusMatch = section.match(/\*\*Status\*\*\s*\|\s*\*\*(.*?)\*\*/);
      if (statusMatch) {
        const raw = statusMatch[1].trim();
        result.qualityGate.result = raw === 'PASSED' ? 'PASSED' : 'REVIEW_RECOMMENDED';
      }

      // Claim Groups (total claims)
      const claimGroupsMatch = section.match(/Claim Groups\s*\|\s*(\d+)/);
      if (claimGroupsMatch) {
        result.qualityGate.totalClaims = parseInt(claimGroupsMatch[1], 10);
      }

      // Verdict counts from the table
      const verifiedMatch = section.match(/\| Verified\s*\|\s*(\d+)/);
      if (verifiedMatch) {
        result.verdictDistribution.verified = parseInt(verifiedMatch[1], 10);
      }

      const conflictingMatch = section.match(/Conflicting Evidence\s*\|\s*(\d+)/);
      if (conflictingMatch) {
        result.verdictDistribution.conflictingEvidence = parseInt(conflictingMatch[1], 10);
      }

      const unsupportedMatch = section.match(/Unsupported Claim\s*\|\s*(\d+)/);
      if (unsupportedMatch) {
        result.verdictDistribution.unsupportedClaim = parseInt(unsupportedMatch[1], 10);
      }

      const insufficientMatch = section.match(/Insufficient Evidence\s*\|\s*(\d+)/);
      if (insufficientMatch) {
        result.verdictDistribution.insufficientEvidence = parseInt(insufficientMatch[1], 10);
      }

      // Issue rate
      const issueRateMatch = section.match(/Claims Requiring Additional Evidence\s*\|\s*([\d.]+)%/);
      if (issueRateMatch) {
        result.qualityGate.issueRate = parseFloat(issueRateMatch[1]) / 100;
      }
    }
  } catch (err) {
    console.warn('[confidence] Failed to parse quality gate section:', err);
  }

  // --- Parse individual claims from Cross-Provider Consensus Analysis ---
  try {
    const claimsSection = reportMarkdown.match(
      /## Cross-Provider Consensus Analysis([\s\S]*?)(?=\n## Detailed Claim Resolution|\n## All Consensus|$)/
    );
    if (claimsSection) {
      // Match individual claim lines like: - ✅ **EDR-001** (edr): Verified — ...
      // Also match group-level single-provider claims: - ✅ **GRP-014** (edr): ... — Verified
      const claimPattern = /- (✅|⚠️|❌|❓)\s*\*\*(\w+-\d+)\*\*\s*\((\w+)\):\s*(.*)/g;
      let match;
      while ((match = claimPattern.exec(claimsSection[1])) !== null) {
        const emoji = match[1];
        const id = match[2];
        const provider = match[3];

        let verdict: ClaimRecord['verdict'];
        if (emoji === '✅') {
          verdict = 'verified';
        } else if (emoji === '⚠️') {
          verdict = 'conflicting_evidence';
        } else if (emoji === '❌') {
          verdict = 'unsupported_claim';
        } else {
          verdict = 'insufficient_evidence';
        }

        result.claims.push({ id, verdict, sourceProvider: provider });
      }
    }
  } catch (err) {
    console.warn('[confidence] Failed to parse claims section:', err);
  }

  // --- Parse source access dates (from Generated timestamp) ---
  try {
    const dateMatch = reportMarkdown.match(/\*\*Generated:\*\*\s*(.+)/);
    if (dateMatch) {
      result.sourceAccessDates.push({
        url: 'verification-report',
        accessDate: dateMatch[1].trim(),
      });
    }
  } catch (err) {
    console.warn('[confidence] Failed to parse source access dates:', err);
  }

  return result;
}

// =============================================================================
// CALCULATOR
// =============================================================================

/**
 * Calculate confidence rating from verification data.
 *
 * Rating logic:
 * - High: majority verified (>= 50%) AND sources within 90 days AND issue rate below 15%
 * - Medium: issue rate between 15% and 30% OR sources 90-180 days
 * - Low: issue rate > 30% OR sources > 180 days
 */
export function calculateConfidence(
  data: VerificationData,
  verificationDate: Date,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): SectionConfidence {
  const factors: string[] = [];

  // Calculate verified percentage from consensus distribution
  const total = data.qualityGate.totalClaims;
  const verifiedPercent = total > 0
    ? data.verdictDistribution.verified / total
    : 0;

  // Issue rate from quality gate
  const issueRate = data.qualityGate.issueRate;

  // Recency: days since verification
  const now = new Date();
  const recencyDays = Math.floor(
    (now.getTime() - verificationDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Evaluate each factor
  const verifiedMajority = verifiedPercent >= thresholds.verifiedMajority;
  const issueRateLow = issueRate < thresholds.issueRateLow;
  const issueRateMedium = issueRate <= thresholds.issueRateMedium;
  const recencyHigh = recencyDays <= thresholds.recencyHighDays;
  const recencyMedium = recencyDays <= thresholds.recencyMediumDays;

  // Build factors explanation
  factors.push(
    `${(verifiedPercent * 100).toFixed(1)}% of claims verified (${data.verdictDistribution.verified}/${total})`
  );
  factors.push(
    `Issue rate: ${(issueRate * 100).toFixed(1)}% (threshold: <${(thresholds.issueRateLow * 100).toFixed(0)}% for High)`
  );
  factors.push(
    `Sources are ${recencyDays} days old (threshold: <${thresholds.recencyHighDays} days for High)`
  );

  // Determine rating
  let rating: 'High' | 'Medium' | 'Low';

  if (issueRate > thresholds.issueRateMedium || !recencyMedium) {
    // Low: issue rate exceeds medium threshold OR sources too old
    rating = 'Low';
    if (issueRate > thresholds.issueRateMedium) {
      factors.push(`Rating: Low — issue rate ${(issueRate * 100).toFixed(1)}% exceeds ${(thresholds.issueRateMedium * 100).toFixed(0)}% threshold`);
    }
    if (!recencyMedium) {
      factors.push(`Rating: Low — sources older than ${thresholds.recencyMediumDays} days`);
    }
  } else if (verifiedMajority && issueRateLow && recencyHigh) {
    // High: all three conditions met
    rating = 'High';
    factors.push('Rating: High — majority verified, low issue rate, recent sources');
  } else {
    // Medium: everything else in between
    rating = 'Medium';
    const reasons: string[] = [];
    if (!verifiedMajority) reasons.push(`verified claims below ${(thresholds.verifiedMajority * 100).toFixed(0)}%`);
    if (!issueRateLow) reasons.push(`issue rate above ${(thresholds.issueRateLow * 100).toFixed(0)}%`);
    if (!recencyHigh) reasons.push(`sources older than ${thresholds.recencyHighDays} days`);
    factors.push(`Rating: Medium — ${reasons.join(', ')}`);
  }

  return {
    rating,
    verifiedPercent: Math.round(verifiedPercent * 1000) / 10,
    issueRate: Math.round(issueRate * 1000) / 10,
    recencyDays,
    factors,
  };
}

// =============================================================================
// CACHE + PUBLIC API
// =============================================================================

interface CacheEntry {
  data: ConfidenceData;
  mtime: number;
}

const confidenceCache = new Map<string, CacheEntry>();

/**
 * Get confidence data for a project. Uses mtime-based caching.
 * Returns null if no verification report exists.
 */
export function getProjectConfidence(
  projectId: string,
  projectsRoot: string,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceData | null {
  const reportPath = join(projectsRoot, projectId, 'verification', 'verification_report.md');

  if (!existsSync(reportPath)) {
    return null;
  }

  const stat = statSync(reportPath);
  const mtime = stat.mtimeMs;

  // Check cache
  const cached = confidenceCache.get(projectId);
  if (cached && cached.mtime === mtime) {
    return cached.data;
  }

  // Parse and calculate
  const reportMarkdown = readFileSync(reportPath, 'utf-8');
  const verificationData = parseVerificationReport(reportMarkdown);
  const verificationDate = stat.mtime;

  const overall = calculateConfidence(verificationData, verificationDate, thresholds);

  // Per-section: apply overall rating uniformly (per-section differentiation deferred)
  const artifactTypes = [
    'executive-summary', 'positioning', 'swot', 'pricing',
    'pestle', 'five-forces', 'battle-card',
  ];
  const perSection: Record<string, SectionConfidence> = {};
  for (const type of artifactTypes) {
    perSection[type] = { ...overall };
  }

  const data: ConfidenceData = {
    overall,
    perSection,
    verificationDate: verificationDate.toISOString(),
    thresholds,
  };

  // Update cache
  confidenceCache.set(projectId, { data, mtime });

  return data;
}

/** Clear cache for a specific project (useful for testing). */
export function clearConfidenceCache(projectId?: string): void {
  if (projectId) {
    confidenceCache.delete(projectId);
  } else {
    confidenceCache.clear();
  }
}
