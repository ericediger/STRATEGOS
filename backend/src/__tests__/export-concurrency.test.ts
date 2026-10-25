import { describe, it, expect, beforeEach } from 'vitest';
import { isExportActive, getActiveExportDescription, _testSetExportActive, _testClearExportActive } from '../services/export.js';

describe('Export concurrency guard', () => {
  beforeEach(() => {
    // Clear any stale state
    _testClearExportActive('proj-1');
    _testClearExportActive('proj-2');
  });

  it('isExportActive returns false when no export running', () => {
    expect(isExportActive('proj-1')).toBe(false);
  });

  it('isExportActive returns true during active export', () => {
    _testSetExportActive('proj-1', 'swot.docx');
    expect(isExportActive('proj-1')).toBe(true);
    expect(getActiveExportDescription('proj-1')).toBe('swot.docx');
  });

  it('lock is released after clearing', () => {
    _testSetExportActive('proj-1', 'swot.docx');
    expect(isExportActive('proj-1')).toBe(true);
    _testClearExportActive('proj-1');
    expect(isExportActive('proj-1')).toBe(false);
  });

  it('lock release is idempotent', () => {
    _testSetExportActive('proj-1', 'swot.docx');
    _testClearExportActive('proj-1');
    _testClearExportActive('proj-1'); // Second clear should not throw
    expect(isExportActive('proj-1')).toBe(false);
  });

  it('different projects can have concurrent exports', () => {
    _testSetExportActive('proj-1', 'swot.docx');
    _testSetExportActive('proj-2', 'packet');
    expect(isExportActive('proj-1')).toBe(true);
    expect(isExportActive('proj-2')).toBe(true);
    _testClearExportActive('proj-1');
    expect(isExportActive('proj-1')).toBe(false);
    expect(isExportActive('proj-2')).toBe(true);
  });
});
