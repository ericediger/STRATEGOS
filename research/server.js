import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

// Load environment variables
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4456;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Initialize SQLite database
const db = new Database(join(__dirname, 'research.db'));

// Create tables (fresh schema — no migrations)
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    topic_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    context TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER NOT NULL,
    provider TEXT NOT NULL CHECK(provider IN ('gemini', 'edr', 'kimi')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'polling', 'completed', 'failed', 'rate_limited', 'stopped')),
    external_id TEXT,
    result TEXT,
    error TEXT,
    tokens_input INTEGER,
    tokens_output INTEGER,
    retry_count INTEGER DEFAULT 0,
    retry_after DATETIME,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    exported_at DATETIME,
    export_path TEXT,
    FOREIGN KEY (topic_id) REFERENCES topics(id)
  );

  CREATE TABLE IF NOT EXISTS rate_limits (
    provider TEXT PRIMARY KEY,
    daily_count INTEGER DEFAULT 0,
    daily_limit INTEGER DEFAULT 20,
    last_reset DATE DEFAULT (date('now')),
    last_request DATETIME
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_topic ON tasks(topic_id);
`);

// Migration: add 'stopped' to tasks status CHECK constraint if not already present
const tableSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get();
if (tableSchema && !tableSchema.sql.includes('stopped')) {
  console.log('[migration] Adding stopped status to tasks table...');
  db.exec(`
    CREATE TABLE tasks_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('gemini', 'edr', 'kimi')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'polling', 'completed', 'failed', 'rate_limited', 'stopped')),
      external_id TEXT,
      result TEXT,
      error TEXT,
      tokens_input INTEGER,
      tokens_output INTEGER,
      retry_count INTEGER DEFAULT 0,
      retry_after DATETIME,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      exported_at DATETIME,
      export_path TEXT,
      FOREIGN KEY (topic_id) REFERENCES topics(id)
    );
    INSERT INTO tasks_new SELECT * FROM tasks;
    DROP TABLE tasks;
    ALTER TABLE tasks_new RENAME TO tasks;
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_topic ON tasks(topic_id);
  `);
  console.log('[migration] Tasks table migrated successfully');
}

// Migration: add gemini_query column to projects table
const projectSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'").get();
if (projectSchema && !projectSchema.sql.includes('gemini_query')) {
  console.log('[migration] Adding gemini_query column to projects table...');
  db.exec(`ALTER TABLE projects ADD COLUMN gemini_query TEXT`);
  console.log('[migration] Projects table migrated successfully');
}

// Migration: add gemini_expansion_prompt column to projects table
const projectSchema2 = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'").get();
if (projectSchema2 && !projectSchema2.sql.includes('gemini_expansion_prompt')) {
  console.log('[migration] Adding gemini_expansion_prompt column to projects table...');
  db.exec(`ALTER TABLE projects ADD COLUMN gemini_expansion_prompt TEXT`);
  console.log('[migration] Projects table migrated successfully');
}

// Gemini exponential backoff state for 429 rate-limit responses
let geminiPollIntervalMs = 60000; // Default 60s, increases on 429
const GEMINI_BACKOFF_CAP_MS = 480000; // 8 minutes max
const GEMINI_DEFAULT_INTERVAL_MS = 60000;

// Initialize rate limit tracking
const providers = ['kimi', 'gemini', 'edr'];
providers.forEach(provider => {
  const limits = { kimi: 20, gemini: 30, edr: 50 };
  db.prepare(`
    INSERT OR IGNORE INTO rate_limits (provider, daily_limit) VALUES (?, ?)
  `).run(provider, limits[provider]);
});

// Ensure outputs directory exists
const outputsDir = join(__dirname, 'outputs');
if (!existsSync(outputsDir)) {
  await mkdir(outputsDir, { recursive: true });
}

// ============== API Routes ==============

// Get all projects
app.get('/api/projects', (req, res) => {
  const projects = db.prepare(`
    SELECT p.*,
           COUNT(DISTINCT t2.id) as topic_count,
           COUNT(DISTINCT tk.id) as task_count,
           SUM(CASE WHEN tk.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks
    FROM projects p
    LEFT JOIN topics t2 ON t2.project_id = p.id
    LEFT JOIN tasks tk ON tk.topic_id = t2.id
    GROUP BY p.id
    ORDER BY p.created_at DESC
  `).all();
  res.json(projects);
});

// Create project
app.post('/api/projects', (req, res) => {
  const {
    name,
    systemPrompt,
    system_prompt,
    gemini_query,
    gemini_expansion_prompt,
    topics
  } = req.body;
  const prompt = systemPrompt || system_prompt;

  const insertProject = db.prepare(`
    INSERT INTO projects (name, system_prompt, gemini_query, gemini_expansion_prompt) VALUES (?, ?, ?, ?)
  `);
  const insertTopic = db.prepare(`
    INSERT INTO topics (project_id, topic_number, title, context) VALUES (?, ?, ?, ?)
  `);
  const insertTask = db.prepare(`
    INSERT INTO tasks (topic_id, provider, status) VALUES (?, ?, 'queued')
  `);

  const transaction = db.transaction(() => {
    const projectResult = insertProject.run(name, prompt, gemini_query || null, gemini_expansion_prompt || null);
    const projectId = projectResult.lastInsertRowid;

    topics.forEach((topic, index) => {
      const topicResult = insertTopic.run(projectId, index + 1, topic.title, topic.context);
      const topicId = topicResult.lastInsertRowid;

      // Create task for each provider
      providers.forEach(provider => {
        insertTask.run(topicId, provider);
      });
    });

    return projectId;
  });

  try {
    const projectId = transaction();
    res.json({ id: projectId, message: 'Project created successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get project details with topics and tasks
app.get('/api/projects/:id', (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const topics = db.prepare(`
    SELECT t2.*,
           json_group_array(json_object(
             'id', tk.id,
             'provider', tk.provider,
             'status', tk.status,
             'error', tk.error,
             'tokens_input', tk.tokens_input,
             'tokens_output', tk.tokens_output,
             'started_at', tk.started_at,
             'completed_at', tk.completed_at
           )) as tasks
    FROM topics t2
    LEFT JOIN tasks tk ON tk.topic_id = t2.id
    WHERE t2.project_id = ?
    GROUP BY t2.id
    ORDER BY t2.topic_number
  `).all(req.params.id);

  // Parse tasks JSON
  topics.forEach(t => {
    t.tasks = JSON.parse(t.tasks);
  });

  res.json({ ...project, topics });
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {
  const transaction = db.transaction(() => {
    const topics = db.prepare('SELECT id FROM topics WHERE project_id = ?').all(req.params.id);
    const topicIds = topics.map(t => t.id);

    if (topicIds.length > 0) {
      db.prepare(`DELETE FROM tasks WHERE topic_id IN (${topicIds.join(',')})`).run();
    }

    db.prepare('DELETE FROM topics WHERE project_id = ?').run(req.params.id);
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  });

  try {
    transaction();
    res.json({ message: 'Project deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'strategos-research',
    config: {
      kimi_configured: !!process.env.KIMI_API_KEY,
      gemini_configured: !!process.env.GEMINI_API_KEY
    }
  });
});

// Get queue status
app.get('/api/queue', (req, res) => {
  const tasks = db.prepare(`
    SELECT tk.*, t2.topic_number, t2.title as topic_title, p.name as project_name
    FROM tasks tk
    JOIN topics t2 ON t2.id = tk.topic_id
    JOIN projects p ON p.id = t2.project_id
    WHERE tk.status IN ('queued', 'running', 'polling', 'rate_limited', 'failed')
    ORDER BY t2.project_id, t2.topic_number, tk.provider
  `).all();

  const rateLimits = db.prepare("SELECT * FROM rate_limits WHERE provider IN ('kimi', 'gemini', 'edr')").all();

  const globalStats = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
      SUM(CASE WHEN status = 'polling' THEN 1 ELSE 0 END) as polling,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited
    FROM tasks
  `).get();

  res.json({ tasks, rateLimits, globalStats });
});

// Start processing queue
app.post('/api/queue/start', async (req, res) => {
  res.json({ message: 'Queue processing started' });
  processQueue(); // Fire and forget
});

// Stop processing
let processingActive = false;
app.post('/api/queue/stop', (req, res) => {
  processingActive = false;
  res.json({ message: 'Queue processing will stop after current tasks complete' });
});

// Get processing status
app.get('/api/queue/status', (req, res) => {
  res.json({ active: processingActive });
});

// Retry failed tasks
app.post('/api/tasks/:id/retry', (req, res) => {
  db.prepare(`
    UPDATE tasks SET status = 'queued', error = NULL, retry_count = 0, retry_after = NULL
    WHERE id = ?
  `).run(req.params.id);
  res.json({ message: 'Task queued for retry' });
});

// Reset all tasks for a project
app.post('/api/projects/:id/reset-tasks', (req, res) => {
  const { provider } = req.query;

  let sql = `
    UPDATE tasks SET status = 'queued', error = NULL, retry_count = 0, retry_after = NULL,
                     started_at = NULL, completed_at = NULL, external_id = NULL, result = NULL
    WHERE topic_id IN (SELECT id FROM topics WHERE project_id = ?)
  `;

  const params = [req.params.id];

  if (provider) {
    sql += ' AND provider = ?';
    params.push(provider);
  }

  const result = db.prepare(sql).run(...params);
  res.json({
    success: true,
    message: `Reset ${result.changes} tasks${provider ? ` for provider ${provider}` : ''}`,
    tasksReset: result.changes
  });
});

// Get task result
app.get('/api/tasks/:id/result', (req, res) => {
  const task = db.prepare('SELECT result, tokens_input, tokens_output FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }
  res.json({
    result: task.result,
    tokens_input: task.tokens_input,
    tokens_output: task.tokens_output
  });
});

// Get token usage stats for a project
app.get('/api/projects/:id/stats', (req, res) => {
  const stats = db.prepare(`
    SELECT
      tk.provider,
      SUM(tk.tokens_input) as total_input,
      SUM(tk.tokens_output) as total_output,
      COUNT(*) as task_count,
      SUM(CASE WHEN tk.status = 'completed' THEN 1 ELSE 0 END) as completed_count,
      ROUND(AVG(CASE WHEN tk.status = 'completed' AND tk.started_at IS NOT NULL AND tk.completed_at IS NOT NULL
        THEN (julianday(tk.completed_at) - julianday(tk.started_at)) * 86400
        ELSE NULL END), 1) as avg_duration_seconds
    FROM tasks tk
    JOIN topics t2 ON t2.id = tk.topic_id
    WHERE t2.project_id = ?
    GROUP BY tk.provider
  `).all(req.params.id);

  const totals = {
    input_tokens: stats.reduce((sum, s) => sum + (s.total_input || 0), 0),
    output_tokens: stats.reduce((sum, s) => sum + (s.total_output || 0), 0),
    total_tasks: stats.reduce((sum, s) => sum + s.task_count, 0),
    completed_tasks: stats.reduce((sum, s) => sum + s.completed_count, 0)
  };

  res.json({ by_provider: stats, totals });
});

// ============== Auto-Export Helper ==============

async function exportTaskResult(taskId) {
  const task = db.prepare(`
    SELECT tk.*, t2.topic_number, t2.title as topic_title, p.id as project_id, p.name as project_name
    FROM tasks tk
    JOIN topics t2 ON t2.id = tk.topic_id
    JOIN projects p ON p.id = t2.project_id
    WHERE tk.id = ? AND tk.status = 'completed' AND tk.result IS NOT NULL
  `).get(taskId);

  if (!task) {
    console.log(`Export skipped: Task ${taskId} not found or has no result`);
    return null;
  }

  const researchDir = join(outputsDir, `project-${task.project_id}`, 'research');
  await mkdir(researchDir, { recursive: true });

  const filename = `topic${String(task.topic_number).padStart(2, '0')}-${task.topic_title.replace(/[^a-z0-9]/gi, '_').substring(0, 30)}-${task.provider}.md`;
  const filepath = join(researchDir, filename);

  await writeFile(filepath, task.result || '');

  db.prepare(`
    UPDATE tasks SET exported_at = datetime('now'), export_path = ? WHERE id = ?
  `).run(filepath, taskId);

  console.log(`Exported task ${taskId} to ${filepath}`);

  return { filepath, filename, projectId: task.project_id, taskId };
}

// ============== Citation URL Resolution ==============

/**
 * Resolve a Google grounding redirect URL to its final destination.
 * Uses HTTP HEAD with redirect: 'manual' to capture the Location header.
 * Returns the resolved URL on success, or the original URL on failure.
 */
async function resolveRedirectUrl(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(5000) // 5s per URL
    });
    const location = response.headers.get('location');
    if (location) {
      return location;
    }
    // Some redirects return 200 with no Location — try GET as fallback
    if (response.status >= 300 && response.status < 400) {
      return url; // redirect status but no Location header
    }
    return url;
  } catch {
    return url; // timeout or network error — keep original
  }
}

/**
 * Resolve all Gemini citation redirect URLs in parallel.
 * Budget: 30s total for all URLs combined.
 */
async function resolveGeminiCitationUrls(urls) {
  const REDIRECT_PREFIX = 'vertexaisearch.cloud.google.com/grounding-api-redirect/';
  const resolved = new Map();

  const toResolve = urls.filter(url => url.includes(REDIRECT_PREFIX));
  if (toResolve.length === 0) return urls;

  console.log(`[gemini] Resolving ${toResolve.length} redirect URLs...`);
  const startTime = Date.now();

  const results = await Promise.allSettled(
    toResolve.map(async (url) => {
      const finalUrl = await resolveRedirectUrl(url);
      resolved.set(url, finalUrl);
    })
  );

  const resolvedCount = [...resolved.values()].filter((v, i) =>
    v !== [...resolved.keys()][i]
  ).length;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[gemini] Resolved ${resolvedCount}/${toResolve.length} redirect URLs in ${elapsed}s`);

  return urls.map(url => resolved.get(url) || url);
}

// ============== Research Providers ==============

async function callGemini(systemPrompt, topicContext, geminiQuery = null) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  let fullPrompt;
  if (geminiQuery) {
    // Use the pre-built natural-language query from the backend
    // (provider-specific prompting — no structured template)
    fullPrompt = geminiQuery;
    console.log(`[gemini] Using provider-specific query (${geminiQuery.length} chars)`);
  } else {
    // Fallback: concatenate shared system+user prompts (legacy path)
    fullPrompt = `${systemPrompt}\n\n${topicContext}`;
    console.log(`[gemini] Using shared prompt fallback (${fullPrompt.length} chars)`);
  }

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      agent: 'deep-research-pro-preview-12-2025',
      background: true,
      store: true,
      input: fullPrompt
    }),
    signal: AbortSignal.timeout(30000) // 30s timeout for submission
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 429) {
      throw { rateLimited: true, retryAfter: 3600 };
    }
    throw new Error(error.error?.message || `Gemini error: ${response.status}`);
  }

  const data = await response.json();
  console.log(`[gemini-diag] Submission response keys:`, Object.keys(data));
  console.log(`[gemini-diag] Submission id: ${data.id}, status: ${data.status}`);
  return { externalId: data.id, status: data.status || 'in_progress' };
}

async function pollGemini(externalId) {
  const apiKey = process.env.GEMINI_API_KEY;

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions/${externalId}`, {
    headers: { 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(15000) // 15s timeout for polling
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unable to read error body');
    console.error(`Gemini poll error for ${externalId}: HTTP ${response.status} - ${errorBody}`);
    if (response.status >= 500 || response.status === 429) {
      console.log(`Transient error polling Gemini ${externalId}, will retry next cycle`);
      return { completed: false, status: 'polling', transientError: true };
    }
    throw new Error(`Gemini poll error: ${response.status} - ${errorBody.substring(0, 200)}`);
  }

  const data = await response.json();
  console.log(`Gemini poll ${externalId}: status=${data.status}`);

  if (data.status === 'completed') {
    // Diagnostic: log full output structure, annotations, finishReason
    console.log(`[gemini-diag] outputs count: ${data.outputs?.length}`);
    data.outputs?.forEach((o, i) => {
      console.log(`[gemini-diag] output[${i}]: type=${o.type}, keys=${Object.keys(o).join(',')}, text length=${o.text?.length || 0}`);
      if (o.annotations) {
        console.log(`[gemini-diag] output[${i}]: ${o.annotations.length} annotations`);
        o.annotations.slice(0, 3).forEach((a, j) => {
          console.log(`[gemini-diag]   annotation[${j}]: ${JSON.stringify(a)}`);
        });
      }
      if (o.finish_reason || o.finishReason) {
        console.log(`[gemini-diag] output[${i}] finishReason: ${o.finish_reason || o.finishReason}`);
      }
    });

    const lastOutput = data.outputs?.[data.outputs.length - 1];
    let resultText = lastOutput?.text || '';
    const wordCount = resultText ? resultText.split(/\s+/).filter(Boolean).length : 0;

    // Grounding metadata: extract citation URLs from annotations
    const annotations = lastOutput?.annotations || [];
    const sourceUrls = annotations
      .filter(a => a.url || a.uri || a.source)
      .map(a => a.url || a.uri || a.source || '')
      .filter(Boolean);
    const uniqueSourceUrls = [...new Set(sourceUrls)];
    const uniqueDomains = new Set(sourceUrls.map(url => {
      try { return new URL(url).hostname; } catch { return url; }
    }));

    // Resolve redirect URLs to final destinations, then append
    if (uniqueSourceUrls.length > 0) {
      const resolvedUrls = await resolveGeminiCitationUrls(uniqueSourceUrls);
      resultText += '\n\n## Sources\n\n' + resolvedUrls.map((url, i) => `${i + 1}. ${url}`).join('\n');
      console.log(`[gemini] Appended ${resolvedUrls.length} source URLs to output`);
    }

    console.log(`[gemini] Completed: ${wordCount} words, ${sourceUrls.length} source citations, ${uniqueDomains.size} unique domains`);
    const usage = data.usage || data.usageMetadata || {};
    console.log(`[gemini] Usage:`, JSON.stringify(usage));

    // Experiment 2: top-level annotations
    if (data.annotations) {
      console.log(`[gemini-diag] top-level annotations: ${data.annotations.length}`);
    }

    // Experiment 3: finishReason + response structure discovery
    console.log(`[gemini-diag] response keys: ${Object.keys(data).join(',')}`);
    console.log(`[gemini-diag] finishReason: ${data.finish_reason || data.finishReason || 'not present'}`);

    // Full response dump removed (Session 19 diagnostic — data captured)

    return {
      completed: true,
      result: resultText || JSON.stringify(data.outputs),
      tokens: {
        input_tokens: usage.input_tokens || usage.promptTokenCount || usage.prompt_token_count || usage.inputTokens,
        output_tokens: usage.output_tokens || usage.candidatesTokenCount || usage.candidates_token_count || usage.outputTokens || usage.totalTokenCount
      }
    };
  } else if (data.status === 'failed') {
    console.error(`Gemini task ${externalId} failed:`, JSON.stringify(data.error || data, null, 2));
    throw new Error(`Gemini task failed: ${data.error?.message || 'Unknown error'}`);
  }

  return { completed: false, status: data.status };
}

/**
 * Step 2: Expand Gemini Deep Research output via Gemini 3 Pro.
 * Chains to the completed Deep Research interaction using previous_interaction_id,
 * which carries the full research context (710K+ tokens) server-side.
 *
 * On failure: returns null (caller falls back to original Deep Research output).
 */
async function expandGemini(interactionId, expansionPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const EXPANSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  try {
    console.log(`[gemini] Step 2: Starting expansion via Gemini 3 Pro (previous_interaction_id: ${interactionId})`);

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        model: 'gemini-3-pro-preview',
        previous_interaction_id: interactionId,
        store: true,
        input: expansionPrompt,
        generation_config: {
          max_output_tokens: 65536,
          thinking_level: 'high'
        }
      }),
      signal: AbortSignal.timeout(EXPANSION_TIMEOUT_MS)
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(`[gemini] Step 2 failed: HTTP ${response.status} - ${errorBody.substring(0, 300)}`);
      return null;
    }

    const data = await response.json();
    console.log(`[gemini] Step 2 response: status=${data.status}, outputs=${data.outputs?.length}`);

    if (data.status === 'completed' || data.outputs?.length > 0) {
      const lastOutput = data.outputs?.[data.outputs.length - 1];
      const expandedText = lastOutput?.text || '';
      const wordCount = expandedText ? expandedText.split(/\s+/).filter(Boolean).length : 0;

      const usage = data.usage || data.usageMetadata || {};
      console.log(`[gemini] Step 2 (Expansion): ${wordCount} words`);
      console.log(`[gemini] Step 2 Usage:`, JSON.stringify(usage));

      // Experiment 3: expansion finishReason + response keys
      console.log(`[gemini-diag] expansion finishReason: ${data.finish_reason || data.finishReason || 'not present'}`);
      console.log(`[gemini-diag] expansion response keys: ${Object.keys(data).join(',')}`);

      // Full expansion dump removed (Session 19 diagnostic — data captured)

      if (wordCount > 0) {
        return expandedText;
      }
    }

    console.warn(`[gemini] Step 2 returned no usable text, falling back to Step 1 output`);
    return null;
  } catch (err) {
    console.error(`[gemini] Step 2 expansion failed: ${err.message}`);
    return null;
  }
}

// EDR (Enterprise Deep Research) via local server
const EDR_BASE_URL = process.env.EDR_URL || 'http://localhost:9001';

/**
 * Retry helper with exponential backoff
 * Retries transient network errors but not 4xx errors
 */
async function retryFetch(url, options, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (err) {
      lastError = err;
      // Only retry on network errors (ECONNREFUSED, ETIMEDOUT, etc.)
      // Don't retry on AbortError (timeout)
      if (err.name === 'AbortError') throw err;

      if (attempt < maxRetries - 1) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
        console.log(`  [edr] Fetch attempt ${attempt + 1} failed, retrying in ${backoffMs}ms: ${err.message}`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }
  throw lastError;
}

async function callEDR(systemPrompt, topicContext) {
  try {
    const healthCheck = await retryFetch(`${EDR_BASE_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    }, 2);
    if (!healthCheck.ok) throw new Error('EDR server not responding');
  } catch (err) {
    throw new Error(`EDR server not available at ${EDR_BASE_URL}. Start it with: cd edr-node && npx tsx src/index.ts`);
  }

  const fullPrompt = `${systemPrompt}\n\n---\n\nResearch Topic:\n${topicContext}`;

  const response = await retryFetch(`${EDR_BASE_URL}/api/research`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      query: fullPrompt,
      model_provider: 'deepseek',
      model_name: 'deepseek-reasoner',
      search_provider: 'tavily',
      max_iterations: 10,
      include_sources: true
    }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  }, 3);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 429) {
      throw { rateLimited: true, retryAfter: 60 };
    }
    throw new Error(error.detail || error.error || `EDR error: ${response.status}`);
  }

  const data = await response.json();

  if (data.task_id) {
    return { externalId: data.task_id, status: 'in_progress' };
  }

  return {
    completed: true,
    result: data.report || data.result || JSON.stringify(data),
    tokens: data.usage || {}
  };
}

async function pollEDR(externalId) {
  const response = await retryFetch(`${EDR_BASE_URL}/api/research/${externalId}`, {
    method: 'GET',
    signal: AbortSignal.timeout(15000) // 15s timeout for polling
  }, 3);

  if (!response.ok) {
    throw new Error(`EDR poll error: ${response.status}`);
  }

  const data = await response.json();

  if (data.status === 'completed') {
    return {
      completed: true,
      result: data.report || data.result || JSON.stringify(data),
      tokens: data.usage || {}
    };
  } else if (data.status === 'failed' || data.status === 'error') {
    throw new Error(`EDR task failed: ${data.error || 'Unknown error'}`);
  }

  return { completed: false, status: data.status };
}

// Kimi K2 Thinking — deep research with built-in web search
const KIMI_API_URL = process.env.KIMI_URL || 'https://api.moonshot.ai/v1';

async function callKimi(systemPrompt, topicContext, externalAbortController = null) {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) throw new Error('KIMI_API_KEY not configured');

  // Hard timeout: 45 minutes (2700000 ms)
  const HARD_TIMEOUT_MS = 45 * 60 * 1000;
  const abortController = externalAbortController || new AbortController();
  const timeoutId = setTimeout(() => {
    console.error('[kimi] Hard timeout reached (45 minutes), aborting connection');
    abortController.abort();
  }, HARD_TIMEOUT_MS);

  try {
    const response = await fetch(`${KIMI_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'kimi-k2-thinking',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: topicContext }
        ],
        tools: [
          { type: 'builtin_function', function: { name: '$web_search' } }
        ],
        tool_choice: 'auto',
        temperature: 1.0,
        max_tokens: 16384,
        stream: true
      }),
      signal: abortController.signal
    });

    if (!response.ok) {
      clearTimeout(timeoutId);
      const errorText = await response.text().catch(() => '');
      if (response.status === 429) {
        throw { rateLimited: true, retryAfter: 60 };
      }
      throw new Error(`Kimi error ${response.status}: ${errorText.substring(0, 300)}`);
    }

    // Read SSE stream
    let content = '';
    let usage = {};
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastLog = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) content += delta;
          if (parsed.usage) usage = parsed.usage;
        } catch (e) {
          // skip unparseable SSE chunks
        }
      }

      if (Date.now() - lastLog > 60_000) {
        const words = content.split(/\s+/).filter(Boolean).length;
        console.log(`  [kimi] ${words} words generated so far...`);
        lastLog = Date.now();
      }
    }

    clearTimeout(timeoutId);

    if (!content.trim()) {
      throw new Error('Kimi returned empty response');
    }

    console.log(`  [kimi] Complete: ${content.split(/\s+/).filter(Boolean).length} words`);

    return {
      completed: true,
      result: content,
      tokens: {
        input_tokens: usage.prompt_tokens || 0,
        output_tokens: usage.completion_tokens || 0
      }
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Kimi request timeout (45 minutes)');
    }
    throw error;
  }
}

// ============== Queue Processor ==============

async function processQueue() {
  if (processingActive) {
    console.log('Queue processor already running');
    return;
  }

  processingActive = true;
  console.log('Queue processor started');

  while (processingActive) {
    // Reset daily counters if needed
    const today = new Date().toISOString().split('T')[0];
    db.prepare(`
      UPDATE rate_limits SET daily_count = 0, last_reset = ? WHERE last_reset < ?
    `).run(today, today);

    // Poll running tasks first
    const pollingTasks = db.prepare(`
      SELECT tk.*, t2.topic_number, t2.title, t2.context, p.system_prompt, p.gemini_query, p.gemini_expansion_prompt
      FROM tasks tk
      JOIN topics t2 ON t2.id = tk.topic_id
      JOIN projects p ON p.id = t2.project_id
      WHERE tk.status = 'polling'
    `).all();

    const now = Date.now();
    const providerLastPoll = {};

    for (const task of pollingTasks) {
      try {
        if (task.provider === 'gemini') {
          const rateLimit = db.prepare('SELECT last_request FROM rate_limits WHERE provider = ?').get('gemini');
          const lastRequest = rateLimit?.last_request ? new Date(rateLimit.last_request + 'Z').getTime() : 0;
          const timeSinceLastRequest = now - lastRequest;

          if (providerLastPoll['gemini'] || timeSinceLastRequest < geminiPollIntervalMs) {
            continue;
          }
          providerLastPoll['gemini'] = true;
        }

        let pollResult;
        if (task.provider === 'gemini') {
          pollResult = await pollGemini(task.external_id);
          db.prepare(`UPDATE rate_limits SET last_request = datetime('now') WHERE provider = 'gemini'`).run();
        } else if (task.provider === 'edr') {
          pollResult = await pollEDR(task.external_id);
        } else if (task.provider === 'kimi') {
          throw new Error('Kimi tasks should not be in polling state');
        }

        if (pollResult?.completed) {
          let finalResult = pollResult.result;
          let finalTokensInput = pollResult.tokens?.input_tokens || pollResult.tokens?.prompt_tokens;
          let finalTokensOutput = pollResult.tokens?.output_tokens || pollResult.tokens?.completion_tokens;

          // Reset Gemini backoff on successful poll
          if (task.provider === 'gemini' && geminiPollIntervalMs !== GEMINI_DEFAULT_INTERVAL_MS) {
            console.log(`[gemini] Poll succeeded, resetting interval from ${geminiPollIntervalMs / 1000}s to ${GEMINI_DEFAULT_INTERVAL_MS / 1000}s`);
            geminiPollIntervalMs = GEMINI_DEFAULT_INTERVAL_MS;
          }

          // Gemini expansion chain disabled (Session 19): store: true improved
          // Deep Research output to ~3,500 words. The expansion step compresses
          // rather than expands (3,546 → 1,877 words). Using Step 1 output directly.
          // expandGemini() function retained for future use.
          if (task.provider === 'gemini') {
            const geminiWords = finalResult ? finalResult.split(/\s+/).filter(Boolean).length : 0;
            console.log(`[gemini] Deep Research output: ${geminiWords} words (expansion chain disabled)`);
          }

          db.prepare(`
            UPDATE tasks SET
              status = 'completed',
              result = ?,
              tokens_input = ?,
              tokens_output = ?,
              completed_at = datetime('now'),
              retry_count = 0
            WHERE id = ?
          `).run(
            finalResult,
            finalTokensInput,
            finalTokensOutput,
            task.id
          );
          console.log(`Task ${task.id} (${task.provider}) completed`);

          try {
            await exportTaskResult(task.id);
          } catch (exportError) {
            console.error(`Export failed for task ${task.id}:`, exportError.message);
          }
        } else if (pollResult?.transientError) {
          // Gemini gets extended retry cap (15) and exponential backoff on 429
          const MAX_TRANSIENT_RETRIES = task.provider === 'gemini' ? 15 : 10;
          const newRetryCount = (task.retry_count || 0) + 1;

          // Apply exponential backoff for Gemini 429 responses
          if (task.provider === 'gemini') {
            const previousInterval = geminiPollIntervalMs;
            geminiPollIntervalMs = Math.min(geminiPollIntervalMs * 2, GEMINI_BACKOFF_CAP_MS);
            if (geminiPollIntervalMs !== previousInterval) {
              console.log(`[gemini] Rate limited (429/5xx), backoff increased: ${previousInterval / 1000}s -> ${geminiPollIntervalMs / 1000}s`);
            } else {
              console.log(`[gemini] Rate limited (429/5xx), backoff at cap: ${geminiPollIntervalMs / 1000}s`);
            }
          }

          if (newRetryCount >= MAX_TRANSIENT_RETRIES) {
            console.error(`Task ${task.id} failed after ${MAX_TRANSIENT_RETRIES} transient errors`);
            db.prepare(`
              UPDATE tasks SET status = 'failed', error = ?, retry_count = ? WHERE id = ?
            `).run(`Failed after ${MAX_TRANSIENT_RETRIES} transient errors (last: 5xx/429)`, newRetryCount, task.id);
          } else {
            console.log(`Task ${task.id} transient error ${newRetryCount}/${MAX_TRANSIENT_RETRIES}, will retry`);
            db.prepare(`UPDATE tasks SET retry_count = ? WHERE id = ?`).run(newRetryCount, task.id);
          }
        } else if (task.provider === 'gemini' && geminiPollIntervalMs !== GEMINI_DEFAULT_INTERVAL_MS) {
          // Successful poll (still processing) — reset backoff
          console.log(`[gemini] Poll succeeded (status: ${pollResult?.status}), resetting interval from ${geminiPollIntervalMs / 1000}s to ${GEMINI_DEFAULT_INTERVAL_MS / 1000}s`);
          geminiPollIntervalMs = GEMINI_DEFAULT_INTERVAL_MS;
        }
      } catch (error) {
        console.error(`Poll error for task ${task.id}:`, error.message);
        db.prepare(`
          UPDATE tasks SET status = 'failed', error = ? WHERE id = ?
        `).run(error.message, task.id);
      }
    }

    // Get next tasks to process — one per provider, all fired concurrently
    const providerPromises = [];

    for (const provider of providers) {
      const rateLimit = db.prepare('SELECT * FROM rate_limits WHERE provider = ?').get(provider);

      if (rateLimit.daily_count >= rateLimit.daily_limit) {
        continue;
      }

      if (provider === 'gemini') {
        const lastRequest = rateLimit.last_request ? new Date(rateLimit.last_request + 'Z').getTime() : 0;
        const timeSinceLastRequest = Date.now() - lastRequest;
        if (timeSinceLastRequest < 60000) {
          continue;
        }
      }

      const task = db.prepare(`
        SELECT tk.*, t2.topic_number, t2.title, t2.context, p.system_prompt, p.gemini_query, p.gemini_expansion_prompt
        FROM tasks tk
        JOIN topics t2 ON t2.id = tk.topic_id
        JOIN projects p ON p.id = t2.project_id
        WHERE tk.provider = ? AND tk.status = 'queued'
        AND (tk.retry_after IS NULL OR tk.retry_after <= datetime('now'))
        ORDER BY t2.project_id, t2.topic_number
        LIMIT 1
      `).get(provider);

      if (!task) continue;

      db.prepare(`
        UPDATE tasks SET status = 'running', started_at = datetime('now') WHERE id = ?
      `).run(task.id);

      db.prepare(`
        UPDATE rate_limits SET daily_count = daily_count + 1, last_request = datetime('now')
        WHERE provider = ?
      `).run(provider);

      console.log(`Starting task ${task.id}: Topic ${task.topic_number} (${provider})`);

      const taskPromise = (async () => {
        // Get project ID for AbortController tracking
        const projectIdRow = db.prepare('SELECT project_id FROM topics WHERE id = ?').get(task.topic_id);
        const researchProjectId = projectIdRow?.project_id;

        // Create AbortController for this provider
        const taskAbortController = new AbortController();
        if (researchProjectId) {
          setActiveController(researchProjectId, provider, taskAbortController);
        }

        try {
          let result;
          const fullContext = `Topic ${task.topic_number}: ${task.title}\n\n${task.context}`;

          if (provider === 'gemini') {
            result = await callGemini(task.system_prompt, fullContext, task.gemini_query);
            db.prepare(`
              UPDATE tasks SET status = 'polling', external_id = ? WHERE id = ?
            `).run(result.externalId, task.id);
          } else if (provider === 'edr') {
            result = await callEDR(task.system_prompt, fullContext);
            if (result.externalId) {
              db.prepare(`
                UPDATE tasks SET status = 'polling', external_id = ? WHERE id = ?
              `).run(result.externalId, task.id);
            } else if (result.completed) {
              db.prepare(`
                UPDATE tasks SET
                  status = 'completed',
                  result = ?,
                  tokens_input = ?,
                  tokens_output = ?,
                  completed_at = datetime('now')
                WHERE id = ?
              `).run(result.result, result.tokens?.input_tokens, result.tokens?.output_tokens, task.id);
              console.log(`Task ${task.id} (edr) completed`);

              try {
                await exportTaskResult(task.id);
              } catch (exportError) {
                console.error(`Export failed for task ${task.id}:`, exportError.message);
              }
            }
          } else if (provider === 'kimi') {
            result = await callKimi(task.system_prompt, fullContext, taskAbortController);
            if (result.completed) {
              db.prepare(`
                UPDATE tasks SET
                  status = 'completed',
                  result = ?,
                  tokens_input = ?,
                  tokens_output = ?,
                  completed_at = datetime('now')
                WHERE id = ?
              `).run(result.result, result.tokens?.input_tokens, result.tokens?.output_tokens, task.id);
              console.log(`Task ${task.id} (kimi) completed`);

              try {
                await exportTaskResult(task.id);
              } catch (exportError) {
                console.error(`Export failed for task ${task.id}:`, exportError.message);
              }
            }
          }
        } catch (error) {
          if (error.name === 'AbortError') {
            // Check if this was a user-initiated stop (task already set to 'stopped')
            const currentTask = db.prepare('SELECT status FROM tasks WHERE id = ?').get(task.id);
            if (currentTask?.status !== 'stopped') {
              // Timeout-based abort (not user stop)
              db.prepare(`
                UPDATE tasks SET status = 'failed', error = ? WHERE id = ?
              `).run('Request aborted (timeout)', task.id);
            }
            console.log(`Task ${task.id} (${provider}) aborted`);
          } else if (error.rateLimited) {
            const retryAfter = new Date(Date.now() + (error.retryAfter * 1000)).toISOString();
            db.prepare(`
              UPDATE tasks SET
                status = 'rate_limited',
                retry_after = ?,
                retry_count = retry_count + 1,
                error = 'Rate limited'
              WHERE id = ?
            `).run(retryAfter, task.id);
            console.log(`Task ${task.id} rate limited, retry after ${retryAfter}`);
          } else {
            db.prepare(`
              UPDATE tasks SET status = 'failed', error = ? WHERE id = ?
            `).run(error.message, task.id);
            console.error(`Task ${task.id} failed:`, error.message);
          }
        } finally {
          // Clean up controller
          if (researchProjectId) {
            removeActiveController(researchProjectId, provider);
          }
        }
      })();

      providerPromises.push(taskPromise);
    }

    if (providerPromises.length > 0) {
      await Promise.allSettled(providerPromises);
    }

    const remaining = db.prepare(`
      SELECT COUNT(*) as count FROM tasks
      WHERE status IN ('queued', 'running', 'polling', 'rate_limited')
      AND status != 'stopped'
    `).get();

    if (remaining.count === 0) {
      console.log('All tasks completed');
      processingActive = false;
      break;
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  console.log('Queue processor stopped');
}

// ============== Active Connection Tracking (for Stop) ==============

// Track AbortControllers for active provider connections
// Key: `${projectId}-${provider}`, Value: AbortController
const activeControllers = new Map();

function getControllerKey(projectId, provider) {
  return `${projectId}-${provider}`;
}

function setActiveController(projectId, provider, controller) {
  activeControllers.set(getControllerKey(projectId, provider), controller);
}

function removeActiveController(projectId, provider) {
  activeControllers.delete(getControllerKey(projectId, provider));
}

function abortActiveController(projectId, provider) {
  const key = getControllerKey(projectId, provider);
  const controller = activeControllers.get(key);
  if (controller) {
    controller.abort();
    activeControllers.delete(key);
    return true;
  }
  return false;
}

// ============== Per-Provider Restart ==============

/**
 * POST /api/research/:projectId/restart-provider
 * Restart a single provider for a project.
 * Body: { provider: "kimi" | "gemini" | "edr" }
 */
app.post('/api/research/:projectId/restart-provider', (req, res) => {
  try {
    const projectId = req.params.projectId;
    const { provider } = req.body;

    if (!provider || !['kimi', 'gemini', 'edr'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider. Must be kimi, gemini, or edr.' });
    }

    // Verify project exists
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Find and reset the task for this provider
    const task = db.prepare(`
      SELECT tk.id FROM tasks tk
      JOIN topics t2 ON t2.id = tk.topic_id
      WHERE t2.project_id = ? AND tk.provider = ?
    `).get(projectId, provider);

    if (!task) {
      return res.status(404).json({ error: `No task found for provider ${provider} in project ${projectId}` });
    }

    // Reset the task to queued
    db.prepare(`
      UPDATE tasks SET
        status = 'queued',
        error = NULL,
        result = NULL,
        external_id = NULL,
        retry_count = 0,
        retry_after = NULL,
        started_at = NULL,
        completed_at = NULL,
        exported_at = NULL,
        export_path = NULL
      WHERE id = ?
    `).run(task.id);

    console.log(`[restart] Reset provider ${provider} (task ${task.id}) for project ${projectId}`);

    // Start the queue if not already running
    if (!processingActive) {
      processQueue();
    }

    res.json({ success: true, taskId: task.id, provider });
  } catch (error) {
    console.error('[restart] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============== Stop Research ==============

/**
 * POST /api/research/:projectId/stop
 * Stop research providers for a project.
 * Body: { providers?: string[] } — empty or omitted = stop all
 */
app.post('/api/research/:projectId/stop', async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const { providers: requestedProviders } = req.body || {};
    const providersToStop = requestedProviders?.length > 0 ? requestedProviders : ['kimi', 'gemini', 'edr'];

    // Verify project exists
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const results = {};

    for (const provider of providersToStop) {
      if (!['kimi', 'gemini', 'edr'].includes(provider)) {
        results[provider] = { success: false, error: 'Invalid provider' };
        continue;
      }

      // Find the task for this provider
      const task = db.prepare(`
        SELECT tk.id, tk.status FROM tasks tk
        JOIN topics t2 ON t2.id = tk.topic_id
        WHERE t2.project_id = ? AND tk.provider = ?
      `).get(projectId, provider);

      if (!task) {
        results[provider] = { success: false, error: 'No task found' };
        continue;
      }

      // Only stop running/pending/polling tasks
      if (['queued', 'running', 'polling', 'rate_limited'].includes(task.status)) {
        // Abort active connection if exists
        const aborted = abortActiveController(projectId, provider);

        // Delete partial output file if it exists
        const topics = db.prepare('SELECT id, topic_number, title FROM topics WHERE project_id = ?').all(projectId);
        for (const topic of topics) {
          const outputPattern = join(outputsDir, `project-${projectId}`, 'research');
          if (existsSync(outputPattern)) {
            const files = (await import('fs')).readdirSync(outputPattern);
            for (const file of files) {
              if (file.includes(provider)) {
                const filePath = join(outputPattern, file);
                (await import('fs')).unlinkSync(filePath);
                console.log(`[stop] Deleted partial output: ${filePath}`);
              }
            }
          }
        }

        // Set task status to stopped
        db.prepare(`
          UPDATE tasks SET status = 'stopped', error = 'Stopped by user'
          WHERE id = ?
        `).run(task.id);

        results[provider] = { success: true, aborted, previousStatus: task.status };
        console.log(`[stop] Stopped provider ${provider} (task ${task.id}) for project ${projectId}`);
      } else {
        results[provider] = { success: false, status: task.status, reason: 'Not in a stoppable state' };
      }
    }

    // Get final status of all providers
    const allTasks = db.prepare(`
      SELECT tk.provider, tk.status FROM tasks tk
      JOIN topics t2 ON t2.id = tk.topic_id
      WHERE t2.project_id = ?
    `).all(projectId);

    const providerStatuses = {};
    for (const t of allTasks) {
      providerStatuses[t.provider] = t.status;
    }

    res.json({ success: true, results, providerStatuses });
  } catch (error) {
    console.error('[stop] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============== Start Server ==============

function validateApiKeys() {
  const warnings = [];

  const kimiKey = process.env.KIMI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;

  if (!kimiKey || kimiKey.length < 20) {
    warnings.push('KIMI_API_KEY missing or appears to be a placeholder');
  }
  if (!geminiKey || geminiKey === '...' || geminiKey.length < 20) {
    warnings.push('GEMINI_API_KEY missing or appears to be a placeholder');
  }
  if (!deepseekKey || deepseekKey === 'sk-...' || deepseekKey.length < 20) {
    warnings.push('DEEPSEEK_API_KEY missing or appears to be a placeholder');
  }
  if (!tavilyKey || tavilyKey === 'tvly-...' || tavilyKey.length < 20) {
    warnings.push('TAVILY_API_KEY missing or appears to be a placeholder');
  }

  return warnings;
}

app.listen(PORT, () => {
  console.log(`STRATEGOS Research Engine running at http://localhost:${PORT}`);
  console.log(`Database: ${join(__dirname, 'research.db')}`);
  console.log(`Outputs: ${outputsDir}`);

  const keyWarnings = validateApiKeys();
  if (keyWarnings.length > 0) {
    console.log('\nAPI KEY CONFIGURATION WARNINGS:');
    keyWarnings.forEach(w => console.log(`   - ${w}`));
    console.log('   Update .env file and restart the server.\n');
  } else {
    console.log('API keys: All configured');
  }

  const pendingTasks = db.prepare(`
    SELECT COUNT(*) as count FROM tasks WHERE status IN ('polling', 'queued', 'running')
    AND status != 'stopped'
  `).get();
  if (pendingTasks.count > 0) {
    console.log(`Found ${pendingTasks.count} pending tasks, auto-resuming queue...`);
    processQueue();
  }
});
