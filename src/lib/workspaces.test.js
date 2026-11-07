import { describe, expect, it } from 'vitest';
import { memoryFolder } from './memory-opfs.test-helper.js';
import { opfsFiles } from './opfs.js';
import {
  DEFAULT_WORKSPACE,
  MAX_WORKSPACE_NAME,
  workspaceNameError,
  workspaces,
} from './workspaces.js';

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
