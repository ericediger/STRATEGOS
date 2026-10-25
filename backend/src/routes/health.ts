/**
 * Health check endpoint
 */

import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'STRATEGOS',
    timestamp: new Date().toISOString(),
    apiKeys: {
      anthropic: !!process.env.ANTHROPIC_API_KEY,
    },
  });
});

export default router;
