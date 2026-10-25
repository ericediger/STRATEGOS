/**
 * Zod schemas for all API route inputs.
 */

import { z } from 'zod';

// =============================================================================
// SHARED SCHEMAS
// =============================================================================

export const projectIdParamSchema = z.object({
  projectId: z.string().uuid('projectId must be a valid UUID'),
});

// projects.ts uses :id instead of :projectId
export const idParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

// =============================================================================
// PROJECT SCHEMAS
// =============================================================================

export const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(200, 'Project name must be 200 characters or fewer').trim(),
});

// =============================================================================
// COLLABORATION SCHEMAS
// =============================================================================

export const chatMessageSchema = z.object({
  message: z.string().min(1, 'Message is required').max(10000, 'Message must be 10,000 characters or fewer').trim(),
});

// =============================================================================
// ARTIFACT SCHEMAS
// =============================================================================

const validArtifactTypes = [
  'swot',
  'pestle',
  'five-forces',
  'positioning',
  'pricing',
  'executive-summary',
  'battle-card',
] as const;

export const selectArtifactsSchema = z.object({
  types: z.array(
    z.enum(validArtifactTypes)
  ).min(1, 'At least one artifact type is required'),
});

// Artifact type param for GET /:projectId/artifacts/:type
export const artifactTypeParamSchema = z.object({
  projectId: z.string().uuid('projectId must be a valid UUID'),
  type: z.enum(validArtifactTypes),
});

// =============================================================================
// BRIEF EDITING SCHEMAS
// =============================================================================

export const updateBriefSchema = z.object({
  content: z.string().min(1, 'Brief content is required').max(50000, 'Brief content must be 50,000 characters or fewer'),
});

// =============================================================================
// IMPORT & RE-RUN SCHEMAS
// =============================================================================

export const importDocumentSchema = z.object({
  phase: z.enum(['collaboration', 'research', 'verification', 'analysis']),
  files: z.array(z.object({
    name: z.string().min(1).max(255)
      .refine(val => !val.includes('/') && !val.includes('\\'), 'Filename must not contain path separators')
      .refine(val => val !== '.' && val !== '..', 'Filename must not be . or ..'),
    content: z.string().min(1).max(5_000_000),
  })).min(1).max(10),
});

export const rerunPhaseSchema = z.object({
  phase: z.enum(['collaboration', 'research', 'verification', 'analysis', 'artifacts']),
});

// =============================================================================
// EXPORT SCHEMAS
// =============================================================================

const validExportArtifactTypes = [
  'swot',
  'pestle',
  'five-forces',
  'positioning',
  'pricing',
  'executive-summary',
  'battle-card',
] as const;

export const exportBodySchema = z.object({
  artifactType: z.enum(validExportArtifactTypes),
  format: z.enum(['docx', 'pptx']),
});

export const exportFilenameParamSchema = z.object({
  projectId: z.string().uuid('projectId must be a valid UUID'),
  filename: z.string().regex(
    /^[a-z][a-z0-9_-]*\.(docx|pptx)$/,
    'Filename must match pattern: {name}.{docx|pptx}',
  ),
});

export const packetExportSchema = z.object({
  manifest: z.object({
    sections: z.array(z.object({
      artifactType: z.string(),
      sectionTitle: z.string(),
      required: z.boolean(),
      dividerFraming: z.string(),
    })),
    includeClosingSlide: z.boolean(),
    includeSourcesSlide: z.boolean(),
  }).optional(),
  customerReady: z.boolean().optional(),
  excludeSections: z.array(z.string()).optional(),
  includeWarnings: z.boolean().optional(),
});

// =============================================================================
// SINGLE ARTIFACT RETRY SCHEMA
// =============================================================================

export const retryArtifactSchema = z.object({
  artifactType: z.enum(validArtifactTypes),
});

// =============================================================================
// RESEARCH CONTROL SCHEMAS
// =============================================================================

export const rerunProviderSchema = z.object({
  provider: z.string().min(1, 'Provider name is required').max(100),
});

export const stopResearchSchema = z.object({
  providers: z.array(z.string().min(1).max(100)).optional(),
});

// =============================================================================
// DOSSIER SCHEMAS
// =============================================================================

export const createDossierSchema = z.object({
  competitorName: z.string().min(1).max(200),
  industry: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(2000).optional(),
  sourceProjectId: z.string().uuid().optional(),
});

export const updateDossierSchema = z.object({
  competitorName: z.string().min(1).max(200).optional(),
  industry: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(2000).optional(),
});

export const updateDossierWithStatusSchema = z.object({
  competitorName: z.string().min(1).max(200).optional(),
  industry: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(2000).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export const dossierIdParamSchema = z.object({
  dossierId: z.string().uuid(),
});

export const listDossiersQuerySchema = z.object({
  status: z.enum(['active', 'archived']).optional(),
  search: z.string().max(200).optional(),
});

export const createDossierFromProjectSchema = z.object({
  competitorName: z.string().min(1).max(200),
  industry: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(2000).optional(),
});

export const updateFromProjectBodySchema = z.object({
  projectId: z.string().uuid('projectId must be a valid UUID'),
});

export const refreshDossierBodySchema = z.object({
  regenerateArtifacts: z.boolean().optional(),
});
