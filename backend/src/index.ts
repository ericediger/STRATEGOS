/**
 * STRATEGOS — Backend Server
 *
 * Express API server handling:
 * - Project management
 * - Phase 0: Research Collaboration (Chat + Brief)
 * - Phases 1-4: Stubs for future implementation
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

import { initDb, closeDb } from './db/index.js';
import { globalLimiter } from './middleware/rate-limit.js';
import { recoverStaleStatuses } from './services/recovery.js';
import healthRoutes from './routes/health.js';
import projectRoutes from './routes/projects.js';
import collaborationRoutes from './routes/collaboration.js';
import exportRoutes from './routes/exports.js';
import { dossiersRouter } from './routes/dossiers.js';

// Load environment variables from backend directory
const __filename = fileURLToPath(import.meta.url);
const srcDir = dirname(__filename);
const backendDir = dirname(srcDir);
const envPath = join(backendDir, '.env');
const result = config({ path: envPath, override: true });
if (result.error) {
  console.error(`[env] Failed to load .env from ${envPath}:`, result.error.message);
} else {
  console.log(`[env] Loaded .env from ${envPath}`);
  console.log(`[env] ANTHROPIC_API_KEY configured: ${!!process.env.ANTHROPIC_API_KEY}`);
}

const PORT = process.env.PORT || 4000;
const DATABASE_PATH = process.env.DATABASE_PATH || join(backendDir, 'data', 'strategos.db');
const PROJECTS_ROOT = process.env.PROJECTS_ROOT || join(backendDir, 'projects');

// Ensure required directories exist
const dataDir = dirname(DATABASE_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}
if (!existsSync(PROJECTS_ROOT)) {
  mkdirSync(PROJECTS_ROOT, { recursive: true });
}

// Make PROJECTS_ROOT available to routes
process.env.PROJECTS_ROOT = PROJECTS_ROOT;

// Initialize database
initDb(DATABASE_PATH);

// Recover stale statuses from previous runs
recoverStaleStatuses();

// Recover tasks interrupted by server restart
import { recoverInterruptedTasks } from './services/task-persistence.js';
recoverInterruptedTasks();

// Create Express app
const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", "http://localhost:4000"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS — allow frontend dev server from any local network address
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server)
    if (!origin) return callback(null, true);
    // Allow any request from the frontend dev port (localhost, LAN IPs)
    try {
      const url = new URL(origin);
      if (url.port === '5174') return callback(null, true);
    } catch { /* invalid origin */ }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
}));

// Rate limiting — global
app.use(globalLimiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${req.method}] ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// API Routes
app.use('/api/health', healthRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/collaboration', collaborationRoutes);
app.use('/api/projects', exportRoutes);
app.use('/api/dossiers', dossiersRouter);

// Error handling
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[error]', err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║              STRATEGOS — Backend Server              ║
╠══════════════════════════════════════════════════════╣
║  Port:      ${String(PORT).padEnd(40)}║
║  Database:  ${String(DATABASE_PATH).slice(-38).padEnd(40)}║
║  Projects:  ${String(PROJECTS_ROOT).slice(-38).padEnd(40)}║
╚══════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[server] Shutting down...');
  server.close(() => {
    closeDb();
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n[server] Terminating...');
  server.close(() => {
    closeDb();
    process.exit(0);
  });
});

export default app;
