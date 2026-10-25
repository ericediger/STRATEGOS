import type {
  Claim, AdjudicationResult, ClaimVerdict, QualityGate,
  ConsensusResult, ClaimGroup, GroupedClaim, ConsensusVerdict, SystematicIssue,
} from '../types.js';
import { CONFIG } from '../config.js';
import { callKimiChat } from '../utils/api.js';
import { readPrompt } from '../utils/files.js';
import { appendTokenRecord } from '../utils/token-logger.js';

/**
 * Step 3.5: Cross-Provider Consensus
 * Clusters semantically similar claims across providers, then applies
 * democratic voting rules to produce a consensus verdict per group.
 */
export async function runConsensusStep(
  claims: Claim[],
  adjudication: AdjudicationResult,
): Promise<ConsensusResult> {
  const verdictMap = new Map(adjudication.verdicts.map(v => [v.claim_id, v]));

  // Step 1: Cluster claims via LLM
  const clusterInput = claims.map(c => ({
    claim_id: c.id,
    statement: c.statement,
    verdict: verdictMap.get(c.id)?.verdict ?? 'Insufficient Evidence',
    source_doc: c.source_doc,
  }));

  const systemPrompt = await readPrompt('consensus-clusterer.md');
  const userPrompt = JSON.stringify(clusterInput, null, 2);

  console.log(`  [consensus] Clustering ${claims.length} claims across providers...`);

  const MAX_RETRIES = 3;
  const BACKOFF_MS = [10_000, 30_000, 60_000]; // 10s, 30s, 60s

  let response;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await callKimiChat(userPrompt, systemPrompt, 32768);
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = msg.includes('timeout') || msg.includes('abort') || msg.includes('429') || msg.includes('overloaded');
      if (!isRetryable || attempt === MAX_RETRIES) {
        throw err;
      }
      const delay = BACKOFF_MS[attempt - 1];
      console.log(`  [consensus] Attempt ${attempt}/${MAX_RETRIES} failed (${msg}), retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  appendTokenRecord('consensus', 'kimi-k2.5', response!.input_tokens, response!.output_tokens);

  let rawGroups: Array<{ group_id: string; claim_ids: string[]; common_topic: string; reasoning: string }>;
  try {
    let jsonStr = response!.content.trim();
    // Strip markdown fences
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }
    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Truncated JSON recovery
      const lastBrace = jsonStr.lastIndexOf('}');
      if (lastBrace > 0) {
        let truncated = jsonStr.substring(0, lastBrace + 1);
        // Try closing the claim_groups array and outer object
        if (!truncated.includes(']}')) {
          truncated += ']}';
        }
        console.log(`  [consensus] Attempting truncated JSON recovery`);
        parsed = JSON.parse(truncated);
      } else {
        throw new Error('Cannot recover truncated JSON');
      }
    }
    rawGroups = parsed.claim_groups;
  } catch (err) {
    throw new Error(`Failed to parse consensus clustering response: ${err}`);
  }

  // Step 2: Build ClaimGroup objects with consensus verdicts
  const claimMap = new Map(claims.map(c => [c.id, c]));
  const claimGroups: ClaimGroup[] = rawGroups.map(rg => {
    const groupedClaims: GroupedClaim[] = rg.claim_ids
      .filter(id => claimMap.has(id) && verdictMap.has(id))
      .map(id => ({
        claim: claimMap.get(id)!,
        verdict: verdictMap.get(id)!,
      }));

    const { verdict, confidence, reasoning, agreement } = applyConsensusRules(groupedClaims);

    return {
      group_id: rg.group_id,
      claims: groupedClaims,
      common_topic: rg.common_topic,
      consensus_verdict: verdict,
      consensus_confidence: confidence,
      consensus_reasoning: reasoning,
      agreement_level: agreement,
    };
  });

  // Step 3: Calculate consensus quality gate
  const consensusGate = calculateConsensusGate(claimGroups);

  // Step 4: Categorize groups
  const highConfidence = claimGroups
    .filter(g => g.consensus_verdict === 'Verified' && g.agreement_level === 'unanimous')
    .map(g => g.group_id);
  const reviewNeeded = claimGroups
    .filter(g => g.consensus_verdict === 'REVIEW')
    .map(g => g.group_id);
  const singleProvider = claimGroups
    .filter(g => g.agreement_level === 'single-provider')
    .map(g => g.group_id);

  // Step 5: Detect systematic issues
  const systematicIssues = detectSystematicIssues(claimGroups);

  console.log(`  [consensus] ${claimGroups.length} groups | ${highConfidence.length} high-confidence | ${reviewNeeded.length} review-needed | ${singleProvider.length} single-provider`);
  console.log(`  [consensus] Quality Gate: ${consensusGate.status} (${(consensusGate.failure_rate * 100).toFixed(1)}% failure rate)`);

  return {
    claim_groups: claimGroups,
    consensus_quality_gate: consensusGate,
    high_confidence_claims: highConfidence,
    review_needed_claims: reviewNeeded,
    single_provider_claims: singleProvider,
    systematic_issues: systematicIssues,
  };
}

/**
 * Democratic voting rules for consensus verdict.
 */
function applyConsensusRules(
  groupedClaims: GroupedClaim[],
): { verdict: ConsensusVerdict; confidence: number; reasoning: string; agreement: ClaimGroup['agreement_level'] } {
  const providers = new Set(groupedClaims.map(gc => gc.claim.source_doc));
  const verdicts = groupedClaims.map(gc => gc.verdict.verdict);
  const n = verdicts.length;

  // Single provider — keep original, reduced confidence
  if (providers.size <= 1) {
    const v = verdicts[0] ?? 'Insufficient Evidence';
    const conf = groupedClaims[0]?.verdict.confidence ?? 0.5;
    return {
      verdict: v,
      confidence: conf * 0.8, // reduce confidence for single-source
      reasoning: `Single provider (${[...providers][0]}); original verdict preserved with reduced confidence.`,
      agreement: 'single-provider',
    };
  }

  const counts: Record<string, number> = { 'Verified': 0, 'Conflicting Evidence': 0, 'Unsupported Claim': 0, 'Insufficient Evidence': 0 };
  for (const v of verdicts) counts[v] = (counts[v] || 0) + 1;

  // Any Unsupported Claim → always flag
  if (counts['Unsupported Claim'] > 0) {
    return {
      verdict: 'Unsupported Claim',
      confidence: 0.9,
      reasoning: `${counts['Unsupported Claim']}/${n} providers flagged unsupported claim — always escalated.`,
      agreement: 'mixed',
    };
  }

  // All verified → unanimous
  if (counts['Verified'] === n) {
    return {
      verdict: 'Verified',
      confidence: Math.min(1.0, Math.min(...groupedClaims.map(gc => gc.verdict.confidence)) * 1.1), // boost, capped at 1.0
      reasoning: `All ${n} providers verified this claim unanimously.`,
      agreement: 'unanimous',
    };
  }

  // Majority verified + rest insufficient evidence → Verified (source access issue)
  if (counts['Verified'] > 0 && counts['Verified'] + counts['Insufficient Evidence'] === n && counts['Verified'] >= counts['Insufficient Evidence']) {
    return {
      verdict: 'Verified',
      confidence: 0.75,
      reasoning: `${counts['Verified']}/${n} verified, ${counts['Insufficient Evidence']} insufficient evidence (likely source access gap). Majority rules.`,
      agreement: 'majority',
    };
  }

  // Majority verified + minority conflicting evidence → REVIEW
  if (counts['Verified'] > counts['Conflicting Evidence'] && counts['Conflicting Evidence'] > 0) {
    return {
      verdict: 'REVIEW',
      confidence: 0.5,
      reasoning: `${counts['Verified']} verified vs ${counts['Conflicting Evidence']} conflicting evidence — needs human review.`,
      agreement: 'mixed',
    };
  }

  // Multiple conflicting evidence → Conflicting Evidence
  if (counts['Conflicting Evidence'] >= 2) {
    return {
      verdict: 'Conflicting Evidence',
      confidence: 0.85,
      reasoning: `${counts['Conflicting Evidence']}/${n} providers found conflicting evidence — likely a real problem.`,
      agreement: 'mixed',
    };
  }

  // All insufficient evidence
  if (counts['Insufficient Evidence'] === n) {
    return {
      verdict: 'Insufficient Evidence',
      confidence: 0.6,
      reasoning: `All ${n} providers could not verify — universal source access issue.`,
      agreement: 'unanimous',
    };
  }

  // No clear majority → REVIEW
  return {
    verdict: 'REVIEW',
    confidence: 0.4,
    reasoning: `No clear majority (V:${counts['Verified']} CE:${counts['Conflicting Evidence']} UC:${counts['Unsupported Claim']} IE:${counts['Insufficient Evidence']}). Flagged for review.`,
    agreement: 'mixed',
  };
}

/**
 * Calculate quality gate from consensus groups (one verdict per group).
 */
function calculateConsensusGate(groups: ClaimGroup[]): QualityGate {
  const counts = { verified: 0, discrepancy: 0, hallucination: 0, unverifiable: 0, review: 0 };

  for (const g of groups) {
    switch (g.consensus_verdict) {
      case 'Verified': counts.verified++; break;
      case 'Conflicting Evidence': counts.discrepancy++; break;
      case 'Unsupported Claim': counts.hallucination++; break;
      case 'Insufficient Evidence': counts.unverifiable++; break;
      case 'REVIEW': counts.review++; break;
    }
  }

  const total = groups.length;
  const verifiable = total - counts.unverifiable;
  // REVIEW counts as a soft failure (needs human check)
  const failureRate = verifiable > 0
    ? (counts.hallucination + counts.discrepancy + counts.review) / verifiable
    : 0;

  return {
    status: failureRate <= CONFIG.qualityGateThreshold ? 'PASSED' : 'REVIEW_RECOMMENDED',
    total_claims: total,
    verified: counts.verified,
    discrepancy: counts.discrepancy,
    hallucination: counts.hallucination,
    unverifiable: counts.unverifiable,
    failure_rate: failureRate,
  };
}

/**
 * Detect systematic patterns across groups.
 */
function detectSystematicIssues(groups: ClaimGroup[]): SystematicIssue[] {
  const issues: SystematicIssue[] = [];

  // Check for universal source access failures (many unverifiable from same provider)
  const unverifiableByProvider = new Map<string, string[]>();
  for (const g of groups) {
    for (const gc of g.claims) {
      if (gc.verdict.verdict === 'Insufficient Evidence') {
        const doc = gc.claim.source_doc;
        if (!unverifiableByProvider.has(doc)) unverifiableByProvider.set(doc, []);
        unverifiableByProvider.get(doc)!.push(g.group_id);
      }
    }
  }

  for (const [provider, groupIds] of unverifiableByProvider) {
    const uniqueGroups = [...new Set(groupIds)];
    if (uniqueGroups.length >= 3) {
      issues.push({
        issue_type: 'source_access',
        affected_groups: uniqueGroups,
        description: `Provider "${provider}" has ${uniqueGroups.length} unverifiable claims — possible systematic source access issue.`,
        severity: uniqueGroups.length >= 5 ? 'high' : 'medium',
      });
    }
  }

  // Check for provider divergence (one provider consistently disagrees)
  const discrepancyByProvider = new Map<string, string[]>();
  for (const g of groups) {
    if (g.consensus_verdict === 'REVIEW' || g.consensus_verdict === 'Conflicting Evidence') {
      for (const gc of g.claims) {
        if (gc.verdict.verdict === 'Conflicting Evidence') {
          const doc = gc.claim.source_doc;
          if (!discrepancyByProvider.has(doc)) discrepancyByProvider.set(doc, []);
          discrepancyByProvider.get(doc)!.push(g.group_id);
        }
      }
    }
  }

  for (const [provider, groupIds] of discrepancyByProvider) {
    const uniqueGroups = [...new Set(groupIds)];
    if (uniqueGroups.length >= 3) {
      issues.push({
        issue_type: 'fact_dispute',
        affected_groups: uniqueGroups,
        description: `Provider "${provider}" flags discrepancies in ${uniqueGroups.length} groups while others verify — possible provider-specific issue.`,
        severity: 'medium',
      });
    }
  }

  return issues;
}
