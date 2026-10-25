/**
 * AI models used by the research engine (server.js), one entry per provider step.
 *
 * Changing a model here updates the API call for that step. When moving to a
 * new model, check that the request settings at each call site are still
 * supported (Gemini thinking_level / max_output_tokens; Kimi temperature,
 * max_tokens and the built-in $web_search tool).
 *
 * EDR chooses its own models: see research/edr-node/src/models.ts.
 */
export const MODELS = {
  /** Gemini step 1: Deep Research agent run (sent as `agent`, not `model`) */
  geminiDeepResearch: 'deep-research-pro-preview-12-2025',

  /** Gemini step 2: expand the Deep Research output */
  geminiExpansion: 'gemini-3-pro-preview',

  /** Kimi: deep research with built-in $web_search */
  kimiResearch: 'kimi-k2-thinking',
};
