import { describe, it, expect } from 'vitest';
import { uuidToProjectId } from '../services/verification.js';

describe('uuidToProjectId', () => {
  it('produces a positive integer from a UUID', () => {
    const id = uuidToProjectId('9f6369ce-1234-5678-9abc-def012345678');
    expect(Number.isInteger(id)).toBe(true);
    expect(id).toBeGreaterThan(0);
  });

  it('is deterministic — same UUID always produces same ID', () => {
    const uuid = 'f0b05624-aaaa-bbbb-cccc-ddddeeee0000';
    const first = uuidToProjectId(uuid);
    const second = uuidToProjectId(uuid);
    const third = uuidToProjectId(uuid);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('produces different IDs for different UUIDs', () => {
    const id1 = uuidToProjectId('9f6369ce-1234-5678-9abc-def012345678');
    const id2 = uuidToProjectId('f0b05624-aaaa-bbbb-cccc-ddddeeee0000');
    expect(id1).not.toBe(id2);
  });

  it('handles UUIDs with and without dashes', () => {
    const withDashes = uuidToProjectId('9f6369ce-1234-5678-9abc-def012345678');
    const withoutDashes = uuidToProjectId('9f6369ce123456789abcdef012345678');
    expect(withDashes).toBe(withoutDashes);
  });

  it('produces values in the 32-bit unsigned integer range', () => {
    // First 8 hex chars → max 0xFFFFFFFF = 4294967295
    const maxId = uuidToProjectId('ffffffff-ffff-ffff-ffff-ffffffffffff');
    expect(maxId).toBeLessThanOrEqual(0xFFFFFFFF);
    expect(maxId).toBe(0xFFFFFFFF);

    const minId = uuidToProjectId('00000001-0000-0000-0000-000000000000');
    expect(minId).toBe(1);
  });

  it('never returns the old hardcoded value of 1 for realistic UUIDs', () => {
    // Real v4 UUIDs will never have first 8 hex chars as 00000001
    const realisticUuids = [
      '9f6369ce-1234-5678-9abc-def012345678',
      'f0b05624-aaaa-bbbb-cccc-ddddeeee0000',
      '1a00221d-5555-6666-7777-888899990000',
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    ];
    for (const uuid of realisticUuids) {
      expect(uuidToProjectId(uuid)).not.toBe(1);
    }
  });
});
