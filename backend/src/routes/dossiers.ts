/**
 * Dossier API Routes — Competitor Dossier Library (Session 30)
 *
 * CRUD endpoints for managing competitor dossiers, project linking,
 * and staleness computation.
 */

import { Router } from 'express';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  createDossierSchema,
  updateDossierWithStatusSchema,
  dossierIdParamSchema,
  listDossiersQuerySchema,
  projectIdParamSchema,
  createDossierFromProjectSchema,
  updateFromProjectBodySchema,
  refreshDossierBodySchema,
} from '../middleware/schemas.js';
import {
  createDossier,
  getDossier,
  listDossiers,
  updateDossier,
  archiveDossier,
  getLinkedProjects,
  computeStaleness,
  createDossierFromProject,
  getDossierWithLinkedProjects,
  getDossierFileManifest,
  getDossierFileContent,
  updateDossierWithStatus,
  createRefreshProject,
  updateDossierFromProject,
} from '../services/dossier.js';
import { refreshDossier } from '../services/dossier-refresh.js';
import { aiOperationLimiter } from '../middleware/rate-limit.js';

const router = Router();

// POST / — Create a new dossier
router.post('/', validateBody(createDossierSchema), (req, res) => {
  try {
    const dossier = createDossier(req.body);
    return res.status(201).json({ dossier });
  } catch (err) {
    console.error('[dossiers] Create error:', (err as Error).message);
    return res.status(500).json({ error: 'Failed to create dossier' });
  }
});

// GET / — List dossiers with optional filters
router.get('/', validateQuery(listDossiersQuerySchema), (req, res) => {
  try {
    const filters = req.query as { status?: 'active' | 'archived'; search?: string };
    const dossiers = listDossiers(filters);
    return res.json({ dossiers });
  } catch (err) {
    console.error('[dossiers] List error:', (err as Error).message);
    return res.status(500).json({ error: 'Failed to list dossiers' });
  }
});

// GET /:dossierId — Get a single dossier with linked projects and staleness
router.get('/:dossierId', validateParams(dossierIdParamSchema), (req, res) => {
  try {
    const result = getDossierWithLinkedProjects(req.params.dossierId);
    if (!result) {
      return res.status(404).json({ error: 'Dossier not found' });
    }
    const { linkedProjects, staleness, ...dossier } = result;
    return res.json({ dossier, linkedProjects, staleness });
  } catch (err) {
    console.error('[dossiers] Get error:', (err as Error).message);
    return res.status(500).json({ error: 'Failed to get dossier' });
  }
});

// PUT /:dossierId — Update dossier metadata (supports status changes with change log)
router.put(
  '/:dossierId',
  validateParams(dossierIdParamSchema),
  validateBody(updateDossierWithStatusSchema),
  (req, res) => {
    try {
      const dossier = updateDossierWithStatus(req.params.dossierId, req.body);
      if (!dossier) {
        return res.status(404).json({ error: 'Dossier not found' });
      }
      return res.json({ dossier });
    } catch (err) {
      console.error('[dossiers] Update error:', (err as Error).message);
      return res.status(500).json({ error: 'Failed to update dossier' });
    }
  },
);

// POST /:dossierId/archive — Archive a dossier
router.post('/:dossierId/archive', validateParams(dossierIdParamSchema), (req, res) => {
  try {
    const dossier = archiveDossier(req.params.dossierId);
    if (!dossier) {
      return res.status(404).json({ error: 'Dossier not found' });
    }
    return res.json({ dossier });
  } catch (err) {
    console.error('[dossiers] Archive error:', (err as Error).message);
    return res.status(500).json({ error: 'Failed to archive dossier' });
  }
});

// POST /from-project/:projectId — Create dossier from a completed project
router.post(
  '/from-project/:projectId',
  validateParams(projectIdParamSchema),
  validateBody(createDossierFromProjectSchema),
  (req, res) => {
    try {
      const result = createDossierFromProject(req.params.projectId, req.body);
      return res.status(201).json(result);
    } catch (err) {
      const error = err as Error & { statusCode?: number; dossierId?: string };
      const statusCode = error.statusCode || 500;
      const body: Record<string, unknown> = { error: error.message };
      if (error.dossierId) {
        body.dossierId = error.dossierId;
      }
      console.error('[dossiers] Create from project error:', error.message);
      return res.status(statusCode).json(body);
    }
  },
);

// GET /:dossierId/files — Get organized file manifest
router.get('/:dossierId/files', validateParams(dossierIdParamSchema), (req, res) => {
  try {
    const manifest = getDossierFileManifest(req.params.dossierId);
    if (!manifest) {
      return res.status(404).json({ error: 'Dossier not found' });
    }
    return res.json(manifest);
  } catch (err) {
    console.error('[dossiers] File manifest error:', (err as Error).message);
    return res.status(500).json({ error: 'Failed to get file manifest' });
  }
});

// GET /:dossierId/files/* — Get file content (markdown or binary)
// Note: validateParams not used here because Zod strips the wildcard [0] param
router.get('/:dossierId/files/*', (req, res) => {
  try {
    // Validate dossierId manually
    const dossierId = req.params.dossierId;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!dossierId || !uuidRegex.test(dossierId)) {
      return res.status(400).json({ error: 'Invalid parameters', details: [{ path: 'dossierId', message: 'dossierId must be a valid UUID' }] });
    }

    // Extract the wildcard path after /files/
    const fullPath = (req.params as Record<string, string>)[0];
    if (!fullPath) {
      return res.status(400).json({ error: 'File path required' });
    }

    const result = getDossierFileContent(dossierId, fullPath);

    if (result.type === 'error') {
      return res.status(result.status).json({ error: result.message });
    }

    if (result.type === 'markdown') {
      return res.json({ content: result.content, name: result.name, path: result.path });
    }

    // Binary file — stream with Content-Disposition
    return res.download(result.filePath, result.name);
  } catch (err) {
    console.error('[dossiers] File content error:', (err as Error).message);
    return res.status(500).json({ error: 'Failed to get file content' });
  }
});

// POST /:dossierId/refresh — Start automated delta refresh pipeline (EP-07)
router.post(
  '/:dossierId/refresh',
  validateParams(dossierIdParamSchema),
  validateBody(refreshDossierBodySchema),
  aiOperationLimiter,
  async (req, res) => {
    try {
      const { regenerateArtifacts = true } = req.body ?? {};
      const result = await refreshDossier(req.params.dossierId, { regenerateArtifacts });
      return res.status(202).json(result);
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      const statusCode = error.statusCode || 500;
      if (statusCode === 404) return res.status(404).json({ error: error.message });
      if (statusCode === 409) return res.status(409).json({ error: error.message });
      if (statusCode === 423) return res.status(423).json({ error: error.message });
      console.error('[dossiers] Refresh error:', error.message);
      return res.status(500).json({ error: 'Refresh failed to start' });
    }
  },
);

// POST /:dossierId/update-from-project — Update dossier with completed project output
router.post(
  '/:dossierId/update-from-project',
  validateParams(dossierIdParamSchema),
  validateBody(updateFromProjectBodySchema),
  (req, res) => {
    try {
      const result = updateDossierFromProject(req.params.dossierId, req.body.projectId);
      return res.json(result);
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      const statusCode = error.statusCode || 500;
      console.error('[dossiers] Update from project error:', error.message);
      return res.status(statusCode).json({ error: error.message });
    }
  },
);

// GET /:dossierId/staleness — Get staleness level
router.get('/:dossierId/staleness', validateParams(dossierIdParamSchema), (req, res) => {
  try {
    const dossier = getDossier(req.params.dossierId);
    if (!dossier) {
      return res.status(404).json({ error: 'Dossier not found' });
    }
    const staleness = computeStaleness(dossier);
    return res.json({ staleness, dossierId: dossier.id });
  } catch (err) {
    console.error('[dossiers] Staleness error:', (err as Error).message);
    return res.status(500).json({ error: 'Failed to compute staleness' });
  }
});

export const dossiersRouter = router;
