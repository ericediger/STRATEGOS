/**
 * Session 13: Path traversal & filename sanitization tests.
 *
 * Tests import-document endpoint rejects path traversal attempts
 * and sanitizes filenames to prevent directory escape.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type express from 'express';
import { createTestApp, mountRoutes, cleanupTestApp } from './helpers/test-app.js';
import { prepare } from '../db/index.js';

let app: express.Express;
let projectId: string;

beforeAll(async () => {
  app = createTestApp();
  await mountRoutes(app);

  // Create a test project
  const res = await request(app)
    .post('/api/projects')
    .send({ name: 'Path Traversal Test' })
    .set('Content-Type', 'application/json');

  projectId = res.body.project.id;
});

beforeEach(() => {
  // Reset status to brief_approved before each test (imports advance status)
  prepare(`UPDATE projects SET status = 'brief_approved' WHERE id = ?`).run(projectId);
});

afterAll(() => {
  cleanupTestApp();
});

describe('Import Document — Path Traversal Prevention', () => {
  it('rejects filename with path separator (../)', async () => {
    const res = await request(app)
      .post(`/api/collaboration/${projectId}/import-document`)
      .send({
        phase: 'research',
        files: [{ name: '../../../etc/passwd', content: 'malicious content' }],
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
  });

  it('rejects filename with backslash path separator', async () => {
    const res = await request(app)
      .post(`/api/collaboration/${projectId}/import-document`)
      .send({
        phase: 'research',
        files: [{ name: '..\\..\\secret.md', content: 'malicious' }],
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
  });

  it('rejects filename that is just "."', async () => {
    const res = await request(app)
      .post(`/api/collaboration/${projectId}/import-document`)
      .send({
        phase: 'research',
        files: [{ name: '.', content: 'malicious' }],
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
  });

  it('rejects filename that is ".."', async () => {
    const res = await request(app)
      .post(`/api/collaboration/${projectId}/import-document`)
      .send({
        phase: 'research',
        files: [{ name: '..', content: 'malicious' }],
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
  });

  it('accepts a clean filename and saves to research dir', async () => {
    const res = await request(app)
      .post(`/api/collaboration/${projectId}/import-document`)
      .send({
        phase: 'research',
        files: [{ name: 'my-research.md', content: '# Research Document\n\nFindings here.' }],
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const projectRoot = join(process.env.PROJECTS_ROOT!, projectId);
    const filePath = join(projectRoot, 'research', 'my-research.md');
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('# Research Document\n\nFindings here.');
  });

  it('sanitizes special characters in filename', async () => {
    const res = await request(app)
      .post(`/api/collaboration/${projectId}/import-document`)
      .send({
        phase: 'research',
        files: [{ name: 'file with spaces.md', content: 'content' }],
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);

    const projectRoot = join(process.env.PROJECTS_ROOT!, projectId);
    const filePath = join(projectRoot, 'research', 'file_with_spaces.md');
    expect(existsSync(filePath)).toBe(true);
  });

  it('appends .md extension when missing', async () => {
    const res = await request(app)
      .post(`/api/collaboration/${projectId}/import-document`)
      .send({
        phase: 'research',
        files: [{ name: 'report', content: 'content' }],
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);

    const projectRoot = join(process.env.PROJECTS_ROOT!, projectId);
    const filePath = join(projectRoot, 'research', 'report.md');
    expect(existsSync(filePath)).toBe(true);
  });
});

describe('Import Document — Zod Schema Validation', () => {
  it('rejects filename with forward slash via Zod', async () => {
    const res = await request(app)
      .post(`/api/collaboration/${projectId}/import-document`)
      .send({
        phase: 'research',
        files: [{ name: 'path/to/file.md', content: 'content' }],
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('rejects empty filename', async () => {
    const res = await request(app)
      .post(`/api/collaboration/${projectId}/import-document`)
      .send({
        phase: 'research',
        files: [{ name: '', content: 'content' }],
      })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
  });
});
