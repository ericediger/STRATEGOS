/**
 * DeepSeek models used by EDR, one entry per kind of pass.
 *
 * EDR ignores any model_name sent by the research engine; these are the
 * models it actually calls.
 */
export const MODELS = {
  /** Synthesis and refinement passes */
  synthesis: 'deepseek-reasoner',

  /** Query decomposition and gap analysis passes */
  planning: 'deepseek-chat',
} as const;
