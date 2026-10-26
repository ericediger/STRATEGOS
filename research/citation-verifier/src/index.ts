import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { CONFIG } from './config.js';
import { VerifyUnitRequestSchema } from './types.js';
import type { TaskState } from './types.js';
import { verificationTasks, runVerificationPipeline } from './pipeline.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── Health ───────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'citation-verifier',
    config: {
      kimi_configured: Boolean(CONFIG.kimiApiKey),
      tavily_configured: Boolean(CONFIG.tavilyApiKey),
      auto_sizing_enabled: CONFIG.autoSizingEnabled,
    },
  });
});

// ─── Verification ─────────────────────────────────────────────────────

app.post('/api/verify/unit', (req, res) => {
  try {
    const validated = VerifyUnitRequestSchema.parse(req.body);

    const taskId = uuidv4();
    const task: TaskState = {
      task_id: taskId,
      type: 'verification',
      status: 'queued',
      progress: 0,
      current_step: 'queued',
      project_id: validated.project_id,
      unit_number: validated.unit_number,
      created_at: new Date().toISOString(),
    };
    verificationTasks.set(taskId, task);

    // Fire and forget
    runVerificationPipeline(taskId, validated).catch(err => {
      console.error(`[verify] Pipeline ${taskId} error:`, err);
    });

    res.json({ task_id: taskId, status: 'queued' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.issues });
    } else {
      res.status(500).json({ error: String(err) });
    }
  }
});

app.get('/api/verify/status/:taskId', (req, res) => {
  const task = verificationTasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

app.get('/api/verify/tasks', (_req, res) => {
  const tasks = Array.from(verificationTasks.values())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50);
  res.json({ tasks });
});

// ─── Start ────────────────────────────────────────────────────────────

app.listen(CONFIG.port, '127.0.0.1', () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║       STRATEGOS Citation Verifier                      ║
╠════════════════════════════════════════════════════════╣
║  Bind:       ${'127.0.0.1'.padEnd(41)}║
║  Port:       ${String(CONFIG.port).padEnd(41)}║
║  Kimi:       ${(CONFIG.kimiApiKey ? 'configured' : 'NOT CONFIGURED').padEnd(41)}║
║  Tavily:     ${(CONFIG.tavilyApiKey ? 'configured' : 'NOT CONFIGURED').padEnd(41)}║
╚════════════════════════════════════════════════════════╝
  `);
});
