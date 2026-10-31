// The service worker, written into the build once Astro has built the site (dist/sw.js): the
// worker's code (worker/service-worker.js) after the URL of every file the build made, which it
// caches when it is installed, and the version of them, a hash of their paths and contents. A
// build that changes any file is so a new worker, which the browser installs beside the old one.

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The worker's file, at the site's root so that it is the worker of every page. */
export const WORKER_FILE = 'sw.js';
const WORKER_SOURCE = new URL('../worker/service-worker.js', import.meta.url);
/** Files the build makes that no page loads. */
const NOT_CACHED = /\.map$|^sw\.js$|(^|\/)\.DS_Store$/;

/** @returns {import('astro').AstroIntegration} */
export function serviceWorker() {
  return {
    name: 'kupcad-service-worker',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const files = await builtFiles(root);
        const version = await versionOf(root, files);
        const code = await readFile(WORKER_SOURCE, 'utf8');
        await writeFile(join(root, WORKER_FILE), workerSource(code, files.map(urlOf), version));
        logger.info(`${WORKER_FILE}: ${files.length} files cached, version ${version}`);
      },
    },
  };
}

/**
 * The files under `root` a page may load, by their paths from it with `/` between names, in a
 * stable order.
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function builtFiles(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name).slice(root.length).split(sep).filter(Boolean).join('/'),
    )
    .filter((path) => !NOT_CACHED.test(path))
    .sort();
}

/**
 * The URL a file of the build is served at: a folder's index.html is the folder's own.
 * @param {string} path from the build's root
 */
export function urlOf(path) {
  return `/${path.replace(/(^|\/)index\.html$/, '$1')}`;
}

/**
 * The version of the files under `root`: a hash of each one's path and contents.
 * @param {string} root
 * @param {string[]} files
 */
export async function versionOf(root, files) {
  const hash = createHash('sha256');
  for (const path of files)
    hash
      .update(path)
      .update('\0')
      .update(await readFile(join(root, path)));
  return hash.digest('hex').slice(0, 16);
}

/**
 * The worker: what it caches (`FILES`) and their version (`VERSION`), then its code.
 * @param {string} code
 * @param {string[]} urls
 * @param {string} version
 */
export function workerSource(code, urls, version) {
  return `const VERSION = ${JSON.stringify(version)};\nconst FILES = ${JSON.stringify(urls)};\n\n${code}`;
}
