import { describe, expect, it } from 'vitest';
import { importable, MAIN_SCRIPT, sameFiles, STARTER, stemOf } from './project.js';

/** @import { Entry } from '@kupcad/files' */

/** @type {Entry[]} */
const ENTRIES = [
  { kind: 'folder', name: 'parts', path: '/parts', depth: 0 },
  { kind: 'folder', name: 'covers', path: '/parts/covers', depth: 1 },
  { kind: 'data', name: 'logo.svg', path: '/parts/covers/logo.svg', depth: 2 },
  { kind: 'script', name: 'lid.kup', path: '/parts/lid.kup', depth: 1 },
  { kind: 'data', name: 'sizes.json', path: '/sizes.json', depth: 0 },
  { kind: 'script', name: 'main.kup', path: '/main.kup', depth: 0 },
];

/** The names a script at `path` may import its files by. @param {string} path */
const namesFor = (path) => importable(ENTRIES, path).map(({ name }) => name);

describe('what a script may import', () => {
  it("is every file of its folder and the folders in it, by its path from the script's", () => {
    expect(namesFor('/main.kup')).toEqual(['parts/covers/logo.svg', 'parts/lid.kup', 'sizes.json']);
    expect(namesFor('/parts/lid.kup')).toEqual(['covers/logo.svg']);
  });

  it("is nothing outside its folder: the core's files are rooted there", () => {
    expect(namesFor('/parts/covers/logo.svg')).toEqual([]);
    expect(namesFor('/parts/lid.kup')).not.toContain('../sizes.json');
  });
});

it('tells the files a script imports apart by their paths, texts and bytes', () => {
  const files = { 'lib.kup': 'size = 2\n', 'logo.svg': new Uint8Array([1, 2]) };
  expect(sameFiles(files, { 'logo.svg': new Uint8Array([1, 2]), 'lib.kup': 'size = 2\n' })).toBe(
    true,
  );
  expect(sameFiles(files, { ...files, 'lib.kup': 'size = 3\n' })).toBe(false);
  expect(sameFiles(files, { ...files, 'logo.svg': new Uint8Array([1, 3]) })).toBe(false);
  expect(sameFiles(files, { ...files, 'logo.svg': new Uint8Array([1]) })).toBe(false);
  expect(sameFiles(files, { 'lib.kup': 'size = 2\n', 'logo.svg': 'text' })).toBe(false);
  expect(sameFiles(files, { 'lib.kup': 'size = 2\n', 'other.svg': new Uint8Array([1, 2]) })).toBe(
    false,
  );
  expect(sameFiles({}, {})).toBe(true);
});

it("starts a project with a script that imports another, by a path from the first's folder", () => {
  expect(Object.keys(STARTER)).toEqual([MAIN_SCRIPT, '/parts/tray.kup']);
  expect(STARTER[MAIN_SCRIPT]).toContain('import { tray } from "./parts/tray.kup"');
  expect(STARTER['/parts/tray.kup']).toContain('export tray');
});

it("names a script's exports after it, without its extension", () => {
  expect(['main.kup', 'part.v2.kup', 'README', '.kup'].map(stemOf)).toEqual([
    'main',
    'part.v2',
    'README',
    '.kup',
  ]);
});
