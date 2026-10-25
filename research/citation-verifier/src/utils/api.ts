import { Agent, setGlobalDispatcher } from 'undici';
import { CONFIG } from '../config.js';
import { MODELS } from '../models.js';
import { DiskCache } from './cache.js';
import type { LLMResponse, TavilySource } from '../types.js';

const tavilyCache = new DiskCache<TavilySource[]>();

// Long-running LLM calls need generous timeouts (default headersTimeout is 300s)
const LLM_TIMEOUT_MS = 1_500_000; // 25 minutes
setGlobalDispatcher(new Agent({
  headersTimeout: LLM_TIMEOUT_MS,
  bodyTimeout: LLM_TIMEOUT_MS,
  connectTimeout: 30_000,
}));

/** Call Kimi chat (MODELS.chat) with thinking disabled (verification: extraction, consensus, sizing).
 *  Thinking disabled ensures all output goes to content field (not reasoning_content),
 *  which is required for structured JSON responses. Temp must be 0.6 when thinking is off. */
export async function callKimiChat(
  userPrompt: string,
  systemPrompt: string,
  maxTokens = 8192,
): Promise<LLMResponse> {
  // @ts-ignore — dispatcher is undici-specific but works with Node native fetch
  const response = await fetch(`${CONFIG.kimiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.kimiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELS.chat,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.6,
      thinking: { type: 'disabled' },
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kimi-chat error ${response.status}: ${text}`);
  }

  const data = await response.json() as any;
  const msg = data.choices[0].message;
  const content = msg.content || '';
  console.log(`  [kimi-chat] finish_reason=${data.choices[0].finish_reason}, content=${content.length} chars`);
  return {
    content,
    input_tokens: data.usage?.prompt_tokens ?? 0,
    output_tokens: data.usage?.completion_tokens ?? 0,
  };
}

/** Call Kimi (MODELS.adjudication) for adjudication (thinking disabled for structured JSON output).
 *  Previously used thinking mode, but K2.6 thinking consumes tokens on reasoning_content
 *  before generating the verdict JSON, causing truncation on large claim batches. */
export async function callKimiReasoner(
  prompt: string,
  maxTokens = 8192,
): Promise<LLMResponse> {
  // @ts-ignore — dispatcher is undici-specific but works with Node native fetch
  const response = await fetch(`${CONFIG.kimiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.kimiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELS.adjudication,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.6,
      thinking: { type: 'disabled' },
    }),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Kimi-reasoner error ${response.status}: ${text}`);
  }

  const data = await response.json() as any;
  return {
    content: data.choices[0].message.content,
    input_tokens: data.usage?.prompt_tokens ?? 0,
    output_tokens: data.usage?.completion_tokens ?? 0,
  };
}

/** Search Tavily with disk caching (24h TTL). */
export async function searchTavily(
  query: string,
  maxResults = 5,
): Promise<TavilySource[]> {
  const cacheKey = `${query}::${maxResults}`;
  const cached = await tavilyCache.get(cacheKey);
  if (cached) {
    console.log(`  [tavily-cache] HIT: ${query.substring(0, 60)}...`);
    return cached;
  }

  const response = await fetch(`${CONFIG.tavilyBaseUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: CONFIG.tavilyApiKey,
      query,
      search_depth: 'advanced',
      max_results: maxResults,
      include_raw_content: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tavily error ${response.status}: ${text}`);
  }

  const data = await response.json() as any;
  const results: TavilySource[] = (data.results ?? []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    content: r.content || '',
    raw_content: r.raw_content,
    score: r.score ?? 0,
  }));

  await tavilyCache.set(cacheKey, results);
  return results;
}
