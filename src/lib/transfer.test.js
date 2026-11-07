import { describe, expect, it, vi } from 'vitest';
import { memoryFolder } from './memory-opfs.test-helper.js';
import { opfsFiles } from './opfs.js';
import { folderOf, transfer } from './transfer.js';

/** Two workspaces' files: one with a script and a folder of two, the other with `/main.kup`. */
async function twoWorkspaces() {
  const from = opfsFiles(memoryFolder());
  await from.mkdir('/parts/covers');
  await from.write('/main.kup', 'cube(1)\n');
  await from.write('/parts/lid.kup', 'cube(2)\n');
  await from.write('/parts/covers/logo.svg', new Uint8Array([60, 115]));
  const to = opfsFiles(memoryFolder());
  await to.write('/main.kup', 'cube(9)\n');
  return { from, to };
}

/** The paths of `files`, a file's with its text. @param {import('./opfs.js').ProjectFiles} files */
async function contentOf(files) {
  const found = await files.walk();
  return Object.fromEntries(
    await Promise.all(found.map(async ({ path, file }) => [path, (await file?.text()) ?? null])),
  );
}

describe('a file or a folder taken to another workspace', () => {
  it('is copied, a folder with all that is in it, into a folder made for it, the source kept', async () => {
    const { from, to } = await twoWorkspaces();
    const clash = vi.fn();
    expect(await transfer({ from, path: '/parts', folder: true, to, dir: '/pieces', clash })).toBe(
      '/pieces/parts',
    );
    expect(await contentOf(to)).toMatchObject({
      'pieces/parts/lid.kup': 'cube(2)\n',
      'pieces/parts/covers/logo.svg': '<s',
    });
    expect(await from.exists('/parts/covers/logo.svg')).toBe(true);
    expect(clash).not.toHaveBeenCalled();
  });

  it('is moved: copied, then removed from where it was', async () => {
    const { from, to } = await twoWorkspaces();
    const clash = vi.fn();
    await transfer({
      from,
      path: '/parts/lid.kup',
      folder: false,
      to,
      dir: '/',
      clash,
      move: true,
    });
    expect(await to.read('/lid.kup')).toBe('cube(2)\n');
    expect(await from.exists('/parts/lid.kup')).toBe(false);
    expect(await from.exists('/parts')).toBe(true);
  });

  it('asks of a name the folder has: Replace writes over it', async () => {
    const { from, to } = await twoWorkspaces();
    const clash = vi.fn(async () => /** @type {const} */ ('replace'));
    await transfer({ from, path: '/main.kup', folder: false, to, dir: '/', clash, move: true });
    expect(clash).toHaveBeenCalledWith('main.kup', 'main 2.kup');
    expect(await contentOf(to)).toEqual({ 'main.kup': 'cube(1)\n' });
    expect(await from.exists('/main.kup')).toBe(false);
  });

  it('asks of a name the folder has: Rename keeps both, the copy by the next free name', async () => {
    const { from, to } = await twoWorkspaces();
    await to.write('/main 2.kup', '');
    const clash = vi.fn(async () => /** @type {const} */ ('rename'));
    expect(await transfer({ from, path: '/main.kup', folder: false, to, dir: '/', clash })).toBe(
      '/main 3.kup',
    );
    expect(await contentOf(to)).toEqual({
      'main.kup': 'cube(9)\n',
      'main 2.kup': '',
      'main 3.kup': 'cube(1)\n',
    });
  });

  it('asks of a name the folder has: Cancel takes nothing, nor moves it', async () => {
    const { from, to } = await twoWorkspaces();
    const clash = vi.fn(async () => /** @type {const} */ ('cancel'));
    expect(
      await transfer({ from, path: '/main.kup', folder: false, to, dir: '/', clash, move: true }),
    ).toBeNull();
    expect(await to.read('/main.kup')).toBe('cube(9)\n');
    expect(await from.read('/main.kup')).toBe('cube(1)\n');
  });
});

describe('the folder a file is taken to', () => {
  it.each([
    ['/', '/'],
    ['', '/'],
    ['parts', '/parts'],
    [' /parts/covers/ ', '/parts/covers'],
    ['/parts/../..', null],
    ['parts\\covers', null],
    ['.hidden', null],
  ])('%j: %j', (typed, folder) => {
    expect(folderOf(typed)).toBe(folder);
  });
});
