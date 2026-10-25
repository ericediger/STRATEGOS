/**
 * Anthropic Claude client
 *
 * Only client needed for Phase 0.
 * Uses ANTHROPIC_API_KEY from environment.
 */

import Anthropic from '@anthropic-ai/sdk';

export const anthropic = new Anthropic();
