/**
 * Artifact registry completeness test.
 *
 * Ensures every artifact type accepted by the Zod export schema
 * also exists in ARTIFACT_TYPES (analysis.ts) and ARTIFACT_DISPLAY_NAMES (export.ts).
 * Prevents registration gaps like the Session 23 battle-card display name omission.
 */
import { describe, it, expect } from 'vitest';
import { exportBodySchema } from '../middleware/schemas.js';
import { ARTIFACT_TYPES } from '../services/analysis.js';
import { ARTIFACT_DISPLAY_NAMES } from '../services/export.js';

// Extract enum values from Zod schema
const zodArtifactTypes = exportBodySchema.shape.artifactType.options as readonly string[];

describe('Artifact Registry Completeness', () => {

  it('Zod export enum has at least 7 artifact types', () => {
    expect(zodArtifactTypes.length).toBeGreaterThanOrEqual(7);
  });

  for (const type of zodArtifactTypes) {
    it(`"${type}" exists in ARTIFACT_TYPES (analysis.ts)`, () => {
      expect(ARTIFACT_TYPES[type]).toBeDefined();
      expect(ARTIFACT_TYPES[type].promptFile).toBeTruthy();
      expect(ARTIFACT_TYPES[type].label).toBeTruthy();
    });

    it(`"${type}" exists in ARTIFACT_DISPLAY_NAMES (export.ts)`, () => {
      expect(ARTIFACT_DISPLAY_NAMES[type]).toBeDefined();
      expect(ARTIFACT_DISPLAY_NAMES[type].length).toBeGreaterThan(0);
    });
  }
});
