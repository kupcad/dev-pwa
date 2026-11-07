import { describe, expect, it } from 'vitest';
import { memoryFolder } from './memory-opfs.test-helper.js';
import { opfsFiles } from './opfs.js';
import {
  DEFAULT_WORKSPACE,
  hashOf,
  MAX_WORKSPACE_NAME,
  uniqueWorkspaceName,
  withoutTopFolder,
  workspaceNameError,
  workspaceOfHash,
  workspaces,
} from './workspaces.js';
import { unzip, zip } from './zip.js';

const text = (/** @type {string} */ value) => new TextEncoder().encode(value);

/** Workspaces in a stand-in for the origin's private file system, its root kept to look into. */
function inMemory() {
  const root = memoryFolder();
  return { root, spaces: workspaces({ getDirectory: async () => root }) };
}

describe('the workspaces', () => {
  it('are the default alone at first, made the first time they are listed', async () => {
    const { root, spaces } = inMemory();
    expect(await spaces.list()).toEqual([DEFAULT_WORKSPACE]);
    const folder = await root.getDirectoryHandle('workspaces');
    expect((await folder.getDirectoryHandle(DEFAULT_WORKSPACE)).kind).toBe('directory');
  });

  it('list the default first, then the others alphabetically, files at the top left out', async () => {
    const { root, spaces } = inMemory();
    await spaces.create('Shelf');
    await spaces.create('brackets');
    await spaces.create('Zeta');
    const folder = await root.getDirectoryHandle('workspaces');
    await folder.getFileHandle('stray.txt', { create: true });
    expect(await spaces.list()).toEqual([DEFAULT_WORKSPACE, 'brackets', 'Shelf', 'Zeta']);
  });

  it('each keep their files in a folder of their own', async () => {
    const { spaces } = inMemory();
    await spaces.create('Shelf');
    await opfsFiles(spaces.folder(DEFAULT_WORKSPACE)).write('/main.kup', 'cube(1)\n');
    await opfsFiles(spaces.folder('Shelf')).write('/main.kup', 'cube(2)\n');
    expect(await opfsFiles(spaces.folder(DEFAULT_WORKSPACE)).read('/main.kup')).toBe('cube(1)\n');
    expect(await opfsFiles(spaces.folder('Shelf')).read('/main.kup')).toBe('cube(2)\n');
    // The same folder each time
    expect(await spaces.folder('Shelf')).toBe(await spaces.folder('Shelf'));
  });

  it("open the default's folder the first time, but never make another's", async () => {
    const { spaces } = inMemory();
    expect((await spaces.folder(DEFAULT_WORKSPACE)).name).toBe(DEFAULT_WORKSPACE);
    await expect(spaces.folder('Gone')).rejects.toMatchObject({ name: 'NotFoundError' });
    expect(await spaces.list()).toEqual([DEFAULT_WORKSPACE]);
  });

  it('are made with their name trimmed, and refused as a name is', async () => {
    const { spaces } = inMemory();
    expect(await spaces.create('  Shelf  ')).toBe('Shelf');
    await expect(spaces.create('shelf')).rejects.toThrow('There is a workspace “shelf” already.');
    await expect(spaces.create('a/b')).rejects.toThrow('/');
    expect(await spaces.list()).toEqual([DEFAULT_WORKSPACE, 'Shelf']);
  });

  it('are deleted with all their files, but the default never', async () => {
    const { spaces } = inMemory();
    await spaces.create('Shelf');
    const shelf = opfsFiles(spaces.folder('Shelf'));
    await shelf.mkdir('/parts');
    await shelf.write('/parts/lid.kup', 'cube(1)\n');
    await spaces.remove('Shelf');
    expect(await spaces.list()).toEqual([DEFAULT_WORKSPACE]);
    await expect(spaces.remove(DEFAULT_WORKSPACE)).rejects.toThrow('can’t be deleted');
    expect(await spaces.list()).toEqual([DEFAULT_WORKSPACE]);
  });

  it("fail each call as getting the origin's file system did", async () => {
    const denied = new DOMException('No storage here', 'SecurityError');
    const spaces = workspaces({ getDirectory: () => Promise.reject(denied) });
    await expect(spaces.list()).rejects.toBe(denied);
    await expect(opfsFiles(spaces.folder(DEFAULT_WORKSPACE)).readDir('/')).rejects.toBe(denied);
  });
});

/**
 * The files and folders of a workspace, by their paths, a file's with its text.
 * @param {import('./workspaces.js').Workspaces} spaces
 * @param {string} name
 */
async function contentOf(spaces, name) {
  const found = await opfsFiles(spaces.folder(name)).walk();
  return Object.fromEntries(
    await Promise.all(found.map(async ({ path, file }) => [path, (await file?.text()) ?? null])),
  );
}

/** A workspace `Shelf` with a script, and one in a folder. */
async function withShelf() {
  const made = inMemory();
  await made.spaces.create('Shelf');
  const shelf = opfsFiles(made.spaces.folder('Shelf'));
  await shelf.mkdir('/parts/empty');
  await shelf.write('/main.kup', 'cube(1)\n');
  await shelf.write('/parts/lid.kup', 'cube(2)\n');
  return made;
}

const SHELF = {
  'main.kup': 'cube(1)\n',
  parts: null,
  'parts/empty': null,
  'parts/lid.kup': 'cube(2)\n',
};

describe('a workspace', () => {
  it('is zipped in a folder named for it, and imported from that zip as it was', async () => {
    const { spaces } = await withShelf();
    const zipped = new Uint8Array(await (await spaces.toZip('Shelf')).arrayBuffer());
    // In the order OPFS lists them, which is none in particular
    expect((await unzip(zipped)).map(({ path }) => path).toSorted()).toEqual([
      'Shelf',
      'Shelf/main.kup',
      'Shelf/parts',
      'Shelf/parts/empty',
      'Shelf/parts/lid.kup',
    ]);
    expect(await spaces.fromZip('Shelf 2', zipped)).toBe('Shelf 2');
    expect(await contentOf(spaces, 'Shelf 2')).toEqual(SHELF);
  });

  it('is imported from a zip of files with no folder of their own', async () => {
    const { spaces } = inMemory();
    const zipped = await zip([
      { path: 'main.kup', data: text('cube(1)\n') },
      { path: 'parts/lid.kup', data: text('cube(2)\n') },
    ]);
    await spaces.fromZip('Loose', new Uint8Array(await zipped.arrayBuffer()));
    expect(await contentOf(spaces, 'Loose')).toEqual({
      'main.kup': 'cube(1)\n',
      parts: null,
      'parts/lid.kup': 'cube(2)\n',
    });
  });

  it('is not made of a zip refused, nor of a name refused', async () => {
    const { spaces } = inMemory();
    const zipped = await zip([{ path: '../escape.kup', data: text('') }]);
    await expect(spaces.fromZip('Bad', new Uint8Array(await zipped.arrayBuffer()))).rejects.toThrow(
      'leaves its folder',
    );
    await expect(spaces.fromZip('a/b', new Uint8Array())).rejects.toThrow('/');
    expect(await spaces.list()).toEqual([DEFAULT_WORKSPACE]);
  });
});

/** A file of a zip, empty. @param {string} path */
const file = (path) => ({ path, data: text('') });

describe("a zip's files as a workspace's", () => {
  it('lose the one folder they are all in, and what macOS adds', () => {
    expect(
      withoutTopFolder([
        { path: 'Shelf' },
        file('Shelf/main.kup'),
        { path: '__MACOSX' },
        file('__MACOSX/Shelf/._main.kup'),
      ]).map(({ path }) => path),
    ).toEqual(['main.kup']);
  });

  it('keep their folders where they are in more than one, or a file is at the top', () => {
    const loose = [file('main.kup'), file('parts/lid.kup')];
    expect(withoutTopFolder(loose)).toEqual(loose);
    const one = [file('README')];
    expect(withoutTopFolder(one)).toEqual(one);
  });
});

describe("a workspace's name made new", () => {
  it.each([
    ['Shelf', 'Shelf 2'],
    ['shelf', 'shelf 2'],
    ['Bins', 'Bins'],
    ['  ', 'Workspace'],
    ['a/b\\c', 'a b c'],
    ['x'.repeat(MAX_WORKSPACE_NAME + 5), 'x'.repeat(MAX_WORKSPACE_NAME)],
  ])('%j: %j', (base, name) => {
    expect(uniqueWorkspaceName(base, [DEFAULT_WORKSPACE, 'Shelf', 'Shelf 3'])).toBe(name);
  });

  it('is shortened to leave room for its number', () => {
    const long = 'x'.repeat(MAX_WORKSPACE_NAME);
    expect(uniqueWorkspaceName(long, [long])).toBe(`${'x'.repeat(MAX_WORKSPACE_NAME - 2)} 2`);
  });
});

describe("the page's hash", () => {
  it('names a workspace, any characters in its name', () => {
    for (const name of ['Shelf', 'Ящик 2', 'a+b&c=d#e%f']) {
      expect(workspaceOfHash(hashOf(name))).toBe(name);
    }
    expect(workspaceOfHash('')).toBeNull();
    expect(workspaceOfHash('#other=1')).toBeNull();
    expect(workspaceOfHash('#w=My%20shelf')).toBe('My shelf');
  });
});

describe("a new workspace's name", () => {
  const existing = [DEFAULT_WORKSPACE, 'Shelf'];

  it.each([
    ['Brackets', null],
    ['  Brackets  ', null],
    ['Ящики для інструментів', null],
    ['', 'Give the workspace a name.'],
    ['   ', 'Give the workspace a name.'],
    ['x'.repeat(MAX_WORKSPACE_NAME + 1), `A name is ${MAX_WORKSPACE_NAME} characters at most.`],
    ['a/b', 'A name has no / or \\, and isn’t . or ..'],
    ['a\\b', 'A name has no / or \\, and isn’t . or ..'],
    ['.', 'A name has no / or \\, and isn’t . or ..'],
    ['..', 'A name has no / or \\, and isn’t . or ..'],
    ['tab\there', 'A name has no control characters.'],
    ['shelf', 'There is a workspace “shelf” already.'],
    ['default', 'There is a workspace “default” already.'],
  ])('%j: %s', (name, error) => {
    expect(workspaceNameError(name, existing)).toBe(error);
  });

  it('counts characters, not UTF-16 units', () => {
    expect(workspaceNameError('😀'.repeat(MAX_WORKSPACE_NAME), existing)).toBeNull();
  });
});
