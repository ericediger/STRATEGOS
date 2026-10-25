/**
 * Export route endpoints
 *
 * POST /api/projects/:projectId/export — Generate a DOCX/PPTX export
 * GET  /api/projects/:projectId/exports/:filename — Download a generated file
 */

import { Router } from 'express';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { prepare } from '../db/index.js';
import { exportArtifact, generatePacket, isExportActive } from '../services/export.js';
import { logEvent, EVENT_TYPES } from '../services/event-logger.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { projectIdParamSchema, exportBodySchema, exportFilenameParamSchema, packetExportSchema } from '../middleware/schemas.js';
import { aiOperationLimiter } from '../middleware/rate-limit.js';
import type { PacketManifest, PacketExportOptions } from '../services/export.js';

const router = Router();

const PROJECTS_ROOT = process.env.PROJECTS_ROOT || join(process.cwd(), 'projects');

const MIME_TYPES: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/**
 * POST /api/projects/:projectId/export
 * Generate a DOCX or PPTX export of a completed artifact.
 */
router.post(
  '/:projectId/export',
  validateParams(projectIdParamSchema),
  validateBody(exportBodySchema),
  aiOperationLimiter,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const { artifactType, format } = req.body;

      // Verify project exists
      const project = prepare(
        'SELECT status FROM projects WHERE id = ?'
      ).get(projectId) as { status: string } | undefined;

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      // Guard: project must be complete or analysis_complete
      if (project.status !== 'complete' && project.status !== 'analysis_complete') {
        return res.status(400).json({
          error: `Cannot export: project status is ${project.status}, expected complete or analysis_complete`,
        });
      }

      if (isExportActive(projectId)) {
        return res.status(429).json({
          error: 'Export already in progress for this project',
          retryAfter: 120,
        });
      }

      const startTime = Date.now();
      try { logEvent(EVENT_TYPES.export_initiated, projectId, { format, artifactType, isPacket: false }); } catch { /* non-blocking */ }

      const result = await exportArtifact(projectId, artifactType, format);

      try { logEvent(EVENT_TYPES.export_completed, projectId, { format, durationMs: Date.now() - startTime, exportMode: 'standard' }); } catch { /* non-blocking */ }
      res.json({ status: 'complete', filename: result.filename });
    } catch (err: any) {
      console.error('[export] Generation error:', err);
      try { logEvent(EVENT_TYPES.provider_failure, req.params.projectId, { provider: 'anthropic', phase: 'export', error: err.message?.slice(0, 500) }); } catch { /* non-blocking */ }

      if (err.message?.includes('not found')) {
        return res.status(404).json({ status: 'failed', error: err.message });
      }

      res.status(500).json({ status: 'failed', error: err.message || 'Export generation failed' });
    }
  },
);

/**
 * POST /api/projects/:projectId/export/packet
 * Generate a complete Competitive Packet PPTX from all default-tier artifacts.
 */
router.post(
  '/:projectId/export/packet',
  validateParams(projectIdParamSchema),
  validateBody(packetExportSchema),
  aiOperationLimiter,
  async (req, res) => {
    try {
      const { projectId } = req.params;
      const { manifest, customerReady, excludeSections, includeWarnings } = req.body as {
        manifest?: PacketManifest;
        customerReady?: boolean;
        excludeSections?: string[];
        includeWarnings?: boolean;
      };

      // Verify project exists
      const project = prepare(
        'SELECT status FROM projects WHERE id = ?'
      ).get(projectId) as { status: string } | undefined;

      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      // Guard: project must be complete or analysis_complete
      if (project.status !== 'complete' && project.status !== 'analysis_complete') {
        return res.status(400).json({
          error: `Cannot export packet: project status is ${project.status}, expected complete or analysis_complete`,
        });
      }

      if (isExportActive(projectId)) {
        return res.status(429).json({
          error: 'Export already in progress for this project',
          retryAfter: 120,
        });
      }

      const startTime = Date.now();
      const exportMode = customerReady
        ? (excludeSections?.length ? 'customer-ready-excluded' : includeWarnings ? 'customer-ready-warnings' : 'customer-ready')
        : 'standard';
      try { logEvent(EVENT_TYPES.export_initiated, projectId, { format: 'pptx', artifactType: 'packet', isPacket: true }); } catch { /* non-blocking */ }

      const packetOptions: PacketExportOptions = { customerReady, excludeSections, includeWarnings };
      const result = await generatePacket(projectId, manifest, packetOptions);

      try {
        logEvent(EVENT_TYPES.export_completed, projectId, {
          format: 'pptx',
          durationMs: Date.now() - startTime,
          exportMode,
          sectionManifest: manifest ? Object.keys(manifest) : null,
        });
      } catch { /* non-blocking */ }
      res.json({ status: 'complete', filename: result.filename });
    } catch (err: any) {
      console.error('[packet] Generation error:', err);
      try { logEvent(EVENT_TYPES.provider_failure, req.params.projectId, { provider: 'anthropic', phase: 'export', error: err.message?.slice(0, 500) }); } catch { /* non-blocking */ }

      if (err.message?.includes('missing required artifacts')) {
        return res.status(400).json({ status: 'failed', error: err.message });
      }
      if (err.message?.includes('No completed artifacts')) {
        return res.status(400).json({ status: 'failed', error: err.message });
      }
      if (err.message?.includes('not found')) {
        return res.status(404).json({ status: 'failed', error: err.message });
      }

      res.status(500).json({ status: 'failed', error: err.message || 'Packet generation failed' });
    }
  },
);

/**
 * GET /api/projects/:projectId/exports/:filename
 * Download a generated export file.
 */
router.get(
  '/:projectId/exports/:filename',
  validateParams(exportFilenameParamSchema),
  (req, res) => {
    try {
      const { projectId, filename } = req.params;

      // Resolve the file path
      const root = process.env.PROJECTS_ROOT || PROJECTS_ROOT;
      const filePath = join(root, projectId, 'exports', filename);

      // Guard: file must exist
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: 'Export file not found' });
      }

      // Determine MIME type from extension
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      const mimeType = MIME_TYPES[ext];

      if (!mimeType) {
        return res.status(400).json({ error: 'Unsupported file format' });
      }

      res.setHeader('Content-Disposition', `attachment; filename="${basename(filename)}"`);
      res.setHeader('Content-Type', mimeType);

      const fileBuffer = readFileSync(filePath);
      res.send(fileBuffer);
    } catch (err: any) {
      console.error('[export] Download error:', err);
      res.status(500).json({ error: err.message || 'Failed to download export' });
    }
  },
);

export default router;
