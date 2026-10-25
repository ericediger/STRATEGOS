/**
 * EDR Wrapper API v2 - Deep research using DeepSeek + Tavily
 *
 * Changes from v1:
 * - Increased sub-question decomposition (5-8 questions, up from 3-5)
 * - Full content retrieval from Tavily (no 1,000 char truncation)
 * - Higher synthesis token limit (16,000, up from 8,000)
 * - Added iterative gap analysis: after initial synthesis, identifies gaps and runs additional searches
 * - Added configurable depth via max_iterations parameter
 * - Source deduplication to avoid feeding duplicate content
 * - Chunked context assembly to stay within DeepSeek's context window
 *
 * Inspired by Salesforce EDR: https://github.com/SalesforceAIResearch/enterprise-deep-research
 */

import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from parent directory (research/.env)
const parentEnv = resolve(__dirname, '../../.env');
if (existsSync(parentEnv)) {
  config({ path: parentEnv });
} else {
  config();
}

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const TAVILY_BASE_URL = 'https://api.tavily.com';
const PORT = process.env.EDR_PORT || 9001;

// Tuning constants
const MAX_SUB_QUESTIONS = 8;          // Up from 5
const TAVILY_RESULTS_PER_QUERY = 7;   // Up from 5
const MAX_CONTENT_PER_SOURCE = 6000;  // Up from 1,000 — allows substantial excerpts
const SYNTHESIS_MAX_TOKENS = 16000;   // Up from 8,000
const GAP_ANALYSIS_MAX_TOKENS = 4000;
const MAX_RESEARCH_ITERATIONS = 3;    // Initial + 2 refinement passes
const MAX_CONTEXT_CHARS = 120000;     // ~30K tokens — stay within DeepSeek context window
const SNIPPET_LENGTH = 300;           // For source tracking display

// Types
interface ResearchRequest {
  query: string;
  model_provider?: string;
  model_name?: string;
  search_provider?: string;
  max_iterations?: number;
  include_sources?: boolean;
}

interface TaskData {
  status: 'in_progress' | 'completed' | 'failed';
  progress: number;
  query: string;
  created_at: string;
  report?: string;
  sources?: Array<{ title: string; url: string; snippet: string }>;
  error?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    searches: number;
  };
  log?: string[];
}

interface DeepSeekResponse {
  content: string;
  input_tokens: number;
  output_tokens: number;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
}

// In-memory task storage
const tasks = new Map<string, TaskData>();

// ============== Utility: Deduplicated Source Tracking ==============

class SourceTracker {
  private seen = new Set<string>();
  private sources: Array<{ title: string; url: string; snippet: string }> = [];

  add(result: TavilyResult): boolean {
    const url = result.url ?? '';
    if (this.seen.has(url)) return false;
    this.seen.add(url);
    this.sources.push({
      title: result.title ?? 'Unknown',
      url,
      snippet: (result.content ?? '').slice(0, SNIPPET_LENGTH),
    });
    return true;
  }

  has(url: string): boolean {
    return this.seen.has(url);
  }

  getAll(): Array<{ title: string; url: string; snippet: string }> {
    return [...this.sources];
  }

  get count(): number {
    return this.sources.length;
  }
}

// ============== Health Check ==============

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'edr-wrapper-node-v2',
    config: {
      deepseek_configured: Boolean(DEEPSEEK_API_KEY),
      tavily_configured: Boolean(TAVILY_API_KEY),
    },
    tuning: {
      max_sub_questions: MAX_SUB_QUESTIONS,
      tavily_results_per_query: TAVILY_RESULTS_PER_QUERY,
      max_content_per_source: MAX_CONTENT_PER_SOURCE,
      synthesis_max_tokens: SYNTHESIS_MAX_TOKENS,
      max_research_iterations: MAX_RESEARCH_ITERATIONS,
    },
  });
});

// ============== API Endpoints ==============

app.post('/api/research', async (req, res) => {
  const request: ResearchRequest = req.body;

  if (!DEEPSEEK_API_KEY) {
    return res.status(500).json({ error: 'DEEPSEEK_API_KEY not configured' });
  }
  if (!TAVILY_API_KEY) {
    return res.status(500).json({ error: 'TAVILY_API_KEY not configured' });
  }
  if (!request.query) {
    return res.status(400).json({ error: 'query is required' });
  }

  const taskId = uuidv4();
  tasks.set(taskId, {
    status: 'in_progress',
    progress: 0,
    query: request.query,
    created_at: new Date().toISOString(),
    log: [],
  });

  runResearch(taskId, request).catch((err) => {
    console.error(`Research task ${taskId} failed:`, err);
  });

  res.json({ task_id: taskId, status: 'in_progress' });
});

app.get('/api/research/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = tasks.get(taskId);

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json({
    task_id: taskId,
    status: task.status,
    progress: task.progress,
    report: task.report,
    sources: task.sources,
    error: task.error,
    usage: task.usage,
  });
});

// ============== DeepSeek API ==============

async function callDeepSeek(
  prompt: string,
  maxTokens = SYNTHESIS_MAX_TOKENS,
  useReasoner = true
): Promise<DeepSeekResponse> {
  const model = useReasoner ? 'deepseek-reasoner' : 'deepseek-chat';

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek API error: ${response.status} - ${text}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    content: data.choices[0].message.content,
    input_tokens: data.usage?.prompt_tokens ?? 0,
    output_tokens: data.usage?.completion_tokens ?? 0,
  };
}

// ============== Tavily Search ==============

async function tavilySearch(
  query: string,
  maxResults = TAVILY_RESULTS_PER_QUERY
): Promise<TavilyResult[]> {
  const response = await fetch(`${TAVILY_BASE_URL}/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      search_depth: 'advanced',
      max_results: maxResults,
      include_raw_content: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tavily API error: ${response.status} - ${text}`);
  }

  const data = (await response.json()) as { results?: TavilyResult[] };
  return data.results ?? [];
}

// ============== Context Assembly ==============

/**
 * Build context string from search results, respecting the context window limit.
 * Prefers raw_content (full page) over content (snippet) when available.
 * Truncates individual sources at MAX_CONTENT_PER_SOURCE.
 * Stops adding sources when total context approaches MAX_CONTEXT_CHARS.
 */
function assembleContext(
  searchResults: Array<{ question: string; results: TavilyResult[] }>
): string {
  let context = '';
  let totalChars = 0;

  for (const sr of searchResults) {
    const sectionHeader = `\n\n## Research Area: ${sr.question}\n\n`;
    if (totalChars + sectionHeader.length > MAX_CONTEXT_CHARS) break;
    context += sectionHeader;
    totalChars += sectionHeader.length;

    for (const r of sr.results) {
      // Prefer raw_content (full page text) over content (snippet)
      const sourceContent = (r.raw_content || r.content || '').slice(0, MAX_CONTENT_PER_SOURCE);
      const sourceBlock =
        `### ${r.title ?? 'Unknown Source'}\n` +
        `**URL:** ${r.url ?? ''}\n\n` +
        `${sourceContent}\n\n---\n\n`;

      if (totalChars + sourceBlock.length > MAX_CONTEXT_CHARS) {
        // Try a shorter version with just the content field
        const shortContent = (r.content || '').slice(0, 2000);
        const shortBlock =
          `### ${r.title ?? 'Unknown Source'}\n` +
          `**URL:** ${r.url ?? ''}\n\n` +
          `${shortContent}\n\n---\n\n`;

        if (totalChars + shortBlock.length > MAX_CONTEXT_CHARS) break;
        context += shortBlock;
        totalChars += shortBlock.length;
      } else {
        context += sourceBlock;
        totalChars += sourceBlock.length;
      }
    }
  }

  return context;
}

// ============== Research Pipeline ==============

async function runResearch(
  taskId: string,
  request: ResearchRequest
): Promise<void> {
  const task = tasks.get(taskId);
  if (!task) return;
  const log = (msg: string) => {
    const ts = new Date().toISOString().slice(11, 19);
    const line = `[${ts}] ${msg}`;
    task.log?.push(line);
    console.log(`  [edr:${taskId.slice(0, 8)}] ${msg}`);
  };

  try {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalSearches = 0;
    const sourceTracker = new SourceTracker();
    const maxIterations = request.max_iterations
      ? Math.min(request.max_iterations, MAX_RESEARCH_ITERATIONS)
      : MAX_RESEARCH_ITERATIONS;

    // ==========================================
    // PHASE 1: Query Decomposition
    // ==========================================
    task.progress = 5;
    log('Phase 1: Decomposing research query...');

    const decompositionPrompt = `You are a research planning assistant. Break down the following research query into ${MAX_SUB_QUESTIONS} specific, diverse sub-questions that together would provide comprehensive coverage of the topic.

Think about different angles:
- Company/entity fundamentals (what they do, financials, leadership)
- Product and technology details (features, pricing, architecture, recent changes)
- Market position and competitive dynamics (positioning, differentiation, market share)
- Strategic signals (hiring patterns, partnerships, geographic expansion, M&A signals)
- Risks and vulnerabilities (customer complaints, churn indicators, operational issues)
- Recent developments (last 90 days of news, announcements, changes)

Each sub-question should be specific enough to produce targeted search results. Avoid generic questions like "What is Company X?" — instead ask "What is Company X's current pricing structure and how has it changed in the last year?"

Query: ${request.query}

Return ONLY a JSON array of ${MAX_SUB_QUESTIONS} strings, each being a focused sub-question.`;

    const decomposition = await callDeepSeek(decompositionPrompt, 2000, false);
    totalInputTokens += decomposition.input_tokens;
    totalOutputTokens += decomposition.output_tokens;

    let questions: string[];
    try {
      // Handle potential markdown code fences in response
      const cleaned = decomposition.content.replace(/```json\s*|\s*```/g, '').trim();
      questions = JSON.parse(cleaned);
      if (!Array.isArray(questions)) {
        questions = [request.query];
      }
    } catch {
      log('Warning: Could not parse decomposition, using original query');
      questions = [request.query];
    }

    questions = questions.slice(0, MAX_SUB_QUESTIONS);
    log(`Decomposed into ${questions.length} sub-questions`);

    // ==========================================
    // PHASE 2: Initial Search Pass
    // ==========================================
    task.progress = 15;
    log(`Phase 2: Searching ${questions.length} sub-questions...`);

    const allSearchResults: Array<{
      question: string;
      results: TavilyResult[];
    }> = [];

    for (let i = 0; i < questions.length; i++) {
      const question = questions[i];
      try {
        const results = await tavilySearch(question);
        const newResults = results.filter((r) => {
          const isNew = sourceTracker.add(r);
          return isNew || !r.url; // Keep results even if URL tracking fails
        });
        allSearchResults.push({ question, results });
        totalSearches++;
        log(`  Q${i + 1}: "${question.slice(0, 60)}..." → ${results.length} results (${newResults.length} new)`);
      } catch (err) {
        log(`  Q${i + 1}: Search error — ${(err as Error).message}`);
      }

      task.progress = 15 + Math.round(((i + 1) / questions.length) * 30);
    }

    log(`Initial search complete: ${sourceTracker.count} unique sources`);

    // ==========================================
    // PHASE 3: Initial Synthesis
    // ==========================================
    task.progress = 50;
    log('Phase 3: Synthesizing initial findings...');

    const context = assembleContext(allSearchResults);
    log(`Context assembled: ${context.length} chars (~${Math.round(context.length / 4)} tokens)`);

    const synthesisPrompt = `You are a thorough research analyst. Based on the following research query and gathered information, write a comprehensive, detailed research report.

IMPORTANT: This is deep research, not a summary. Write with the depth and specificity of a professional analyst report. Include specific numbers, dates, names, and evidence throughout. When sources provide useful detail, incorporate it. When you identify patterns across sources, analyze them.

ORIGINAL QUERY:
${request.query}

GATHERED INFORMATION FROM ${sourceTracker.count} SOURCES:
${context}

INSTRUCTIONS:
1. Write a comprehensive, well-structured report with clear sections and subsections
2. Cite sources inline using [Source Title](URL) format
3. Include specific data points, quotes, numbers, and dates — not vague summaries
4. Cover all angles: fundamentals, product/technology, market position, strategic signals, risks, and recent developments
5. When sources conflict, note the conflict and present both perspectives
6. Identify gaps — areas where the gathered information is thin or missing
7. Use markdown formatting with headers, subheaders, tables where appropriate

Do NOT write a brief or executive summary. Write a thorough report. Depth matters more than brevity.

Write the complete research report:`;

    const synthesis = await callDeepSeek(synthesisPrompt, SYNTHESIS_MAX_TOKENS);
    totalInputTokens += synthesis.input_tokens;
    totalOutputTokens += synthesis.output_tokens;

    let currentReport = synthesis.content;
    const initialWords = currentReport.split(/\s+/).filter(Boolean).length;
    log(`Initial synthesis: ${initialWords} words`);

    // ==========================================
    // PHASE 4: Iterative Gap Analysis & Refinement
    // ==========================================
    for (let iteration = 1; iteration < maxIterations; iteration++) {
      task.progress = 50 + Math.round((iteration / maxIterations) * 35);
      log(`Phase 4.${iteration}: Gap analysis (iteration ${iteration}/${maxIterations - 1})...`);

      // Ask DeepSeek to identify gaps
      const gapPrompt = `You are a research quality reviewer. Analyze the following research report and identify the 3-5 most important information gaps — areas where the report is thin, vague, or missing concrete evidence.

For each gap, generate a specific search query that would help fill it. Focus on:
- Claims made without supporting evidence
- Sections that are vague where specifics would be available (e.g., "pricing is competitive" without actual prices)
- Important angles that weren't covered at all
- Recent developments that may not have been captured

RESEARCH REPORT:
${currentReport.slice(0, 60000)}

Return ONLY a JSON array of objects, each with "gap" (description) and "query" (search query). Example:
[
  {"gap": "No specific pricing data for Company X", "query": "Company X pricing plans 2025"},
  {"gap": "Missing recent product launches", "query": "Company X product announcements last 3 months"}
]`;

      let gaps: Array<{ gap: string; query: string }>;
      try {
        const gapAnalysis = await callDeepSeek(gapPrompt, GAP_ANALYSIS_MAX_TOKENS, false);
        totalInputTokens += gapAnalysis.input_tokens;
        totalOutputTokens += gapAnalysis.output_tokens;

        const cleaned = gapAnalysis.content.replace(/```json\s*|\s*```/g, '').trim();
        gaps = JSON.parse(cleaned);
        if (!Array.isArray(gaps) || gaps.length === 0) {
          log(`  No gaps identified, skipping refinement`);
          break;
        }
      } catch {
        log(`  Gap analysis parsing failed, skipping refinement`);
        break;
      }

      gaps = gaps.slice(0, 5);
      log(`  Found ${gaps.length} gaps to fill`);

      // Search for gap-filling content
      const gapSearchResults: Array<{ question: string; results: TavilyResult[] }> = [];
      for (const gap of gaps) {
        try {
          const results = await tavilySearch(gap.query, 5);
          const newResults = results.filter((r) => sourceTracker.add(r));
          if (newResults.length > 0) {
            gapSearchResults.push({ question: `[GAP: ${gap.gap}] ${gap.query}`, results });
            totalSearches++;
            log(`  "${gap.query.slice(0, 50)}..." → ${newResults.length} new sources`);
          }
        } catch (err) {
          log(`  Gap search error: ${(err as Error).message}`);
        }
      }

      if (gapSearchResults.length === 0) {
        log(`  No new sources found for gaps, stopping refinement`);
        break;
      }

      // Build supplemental context and ask for report enhancement
      const gapContext = assembleContext(gapSearchResults);

      const refinementPrompt = `You are a research analyst enhancing a report with newly gathered information. Below is the current report and additional sources gathered to fill identified gaps.

Your job: Produce an UPDATED, COMPLETE version of the report that integrates the new information. Do not simply append — weave the new evidence into the relevant sections. Expand sections that were previously thin. Add new subsections if warranted.

The output should be the full, enhanced report — not just the additions.

CURRENT REPORT:
${currentReport.slice(0, 50000)}

NEW INFORMATION TO INTEGRATE:
${gapContext}

Write the complete, enhanced research report:`;

      const refinement = await callDeepSeek(refinementPrompt, SYNTHESIS_MAX_TOKENS);
      totalInputTokens += refinement.input_tokens;
      totalOutputTokens += refinement.output_tokens;

      // Only accept refinement if it's actually longer/better
      const refinedWords = refinement.content.split(/\s+/).filter(Boolean).length;
      const currentWords = currentReport.split(/\s+/).filter(Boolean).length;

      if (refinedWords > currentWords * 0.9) {
        currentReport = refinement.content;
        log(`  Refinement accepted: ${currentWords} → ${refinedWords} words`);
      } else {
        log(`  Refinement rejected (${refinedWords} words < 90% of ${currentWords}), keeping previous version`);
      }
    }

    // ==========================================
    // PHASE 5: Complete
    // ==========================================
    const finalWords = currentReport.split(/\s+/).filter(Boolean).length;
    task.status = 'completed';
    task.progress = 100;
    task.report = currentReport;
    task.sources = sourceTracker.getAll();
    task.usage = {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      searches: totalSearches,
    };

    log(`Research complete: ${finalWords} words, ${sourceTracker.count} sources, ${totalSearches} searches`);
    log(`Tokens: ${totalInputTokens} in / ${totalOutputTokens} out`);
  } catch (err) {
    task.status = 'failed';
    task.error = err instanceof Error ? err.message : String(err);
    log(`FAILED: ${task.error}`);
  }
}

// ============== Start Server ==============

app.listen(PORT, () => {
  console.log(`
╔═════════════════════════════════════════════════════════╗
║           EDR Wrapper v2 - Node.js Edition              ║
╠═════════════════════════════════════════════════════════╣
║  Port:       ${String(PORT).padEnd(41)}║
║  DeepSeek:   ${(DEEPSEEK_API_KEY ? 'configured' : 'NOT CONFIGURED').padEnd(41)}║
║  Tavily:     ${(TAVILY_API_KEY ? 'configured' : 'NOT CONFIGURED').padEnd(41)}║
║  Iterations: ${String(MAX_RESEARCH_ITERATIONS).padEnd(41)}║
║  Tokens/syn: ${String(SYNTHESIS_MAX_TOKENS).padEnd(41)}║
╚═════════════════════════════════════════════════════════╝
`);
});
