import { describe, expect, it } from 'vitest';
import { formatBytes, storageText } from './storage.js';

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
  it('is said as used of allowed, and whether it is kept', async () => {
    expect(await storageText({ estimate, persisted: async () => true })).toBe(
      '12 MB of 2 GB used · persistent',
    );
    expect(await storageText({ estimate, persisted: async () => false })).toBe(
      '12 MB of 2 GB used · not persistent',
    );
    expect(await storageText({ estimate })).toBe('12 MB of 2 GB used');
  });

  it('is said nothing of where the browser says nothing', async () => {
    expect(await storageText({})).toBe('');
    expect(await storageText({ estimate: async () => ({}) })).toBe('');
    expect(await storageText({ estimate: () => Promise.reject(new Error('No')) })).toBe('');
  });
});
