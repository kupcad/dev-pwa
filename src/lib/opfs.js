// The project's files in the browser's origin private file system (OPFS): a workspace's folder
// (workspaces.js), its entries by their paths from its root (`/main.kup`, `/parts/lid.kup`), listed for the tree
// (`readDir`, as @kupcad/files' listFolder takes it), read, written, made, renamed and removed,
// and all of them walked (a workspace downloaded, measured). A rename is a copy, then the removal
// of what was copied: no rename is in every browser's OPFS; `copyFolder` copies a workspace so.

/** @import { DirEntry } from '@kupcad/files' */

/** The names a path has, from the root. @param {string} path */
const namesOf = (path) => path.split('/').filter((name) => name !== '');

/**
 * Writes the file `name` in the folder `dir`, made where it isn't.
 * @param {FileSystemDirectoryHandle} dir
 * @param {string} name
 * @param {string | Uint8Array<ArrayBuffer>} data
 */
async function writeIn(dir, name, data) {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
  try {
    await writable.write(data);
  } finally {
    await writable.close();
  }
}

/**
 * What a project's files are read and written with, under `root` (once it is there, for a
 * promise of it: each call fails as getting it did).
 * @param {FileSystemDirectoryHandle | Promise<FileSystemDirectoryHandle>} root
 */
export function opfsFiles(root) {
  const ready = Promise.resolve(root);
  // Its failure is each call's, not one of its own before the first call
  ready.catch(() => {});

  /**
   * The folder at `path`; with `create`, made where it isn't, and the folders it is in.
   * @param {string} path
   */
  const folder = async (path, create = false) => {
    let dir = await ready;
    for (const name of namesOf(path)) dir = await dir.getDirectoryHandle(name, { create });
    return dir;
  };

  /**
   * The folder `path` is in, and its name there.
   * @param {string} path
   */
  const placeOf = async (path) => {
    const names = namesOf(path);
    const name = names.pop();
    if (name === undefined) throw new TypeError('The project itself is no file');
    return { dir: await folder(names.join('/')), name };
  };

  /**
   * The file or folder at `path`.
   * @param {string} path
   * @returns {Promise<FileSystemFileHandle | FileSystemDirectoryHandle>}
   */
  const handleOf = async (path) => {
    const { dir, name } = await placeOf(path);
    try {
      return await dir.getFileHandle(name);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'TypeMismatchError') throw error;
      return dir.getDirectoryHandle(name);
    }
  };

  /** @param {string} path */
  const fileOf = async (path) => {
    const { dir, name } = await placeOf(path);
    return (await dir.getFileHandle(name)).getFile();
  };

  const files = {
    /**
     * The entries of the folder at `path`.
     * @param {string} path
     * @returns {Promise<DirEntry[]>}
     */
    async readDir(path) {
      /** @type {DirEntry[]} */
      const entries = [];
      for await (const handle of (await folder(path)).values()) {
        entries.push({
          name: handle.name,
          isDirectory: handle.kind === 'directory',
          isFile: handle.kind === 'file',
        });
      }
      return entries;
    },

    /** @param {string} path */
    read: async (path) => (await fileOf(path)).text(),

    /** @param {string} path */
    readBytes: async (path) => new Uint8Array(await (await fileOf(path)).arrayBuffer()),

    /**
     * What tells the file at `path` from the one it was: its size and when it was written.
     * @param {string} path
     */
    async stat(path) {
      const file = await fileOf(path);
      return { size: file.size, lastModified: file.lastModified };
    },

    /**
     * Writes the file at `path`, made where it isn't, in a folder that is.
     * @param {string} path
     * @param {string | Uint8Array<ArrayBuffer>} data
     */
    async write(path, data) {
      const { dir, name } = await placeOf(path);
      await writeIn(dir, name, data);
    },

    /** Whether there is a file or a folder at `path`. @param {string} path */
    async exists(path) {
      try {
        await handleOf(path);
        return true;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') return false;
        throw error;
      }
    },

    /** Makes the folder at `path`, and the folders it is in. @param {string} path */
    async mkdir(path) {
      await folder(path, true);
    },

    /**
     * Moves the file or folder at `from` to `to`, where nothing is.
     * @param {string} from
     * @param {string} to
     */
    async rename(from, to) {
      await copy(from, to);
      await files.remove(from);
    },

    /** Removes the file or folder at `path`, with all that is in it. @param {string} path */
    async remove(path) {
      const { dir, name } = await placeOf(path);
      await dir.removeEntry(name, { recursive: true });
    },

    /**
     * Every folder and file in the project, by their paths without the leading `/` (as a zip
     * has them), a folder before what is in it; a file with its `File`, which has its size and
     * time written and reads its bytes.
     * @returns {Promise<{ path: string, file?: File }[]>}
     */
    async walk() {
      /** @type {{ path: string, file?: File }[]} */
      const found = [];
      /** @param {FileSystemDirectoryHandle} dir @param {string} prefix */
      const walkIn = async (dir, prefix) => {
        for await (const handle of dir.values()) {
          const path = prefix + handle.name;
          if (handle.kind === 'file') {
            found.push({
              path,
              file: await /** @type {FileSystemFileHandle} */ (handle).getFile(),
            });
          } else {
            found.push({ path });
            await walkIn(/** @type {FileSystemDirectoryHandle} */ (handle), `${path}/`);
          }
        }
      };
      await walkIn(await ready, '');
      return found;
    },
  };

  /**
   * Copies the file or folder at `from` to `to`, what is in a folder too.
   * @param {string} from
   * @param {string} to
   */
  async function copy(from, to) {
    const handle = await handleOf(from);
    if (handle.kind === 'file') {
      await files.write(to, new Uint8Array(await (await handle.getFile()).arrayBuffer()));
      return;
    }
    await files.mkdir(to);
    await copyFolder(handle, await folder(to));
  }

  return files;
}

/**
 * Copies what is in the folder `from` into the folder `to`, folders and all.
 * @param {FileSystemDirectoryHandle} from
 * @param {FileSystemDirectoryHandle} to
 */
export async function copyFolder(from, to) {
  for await (const handle of from.values()) {
    if (handle.kind === 'file') {
      const file = await /** @type {FileSystemFileHandle} */ (handle).getFile();
      await writeIn(to, handle.name, new Uint8Array(await file.arrayBuffer()));
    } else {
      await copyFolder(
        /** @type {FileSystemDirectoryHandle} */ (handle),
        await to.getDirectoryHandle(handle.name, { create: true }),
      );
    }
  }
}

/** @typedef {ReturnType<typeof opfsFiles>} ProjectFiles */
