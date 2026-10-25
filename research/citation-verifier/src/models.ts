/**
 * Kimi models used by the citation verifier, one entry per call path in
 * utils/api.ts.
 *
 * Changing a model here updates the API call and the token log for those
 * steps. Both calls send `thinking: { type: 'disabled' }` with temperature
 * 0.6 so structured JSON lands in the content field; check that a new model
 * still supports those settings.
 */
export const MODELS = {
  /** Claim extraction, consensus and sizing (callKimiChat) */
  chat: 'kimi-k2.6',

  /** Final verdicts on all claims (callKimiReasoner) */
  adjudication: 'kimi-k2.6',
} as const;
