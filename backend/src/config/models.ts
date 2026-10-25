/**
 * AI models used by the backend, one entry per workflow step.
 *
 * Changing a model here updates both the API call and the llm_calls cost log
 * for that step. When moving to a new model generation, check that the
 * per-call settings at each call site (thinking, max_tokens,
 * reasoning_effort) are still supported by the new model.
 */
export const MODELS = {
  /** Phase 0: scoping chat with the research collaborator (collaboration.ts) */
  collaboration: 'claude-opus-4-6',

  /** Phase 0: synthesize the chat into a Research Brief, adaptive thinking (collaboration.ts) */
  briefSynthesis: 'claude-opus-4-6',

  /** Phase 1: strip unsupported claims from Kimi research output (research.ts) */
  kimiFilter: 'claude-haiku-4-5-20251001',

  /** Phase 3: strategic analysis, OpenAI with reasoning_effort high (analysis.ts) */
  strategicAnalysis: 'gpt-5.2',

  /** Phase 4: artifact generation, adaptive thinking (analysis.ts) */
  artifacts: 'claude-opus-4-6',

  /** Phase 4: Word/PowerPoint export and packet script generation (export.ts) */
  export: 'claude-opus-4-6',
} as const;
