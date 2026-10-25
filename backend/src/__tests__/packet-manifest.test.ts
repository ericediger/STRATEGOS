/**
 * Packet manifest and assembly tests.
 *
 * Verifies the default manifest structure, section config completeness,
 * and packet export route validation.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PACKET_MANIFEST,
  SECTION_CONFIG,
  ARTIFACT_DISPLAY_NAMES,
} from '../services/export.js';
import { packetExportSchema } from '../middleware/schemas.js';

describe('Packet Manifest', () => {
  it('default manifest has 5 sections', () => {
    expect(DEFAULT_PACKET_MANIFEST.sections).toHaveLength(5);
  });

  it('default manifest sections are in the correct order', () => {
    const types = DEFAULT_PACKET_MANIFEST.sections.map(s => s.artifactType);
    expect(types).toEqual([
      'executive-summary',
      'positioning',
      'swot',
      'battle-card',
      'pricing',
    ]);
  });

  it('default manifest has 4 required and 1 optional section', () => {
    const required = DEFAULT_PACKET_MANIFEST.sections.filter(s => s.required);
    const optional = DEFAULT_PACKET_MANIFEST.sections.filter(s => !s.required);
    expect(required).toHaveLength(4);
    expect(optional).toHaveLength(1);
    expect(optional[0].artifactType).toBe('battle-card');
  });

  it('default manifest includes closing and sources slides', () => {
    expect(DEFAULT_PACKET_MANIFEST.includeClosingSlide).toBe(true);
    expect(DEFAULT_PACKET_MANIFEST.includeSourcesSlide).toBe(true);
  });

  it('every manifest section has a non-empty divider framing', () => {
    for (const section of DEFAULT_PACKET_MANIFEST.sections) {
      expect(section.dividerFraming.length).toBeGreaterThan(20);
    }
  });

  it('every manifest section has a non-empty section title', () => {
    for (const section of DEFAULT_PACKET_MANIFEST.sections) {
      expect(section.sectionTitle.length).toBeGreaterThan(0);
    }
  });
});

describe('Section Config', () => {
  it('has config for all 7 artifact types', () => {
    const expectedTypes = [
      'executive-summary',
      'positioning',
      'swot',
      'pricing',
      'pestle',
      'five-forces',
      'battle-card',
    ];
    for (const type of expectedTypes) {
      expect(SECTION_CONFIG[type]).toBeDefined();
      expect(SECTION_CONFIG[type].name.length).toBeGreaterThan(0);
      expect(SECTION_CONFIG[type].framing.length).toBeGreaterThan(20);
    }
  });

  it('section names do not contain em-dashes', () => {
    for (const key of Object.keys(SECTION_CONFIG)) {
      expect(SECTION_CONFIG[key].name).not.toContain('\u2014');
      expect(SECTION_CONFIG[key].framing).not.toContain('\u2014');
    }
  });

  it('every artifact type with a display name has section config', () => {
    for (const key of Object.keys(ARTIFACT_DISPLAY_NAMES)) {
      expect(SECTION_CONFIG[key]).toBeDefined();
    }
  });
});

describe('Packet Export Schema', () => {
  it('accepts empty body', () => {
    const result = packetExportSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts body with manifest', () => {
    const result = packetExportSchema.safeParse({
      manifest: {
        sections: [
          {
            artifactType: 'executive-summary',
            sectionTitle: 'Executive Overview',
            required: true,
            dividerFraming: 'Test framing text',
          },
        ],
        includeClosingSlide: true,
        includeSourcesSlide: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid manifest structure', () => {
    const result = packetExportSchema.safeParse({
      manifest: { sections: 'not-an-array' },
    });
    expect(result.success).toBe(false);
  });
});
