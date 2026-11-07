import { describe, expect, it } from 'vitest';
import { formatBytes, storageUse } from './storage.js';

describe('a size', () => {
  it.each([
    [0, '0 bytes'],
    [1, '1 byte'],
    [999, '999 bytes'],
    [2100, '2.1 KB'],
    [12_400_000, '12 MB'],
    [2_000_000_000, '2 GB'],
    [5e15, '5000 TB'],
  ])('%d: %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

/** A browser's estimate of the origin's storage: 12 MB used of 2 GB. */
const estimate = async () => ({ usage: 12_000_000, quota: 2_000_000_000 });

describe("the origin's storage", () => {
  it('is said as used of allowed, and whether the browser may clear it', async () => {
    const used = '12 MB of 2 GB used';
    expect(await storageUse({ estimate, persisted: async () => false })).toEqual({
      used,
      mayClear: true,
    });
    expect(await storageUse({ estimate, persisted: async () => true })).toEqual({
      used,
      mayClear: false,
    });
    expect(await storageUse({ estimate })).toEqual({ used, mayClear: false });
  });

  it('is said nothing of where the browser says nothing', async () => {
    expect(await storageUse({})).toBeNull();
    expect(await storageUse({ estimate: async () => ({}) })).toBeNull();
    expect(await storageUse({ estimate: () => Promise.reject(new Error('No')) })).toBeNull();
  });
});
