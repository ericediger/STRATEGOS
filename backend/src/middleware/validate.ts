/**
 * Zod validation middleware for Express routes.
 * Validates request body and params against Zod schemas.
 */

import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export function validateBody(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: err.issues.map((e: z.core.$ZodIssue) => ({ path: e.path.join('.'), message: e.message })),
        });
      }
      next(err);
    }
  };
}

export function validateParams(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = schema.parse(req.params) as any;
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Invalid parameters',
          details: err.issues.map((e: z.core.$ZodIssue) => ({ path: e.path.join('.'), message: e.message })),
        });
      }
      next(err);
    }
  };
}

export function validateQuery(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query) as any;
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Invalid query parameters',
          details: err.issues.map((e: z.core.$ZodIssue) => ({ path: e.path.join('.'), message: e.message })),
        });
      }
      next(err);
    }
  };
}
