import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// We test via direct DB access since logLLMCall uses the prepare() helper internally
// Set up in-memory DB and mock the db module

let db: Database.Database;

vi.mock('../db/index.js', () => {
  return {
    prepare: (sql: string) => db.prepare(sql),
    getDb: () => db,
  };
});

import { logLLMCall, extractAnthropicUsage, extractOpenAIUsage } from '../services/llm-logger.js';

describe('LLM Logger', () => {
  beforeEach(() => {
    db = new Database(':memory:');
    const schema = readFileSync(join(__dirname, '../db/schema.sql'), 'utf-8');
    db.exec(schema);
  });

  afterEach(() => {
    db.close();
  });

  it('writes a complete record with all fields', () => {
    logLLMCall({
      project_id: 'proj-123',
      phase: 'collaboration',
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      input_tokens: 500,
      output_tokens: 1200,
      duration_ms: 3500,
    });

    const rows = db.prepare('SELECT * FROM llm_calls').all() as any[];
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.project_id).toBe('proj-123');
    expect(row.phase).toBe('collaboration');
    expect(row.model).toBe('claude-opus-4-6');
    expect(row.provider).toBe('anthropic');
    expect(row.prompt_tokens).toBe(500);
    expect(row.completion_tokens).toBe(1200);
    expect(row.total_tokens).toBe(1700);
    expect(row.latency_ms).toBe(3500);
    expect(row.status).toBe('success');
    expect(row.error).toBeNull();
    expect(row.created_at).toBeTruthy();
  });

  it('does not throw when DB write fails (non-blocking)', () => {
    // Close DB to force write failure
    db.close();
    // Re-open a fresh one so afterEach doesn't fail
    const freshDb = new Database(':memory:');

    // Should not throw
    expect(() => {
      logLLMCall({
        project_id: 'proj-123',
        phase: 'collaboration',
        model: 'claude-opus-4-6',
        provider: 'anthropic',
        input_tokens: 100,
        output_tokens: 200,
        duration_ms: 1000,
      });
    }).not.toThrow();

    freshDb.close();
    // Re-create for afterEach
    db = new Database(':memory:');
  });

  it('correctly maps Anthropic response usage', () => {
    const mockResponse = {
      usage: { input_tokens: 350, output_tokens: 800 },
    };

    const usage = extractAnthropicUsage(mockResponse);
    expect(usage.input_tokens).toBe(350);
    expect(usage.output_tokens).toBe(800);
  });

  it('correctly maps OpenAI response usage', () => {
    const mockResponse = {
      usage: { prompt_tokens: 420, completion_tokens: 1500 },
    };

    const usage = extractOpenAIUsage(mockResponse);
    expect(usage.input_tokens).toBe(420);
    expect(usage.output_tokens).toBe(1500);
  });

  it('handles missing usage data gracefully', () => {
    const noUsage = extractAnthropicUsage({});
    expect(noUsage.input_tokens).toBeNull();
    expect(noUsage.output_tokens).toBeNull();

    const nullUsage = extractOpenAIUsage({ usage: null });
    expect(nullUsage.input_tokens).toBeNull();
    expect(nullUsage.output_tokens).toBeNull();
  });

  it('records error status and message', () => {
    logLLMCall({
      project_id: 'proj-456',
      phase: 'analysis',
      model: 'gpt-5.2',
      provider: 'openai',
      input_tokens: null,
      output_tokens: null,
      duration_ms: 500,
      status: 'error',
      error: 'Rate limited',
    });

    const rows = db.prepare('SELECT * FROM llm_calls').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('error');
    expect(rows[0].error).toBe('Rate limited');
  });

  it('handles null token values with null total_tokens', () => {
    logLLMCall({
      project_id: 'proj-789',
      phase: 'export',
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      input_tokens: null,
      output_tokens: null,
      duration_ms: 2000,
    });

    const rows = db.prepare('SELECT * FROM llm_calls').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].prompt_tokens).toBeNull();
    expect(rows[0].completion_tokens).toBeNull();
    expect(rows[0].total_tokens).toBeNull();
  });

  it('generates unique IDs for each record', () => {
    logLLMCall({ project_id: 'p1', phase: 'collaboration', model: 'm1', provider: 'anthropic', input_tokens: 10, output_tokens: 20, duration_ms: 100 });
    logLLMCall({ project_id: 'p1', phase: 'collaboration', model: 'm1', provider: 'anthropic', input_tokens: 10, output_tokens: 20, duration_ms: 100 });

    const rows = db.prepare('SELECT id FROM llm_calls').all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].id).not.toBe(rows[1].id);
  });
});
