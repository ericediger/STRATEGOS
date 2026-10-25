/**
 * Sprint 4: Security middleware tests.
 *
 * Tests input validation (Zod), CORS configuration, rate limiting headers,
 * and security headers (Helmet). Uses supertest against a test Express app
 * with the same middleware stack as production.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type express from 'express';
import { createTestApp, mountRoutes, cleanupTestApp } from './helpers/test-app.js';

let app: express.Express;

beforeAll(async () => {
  app = createTestApp();
  await mountRoutes(app);
});

afterAll(() => {
  cleanupTestApp();
});

// =============================================================================
// INPUT VALIDATION (Zod schemas)
// =============================================================================

describe('Input Validation', () => {
  it('POST /api/projects with empty name returns 400', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: '' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
    expect(res.body.details).toBeDefined();
  });

  it('POST /api/projects with name exceeding 200 chars returns 400', async () => {
    const longName = 'A'.repeat(201);
    const res = await request(app)
      .post('/api/projects')
      .send({ name: longName })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('POST /api/projects with valid name returns 201', async () => {
    const res = await request(app)
      .post('/api/projects')
      .send({ name: 'Test Project' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(201);
    expect(res.body.project).toBeDefined();
    expect(res.body.project.name).toBe('Test Project');
  });

  it('POST /api/projects with exactly 200 char name returns 201', async () => {
    const maxName = 'B'.repeat(200);
    const res = await request(app)
      .post('/api/projects')
      .send({ name: maxName })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(201);
    expect(res.body.project.name).toBe(maxName);
  });

  it('GET /api/projects/not-a-uuid returns 400', async () => {
    const res = await request(app)
      .get('/api/projects/not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid parameters');
  });

  it('GET /api/projects/{valid-uuid} returns 404 for nonexistent project', async () => {
    const res = await request(app)
      .get('/api/projects/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

    expect(res.status).toBe(404);
  });

  it('POST /api/collaboration/not-a-uuid/chat returns 400', async () => {
    const res = await request(app)
      .post('/api/collaboration/not-a-uuid/chat')
      .send({ message: 'hello' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid parameters');
  });

  it('POST /api/collaboration/{valid-uuid}/chat with empty body returns 400', async () => {
    const uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const res = await request(app)
      .post(`/api/collaboration/${uuid}/chat`)
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('POST /api/collaboration/{valid-uuid}/chat with message exceeding 10000 chars returns 400', async () => {
    const uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const longMessage = 'X'.repeat(10001);
    const res = await request(app)
      .post(`/api/collaboration/${uuid}/chat`)
      .send({ message: longMessage })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});

// =============================================================================
// CORS
// =============================================================================

describe('CORS', () => {
  it('allows requests from http://localhost:5174', async () => {
    const res = await request(app)
      .get('/api/projects')
      .set('Origin', 'http://localhost:5174');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5174');
  });

  it('blocks requests from http://evil.com', async () => {
    const res = await request(app)
      .get('/api/projects')
      .set('Origin', 'http://evil.com');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

// =============================================================================
// RATE LIMITING
// =============================================================================

describe('Rate Limiting', () => {
  it('includes rate limit headers in response', async () => {
    const res = await request(app)
      .get('/api/projects');

    // express-rate-limit with standardHeaders: true sends these headers
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
  });
});

// =============================================================================
// SECURITY HEADERS (Helmet)
// =============================================================================

describe('Security Headers', () => {
  it('includes X-Content-Type-Options: nosniff', async () => {
    const res = await request(app)
      .get('/api/projects');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('includes Content-Security-Policy header', async () => {
    const res = await request(app)
      .get('/api/projects');

    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('includes X-Frame-Options header', async () => {
    const res = await request(app)
      .get('/api/projects');

    expect(res.headers['x-frame-options']).toBeDefined();
  });
});
