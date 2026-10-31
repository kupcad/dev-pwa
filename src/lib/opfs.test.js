import { listFolder } from '@kupcad/files';
import { describe, expect, it } from 'vitest';
import { memoryFolder } from './memory-opfs.test-helper.js';
import { opfsFiles, projectFolder } from './opfs.js';

/** The project's files, in a folder of a stand-in for OPFS, with a few files in it. */
async function project() {
  const files = opfsFiles(memoryFolder());
  await files.mkdir('/parts/covers');
  await files.write('/main.kup', 'cube(1)\n');
  await files.write('/parts/lid.kup', 'cube(2)\n');
  await files.write('/parts/covers/logo.svg', new Uint8Array([60, 115, 118, 103]));
  return files;
}

/** The tree @kupcad/files lists of them. @param {import('./opfs.js').ProjectFiles} files */
const treeOf = async (files) =>
  (await listFolder('/', files)).map(({ kind, path }) => `${kind} ${path}`);

describe("the project's files", () => {
  it('are listed for the tree, each folder in its place', async () => {
    expect(await treeOf(await project())).toEqual([
      'folder /parts',
      'folder /parts/covers',
      'data /parts/covers/logo.svg',
      'script /parts/lid.kup',
      'script /main.kup',
    ]);
  });

  it('are read as text and as bytes, and written over', async () => {
    const files = await project();
    expect(await files.read('/parts/lid.kup')).toBe('cube(2)\n');
    expect([...(await files.readBytes('/parts/covers/logo.svg'))]).toEqual([60, 115, 118, 103]);
    await files.write('/parts/lid.kup', 'cube(3)\n');
    expect(await files.read('/parts/lid.kup')).toBe('cube(3)\n');
  });

  it('tell a file written again from the one it was, by its size and when it was written', async () => {
    const files = await project();
    const before = await files.stat('/main.kup');
    await files.write('/main.kup', 'cube(1)\n');
    const same = await files.stat('/main.kup');
    await files.write('/main.kup', 'cube(2)\n');
    const after = await files.stat('/main.kup');
    expect(same.size).toBe(before.size);
    expect(after.lastModified).toBeGreaterThan(same.lastModified);
  });

  it('say whether a file or a folder is there', async () => {
    const files = await project();
    expect(
      await Promise.all(['/main.kup', '/parts', '/gone.kup', '/gone/a.kup'].map(files.exists)),
    ).toEqual([true, true, false, false]);
  });

  it("aren't written in a folder that isn't there", async () => {
    const files = await project();
    await expect(files.write('/gone/a.kup', '')).rejects.toThrow(
      expect.objectContaining({ name: 'NotFoundError' }),
    );
  });

  it('are renamed, a folder with all that is in it', async () => {
    const files = await project();
    await files.rename('/main.kup', '/box.kup');
    await files.rename('/parts', '/pieces');
    expect(await treeOf(files)).toEqual([
      'folder /pieces',
      'folder /pieces/covers',
      'data /pieces/covers/logo.svg',
      'script /pieces/lid.kup',
      'script /box.kup',
    ]);
    expect(await files.read('/box.kup')).toBe('cube(1)\n');
    expect([...(await files.readBytes('/pieces/covers/logo.svg'))]).toEqual([60, 115, 118, 103]);
  });

  it('are renamed in their case alone, which is another name to OPFS', async () => {
    const files = await project();
    await files.rename('/main.kup', '/Main.kup');
    expect(await treeOf(files)).toContain('script /Main.kup');
    expect(await files.exists('/main.kup')).toBe(false);
  });

  it('are removed, a folder with all that is in it', async () => {
    const files = await project();
    await files.remove('/parts');
    await files.remove('/main.kup');
    expect(await files.readDir('/')).toEqual([]);
  });
});

it("keeps the project in a folder of the origin's private file system, made the first time", async () => {
  const root = memoryFolder();
  const storage = { getDirectory: async () => root };
  const folder = await projectFolder(storage);
  expect(folder.name).toBe('project');
  expect(await projectFolder(storage)).toBe(folder);
  // Its files at once, each call once the folder is there
  const files = opfsFiles(projectFolder(storage));
  await files.write('/a.kup', 'cube(1)\n');
  expect(await opfsFiles(folder).read('/a.kup')).toBe('cube(1)\n');
});

it("fails each call as getting the project's folder did", async () => {
  const denied = new DOMException('No storage here', 'SecurityError');
  const files = opfsFiles(projectFolder({ getDirectory: () => Promise.reject(denied) }));
  await expect(files.readDir('/')).rejects.toBe(denied);
});
