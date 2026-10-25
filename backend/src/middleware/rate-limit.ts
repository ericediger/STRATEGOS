/**
 * Rate limiting middleware configuration.
 *
 * Two tiers:
 * - Global: 300 requests per 15 minutes (all routes)
 * - AI operations: 20 per hour (expensive model calls)
 */

import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a few minutes.' },
});

export const aiOperationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI operations. Please wait before trying again.' },
});
