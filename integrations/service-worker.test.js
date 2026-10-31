import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtFiles, urlOf, versionOf, workerSource } from './service-worker.js';

/** A build's folder, made for each test. */
let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'kupcad-build-'));
  await mkdir(join(root, '_astro'));
  for (const [path, text] of Object.entries({
    'index.html': '<!doctype html>',
    '404.html': 'gone',
    'manifest.webmanifest': '{}',
    '_astro/app.1a2b.js': 'app',
    '_astro/app.1a2b.js.map': 'map',
    '_astro/kupcad.3c4d.wasm': 'wasm',
    'sw.js': 'an older worker',
  })) {
    await writeFile(join(root, path), text);
  }
});

afterEach(() => rm(root, { recursive: true, force: true }));

describe("the service worker's files", () => {
  it('are every file of the build a page may load, by their paths, in a stable order', async () => {
    expect(await builtFiles(root)).toEqual([
      '404.html',
      '_astro/app.1a2b.js',
      '_astro/kupcad.3c4d.wasm',
      'index.html',
      'manifest.webmanifest',
    ]);
  });

  it('are cached by the URLs they are served at, a folder its index.html', () => {
    expect(['index.html', 'docs/index.html', '404.html', '_astro/a.js'].map(urlOf)).toEqual([
      '/',
      '/docs/',
      '/404.html',
      '/_astro/a.js',
    ]);
  });

  it('have a version that changes with any file, and only then', async () => {
    const files = await builtFiles(root);
    const first = await versionOf(root, files);
    expect(await versionOf(root, files)).toBe(first);
    await writeFile(join(root, 'index.html'), '<!doctype html><title>KupCAD</title>');
    expect(await versionOf(root, files)).not.toBe(first);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
  });
});

it("puts the files and their version before the worker's code", () => {
  const source = workerSource('caches.open(VERSION);\n', ['/', '/_astro/a.js'], 'abc');
  expect(source).toBe(
    'const VERSION = "abc";\nconst FILES = ["/","/_astro/a.js"];\n\ncaches.open(VERSION);\n',
  );
});
