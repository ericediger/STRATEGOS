import type { Claim, AdjudicationResult, ClaimVerdict, QualityGate, ConsensusResult } from '../types.js';
import { CONFIG } from '../config.js';

/**
 * Step 4: Generate Verification Report
 * Produce a markdown report organized by source document,
 * with optional cross-provider consensus analysis.
 */
export async function runReportStep(
  claims: Claim[],
  adjudication: AdjudicationResult,
  unitTitle: string,
  unitNumber: number,
  consensus?: ConsensusResult,
): Promise<{ report: string; qualityGate: QualityGate }> {
  const verdictMap = new Map(adjudication.verdicts.map(v => [v.claim_id, v]));
  const perProviderGate = calculateQualityGate(adjudication.verdicts);

  const report = buildReport(claims, verdictMap, perProviderGate, unitTitle, unitNumber, adjudication.summary, consensus);

  const primaryGate = consensus ? consensus.consensus_quality_gate : perProviderGate;
  console.log(`  [report] Quality Gate: ${primaryGate.status} (${(primaryGate.failure_rate * 100).toFixed(1)}% failure rate)`);

  return { report, qualityGate: primaryGate };
}

function calculateQualityGate(verdicts: ClaimVerdict[]): QualityGate {
  const counts = { verified: 0, discrepancy: 0, hallucination: 0, unverifiable: 0 };

  for (const v of verdicts) {
    switch (v.verdict) {
      case 'Verified': counts.verified++; break;
      case 'Conflicting Evidence': counts.discrepancy++; break;
      case 'Unsupported Claim': counts.hallucination++; break;
      case 'Insufficient Evidence': counts.unverifiable++; break;
    }
  }

  const total = verdicts.length;
  const verifiable = total - counts.unverifiable;
  const failureRate = verifiable > 0
    ? (counts.hallucination + counts.discrepancy) / verifiable
    : 0;

  return {
    status: failureRate <= CONFIG.qualityGateThreshold ? 'PASSED' : 'REVIEW_RECOMMENDED',
    total_claims: total,
    ...counts,
    failure_rate: failureRate,
  };
}

function buildReport(
  claims: Claim[],
  verdictMap: Map<string, ClaimVerdict>,
  perProviderGate: QualityGate,
  title: string,
  unitNum: number,
  summary: string,
  consensus?: ConsensusResult,
): string {
  const chStr = String(unitNum).padStart(2, '0');
  const lines: string[] = [];

  lines.push(`# Verification Report — ${title}`);
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push('');

  // Primary quality gate (consensus if available, otherwise per-provider)
  if (consensus) {
    const cg = consensus.consensus_quality_gate;
    lines.push('## Consensus Quality Gate (Primary)');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| **Status** | **${cg.status}** |`);
    lines.push(`| Claim Groups | ${cg.total_claims} |`);
    lines.push(`| Verified | ${cg.verified} |`);
    lines.push(`| Conflicting Evidence | ${cg.discrepancy} |`);
    lines.push(`| Unsupported Claim | ${cg.hallucination} |`);
    lines.push(`| Insufficient Evidence | ${cg.unverifiable} |`);
    lines.push(`| Claims Requiring Additional Evidence | ${(cg.failure_rate * 100).toFixed(1)}% (threshold: ${CONFIG.qualityGateThreshold * 100}%) |`);
    lines.push('');

    // Systematic issues
    if (consensus.systematic_issues.length > 0) {
      lines.push('### Systematic Issues');
      lines.push('');
      for (const issue of consensus.systematic_issues) {
        const icon = issue.severity === 'high' ? '🔴' : issue.severity === 'medium' ? '🟡' : '🟢';
        lines.push(`- ${icon} **${issue.issue_type}** (${issue.severity}): ${issue.description}`);
      }
      lines.push('');
    }

    // Per-provider gate (secondary reference)
    lines.push('## Per-Provider Quality Gate (Reference)');
  } else {
    lines.push('## Quality Gate');
  }
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| **Status** | **${perProviderGate.status}** |`);
  lines.push(`| Total Claims | ${perProviderGate.total_claims} |`);
  lines.push(`| Verified | ${perProviderGate.verified} |`);
  lines.push(`| Conflicting Evidence | ${perProviderGate.discrepancy} |`);
  lines.push(`| Unsupported Claim | ${perProviderGate.hallucination} |`);
  lines.push(`| Insufficient Evidence | ${perProviderGate.unverifiable} |`);
  lines.push(`| Claims Requiring Additional Evidence | ${(perProviderGate.failure_rate * 100).toFixed(1)}% (threshold: ${CONFIG.qualityGateThreshold * 100}%) |`);
  lines.push('');

  if (summary) {
    lines.push('## Summary');
    lines.push('');
    lines.push(summary);
    lines.push('');
  }

  // Consensus analysis section
  if (consensus) {
    lines.push('## Cross-Provider Consensus Analysis');
    lines.push('');

    // High-confidence groups
    if (consensus.high_confidence_claims.length > 0) {
      lines.push('### High-Confidence Claims (Unanimous Verification)');
      lines.push('');
      for (const gid of consensus.high_confidence_claims) {
        const group = consensus.claim_groups.find(g => g.group_id === gid);
        if (group) {
          const providers = [...new Set(group.claims.map(c => c.claim.source_doc))].join(', ');
          lines.push(`- **${gid}**: ${group.common_topic} _(${providers})_`);
        }
      }
      lines.push('');
    }

    // Review-needed groups
    if (consensus.review_needed_claims.length > 0) {
      lines.push('### Claims Requiring Human Review');
      lines.push('');
      for (const gid of consensus.review_needed_claims) {
        const group = consensus.claim_groups.find(g => g.group_id === gid);
        if (group) {
          lines.push(`#### ${gid}: ${group.common_topic}`);
          lines.push('');
          lines.push(`**Consensus:** ${group.consensus_verdict} — ${group.consensus_reasoning}`);
          lines.push('');
          for (const gc of group.claims) {
            const emoji = verdictEmoji(gc.verdict.verdict);
            lines.push(`- ${emoji} **${gc.claim.id}** (${gc.claim.source_doc}): ${gc.verdict.verdict} — ${gc.verdict.reasoning.substring(0, 150)}...`);
          }
          lines.push('');
        }
      }
    }

    // Single-provider claims
    if (consensus.single_provider_claims.length > 0) {
      lines.push('### Single-Provider Claims (Reduced Confidence)');
      lines.push('');
      for (const gid of consensus.single_provider_claims) {
        const group = consensus.claim_groups.find(g => g.group_id === gid);
        if (group) {
          const gc = group.claims[0];
          const emoji = verdictEmoji(group.consensus_verdict);
          lines.push(`- ${emoji} **${gid}** (${gc?.claim.source_doc}): ${group.common_topic} — ${group.consensus_verdict}`);
        }
      }
      lines.push('');
    }

    // Full consensus group detail
    lines.push('### All Consensus Groups');
    lines.push('');
    lines.push('| Group | Topic | Providers | Agreement | Verdict | Confidence |');
    lines.push('|-------|-------|-----------|-----------|---------|------------|');
    for (const g of consensus.claim_groups) {
      const providers = [...new Set(g.claims.map(c => c.claim.source_doc))].join(', ');
      const emoji = verdictEmoji(g.consensus_verdict);
      lines.push(`| ${g.group_id} | ${g.common_topic.substring(0, 50)} | ${providers} | ${g.agreement_level} | ${emoji} ${g.consensus_verdict} | ${(g.consensus_confidence * 100).toFixed(0)}% |`);
    }
    lines.push('');
  }

  // Per-provider detailed results (unchanged)
  lines.push('## Detailed Per-Provider Results');
  lines.push('');

  // Group claims by source document
  const byDoc = new Map<string, Claim[]>();
  for (const claim of claims) {
    const doc = claim.source_doc || 'unknown';
    if (!byDoc.has(doc)) byDoc.set(doc, []);
    byDoc.get(doc)!.push(claim);
  }

  const docLabels: Record<string, string> = {
    edr: 'EDR (DeepSeek + Tavily)',
    gemini: 'Gemini Deep Research',
    openai: 'OpenAI o3-deep-research',
    kimi: 'KIMI Research',
  };

  for (const [doc, docClaims] of byDoc) {
    const label = docLabels[doc] || doc;
    lines.push(`### ${label}`);
    lines.push('');

    for (const claim of docClaims) {
      const verdict = verdictMap.get(claim.id);
      const emoji = verdictEmoji(verdict?.verdict);

      lines.push(`#### ${emoji} ${claim.id}`);
      lines.push('');
      lines.push(`**Claim:** ${claim.statement}`);
      lines.push('');
      lines.push(`**Citation:** ${claim.citation}`);
      lines.push('');
      lines.push(`**Location:** ${claim.location}`);
      lines.push('');

      if (verdict) {
        lines.push(`**Verdict:** ${verdict.verdict} (confidence: ${(verdict.confidence * 100).toFixed(0)}%)`);
        lines.push('');
        lines.push(`**Reasoning:** ${verdict.reasoning}`);
        lines.push('');
        if (verdict.evidence_summary) {
          lines.push(`**Evidence:** ${verdict.evidence_summary}`);
          lines.push('');
        }
      } else {
        lines.push('**Verdict:** Not adjudicated');
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

function verdictEmoji(verdict?: string): string {
  switch (verdict) {
    case 'Verified': return '✅';
    case 'Conflicting Evidence': return '⚠️';
    case 'Unsupported Claim': return '❌';
    case 'Insufficient Evidence': return '❓';
    case 'REVIEW': return '🔍';
    default: return '—';
  }
}
