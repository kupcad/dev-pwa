// What the origin's storage holds, as the IDE shows it under the files: how much of what the
// browser allows is used (navigator.storage.estimate()), and whether the browser may clear it when
// space runs low (persisted() false). A browser without either says nothing of it.

/** The units sizes are said in, each a thousand of the one before (as the system's file manager says them). */
const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'];

/**
 * `bytes` said in the largest unit it is one or more of, to one decimal under 10 (`2.1 KB`,
 * `12 MB`).
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  let size = bytes;
  let unit = 0;
  while (size >= 1000 && unit < UNITS.length - 1) {
    size /= 1000;
    unit += 1;
  }
  if (unit === 0) return `${size} ${size === 1 ? 'byte' : 'bytes'}`;
  const rounded = size < 10 ? Math.round(size * 10) / 10 : Math.round(size);
  return `${rounded} ${UNITS[unit]}`;
}

/**
 * How much of the origin's storage is used, of how much (`12 MB of 2 GB used`), and whether the
 * browser may clear it when space runs low (it says it doesn't persist it); null where the
 * browser doesn't say.
 * @param {Partial<Pick<StorageManager, 'estimate' | 'persisted'>> | undefined} [storage]
 * @returns {Promise<{ used: string, mayClear: boolean } | null>}
 */
export async function storageUse(storage = globalThis.navigator?.storage) {
  try {
    const estimate = await storage?.estimate?.();
    if (estimate?.usage === undefined || estimate.quota === undefined) return null;
    const persisted = await storage?.persisted?.().catch(() => undefined);
    return {
      used: `${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)} used`,
      mayClear: persisted === false,
    };
  } catch {
    return null;
  }
}
