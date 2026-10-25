import { searchTavily } from '../utils/api.js';
import type { Claim, InvestigationResult } from '../types.js';

/**
 * Step 2: Investigate
 * Search Tavily for evidence supporting/refuting each claim.
 */
export async function runInvestigateStep(
  claims: Claim[],
  onProgress?: (completed: number, total: number) => void,
): Promise<InvestigationResult[]> {
  console.log(`  [investigate] Searching for ${claims.length} claims`);

  const results: InvestigationResult[] = [];

  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i];
    const query = buildSearchQuery(claim);

    try {
      const sources = await searchTavily(query, 3);
      results.push({
        claim_id: claim.id,
        query,
        sources,
      });
    } catch (err) {
      console.error(`  [investigate] Error searching for ${claim.id}: ${err}`);
      results.push({
        claim_id: claim.id,
        query,
        sources: [],
      });
    }

    onProgress?.(i + 1, claims.length);

    // Brief delay between searches to avoid rate limits
    if (i < claims.length - 1) {
      await sleep(200);
    }
  }

  const withSources = results.filter(r => r.sources.length > 0).length;
  console.log(`  [investigate] ${withSources}/${claims.length} claims have sources`);

  return results;
}

function buildSearchQuery(claim: Claim): string {
  // Combine statement and citation for a targeted search
  const parts: string[] = [claim.statement];
  if (claim.citation) {
    parts.push(claim.citation);
  }
  // Truncate to avoid overly long queries
  return parts.join(' ').substring(0, 300);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
