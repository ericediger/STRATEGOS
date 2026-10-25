/**
 * Test app helper for security middleware tests.
 *
 * Creates a minimal Express app with the same middleware stack
 * as the real server, using an in-memory SQLite database.
 *
 * Routes import `prepare` from `../../db/index.js` which uses a
 * module-level `db` variable set by `initDb()`. We call `initDb`
 * with ':memory:' before importing routes so they use the test DB.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { initDb, closeDb } from '../../db/index.js';
import { globalLimiter } from '../../middleware/rate-limit.js';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let testProjectsRoot: string;

/**
 * Creates a test Express app with the same middleware and routes
 * as the production server, but backed by an in-memory database.
 *
 * Call `cleanupTestApp()` when done to close the DB.
 */
export function createTestApp() {
  // Initialize in-memory database (sets the module-level db variable)
  initDb(':memory:');

  // Create a temp directory for test projects
  testProjectsRoot = join(tmpdir(), `strategos-test-${Date.now()}`);
  if (!existsSync(testProjectsRoot)) {
    mkdirSync(testProjectsRoot, { recursive: true });
  }
  process.env.PROJECTS_ROOT = testProjectsRoot;

  const app = express();

  // Match production middleware order from index.ts

  // 1. Security headers (Helmet)
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

  // 2. CORS — same config as production
  const ALLOWED_ORIGINS = [
    'http://localhost:5174',
    'http://127.0.0.1:5174',
  ];

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
  }));

  // 3. Rate limiting — global
  app.use(globalLimiter);

  // 4. Body parsing
  app.use(express.json({ limit: '10mb' }));

  return app;
}

/**
 * Mounts the real route handlers onto the test app.
 * Must be called AFTER createTestApp() since routes import
 * from db/index.js which needs the DB initialized.
 *
 * Routes are dynamically imported to ensure they pick up
 * the already-initialized in-memory database.
 */
export async function mountRoutes(app: express.Express) {
  const { default: healthRoutes } = await import('../../routes/health.js');
  const { default: projectRoutes } = await import('../../routes/projects.js');
  const { default: collaborationRoutes } = await import('../../routes/collaboration.js');

  app.use('/api/health', healthRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/collaboration', collaborationRoutes);

  // Error handling (same as production)
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: 'Internal Server Error' });
  });

  // 404 handler
  app.use((_req: express.Request, res: express.Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  return app;
}

/**
 * Clean up: close the in-memory database and remove temp directory.
 */
export function cleanupTestApp() {
  closeDb();
  if (testProjectsRoot && existsSync(testProjectsRoot)) {
    try {
      rmSync(testProjectsRoot, { recursive: true, force: true });
    } catch { /* best effort cleanup */ }
  }
}
