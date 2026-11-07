// The IDE's workspaces: projects of their own, each a folder of the browser's private file system
// under `workspaces/` (OPFS has no namespaces of its own), its name the folder's. The default one
// is always there and can't be deleted; the others are made, and deleted with all their files.
// Each is downloaded as a zip of its files in a folder named for it, and a zip is imported as a
// new one, its files with or without such a folder.

import { opfsFiles } from './opfs.js';
import { unzip, zip } from './zip.js';

/** @import { ZipEntry } from './zip.js' */

/** The folder of the origin's private file system the workspaces are in. */
const WORKSPACES_FOLDER = 'workspaces';
/** The workspace there always is: the one a first visit opens, and the one left when another goes. */
export const DEFAULT_WORKSPACE = 'Default';
/** The longest name a workspace may have, in characters. */
export const MAX_WORKSPACE_NAME = 64;

/**
 * Why `name` can't be a new workspace's, or null when it can: it is trimmed first, as the
 * workspace is made with it.
 * @param {string} name
 * @param {string[]} existing the workspaces there are
 * @returns {string | null}
 */
export function workspaceNameError(name, existing) {
  const trimmed = name.trim();
  if (trimmed === '') return 'Give the workspace a name.';
  if ([...trimmed].length > MAX_WORKSPACE_NAME) {
    return `A name is ${MAX_WORKSPACE_NAME} characters at most.`;
  }
  // A folder's name: no separator, and none of the names that mean another folder
  if (/[/\\]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    return 'A name has no / or \\, and isn’t . or ..';
  }
  if ([...trimmed].some((character) => /\p{Cc}/u.test(character))) {
    return 'A name has no control characters.';
  }
  // Names that differ only in case would look the same in the list
  const folded = trimmed.toLowerCase();
  if (existing.some((other) => other.toLowerCase() === folded)) {
    return `There is a workspace “${trimmed}” already.`;
  }
  return null;
}

/**
 * `base` trimmed and made a new workspace's name: as it is where it can be, else with the first
 * number from 2 that makes it one (`Shelf 2`), shortened to leave room for it.
 * @param {string} base
 * @param {string[]} existing the workspaces there are
 */
export function uniqueWorkspaceName(base, existing) {
  const trimmed =
    base
      .trim()
      .replace(/[/\\\p{Cc}]/gu, ' ')
      .trim() || 'Workspace';
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? '' : ` ${n}`;
    const room = MAX_WORKSPACE_NAME - [...suffix].length;
    const name = [...trimmed].slice(0, room).join('').trim() + suffix;
    if (workspaceNameError(name, existing) === null) return name;
  }
}

/**
 * A zip's files and folders as a workspace's: the folder they are all in, if they are (as a
 * folder compressed by the system's file manager is, and a workspace downloaded), taken off,
 * and the folder macOS adds of its own (`__MACOSX`) left out.
 * @param {ZipEntry[]} entries
 */
export function withoutTopFolder(entries) {
  const kept = entries.filter(({ path }) => path !== '__MACOSX' && !path.startsWith('__MACOSX/'));
  const tops = new Set(kept.map(({ path }) => path.split('/')[0]));
  const [top] = tops;
  if (tops.size !== 1 || kept.some((entry) => entry.path === top && entry.data !== undefined)) {
    return kept;
  }
  return kept
    .filter((entry) => entry.path !== top)
    .map((entry) => ({ ...entry, path: entry.path.slice(top.length + 1) }));
}

/** The hash of the page's URL that names the workspace `name`. @param {string} name */
export const hashOf = (name) => `#w=${encodeURIComponent(name)}`;

/**
 * The workspace the page's URL names in its hash (`#w=Shelf`), or null for none.
 * @param {string} hash
 */
export const workspaceOfHash = (hash) => new URLSearchParams(hash.slice(1)).get('w');

/**
 * The workspaces in `storage`'s private file system: listed, each one's folder, made and deleted.
 * @param {Pick<StorageManager, 'getDirectory'>} [storage]
 */
export function workspaces(storage = navigator.storage) {
  /** The folder the workspaces are in, made the first time. */
  const root = async () =>
    (await storage.getDirectory()).getDirectoryHandle(WORKSPACES_FOLDER, { create: true });

  /**
   * Makes the workspace `name`, then fills it; where filling it fails, it is deleted, nothing
   * half made left.
   * @param {string} name
   * @param {(folder: FileSystemDirectoryHandle) => Promise<void>} fill
   */
  const made = async (name, fill) => {
    const folder = await (await root()).getDirectoryHandle(name, { create: true });
    try {
      await fill(folder);
    } catch (error) {
      await (await root()).removeEntry(name, { recursive: true }).catch(() => {});
      throw error;
    }
  };

  return {
    /**
     * The workspaces' names: the default first (made if it isn't there), then the others in
     * alphabetical order.
     * @returns {Promise<string[]>}
     */
    async list() {
      const folder = await root();
      await folder.getDirectoryHandle(DEFAULT_WORKSPACE, { create: true });
      /** @type {string[]} */
      const others = [];
      for await (const handle of folder.values()) {
        if (handle.kind === 'directory' && handle.name !== DEFAULT_WORKSPACE) {
          others.push(handle.name);
        }
      }
      others.sort((a, b) => a.localeCompare(b));
      return [DEFAULT_WORKSPACE, ...others];
    },

    /**
     * The folder of the workspace `name`: the default's made the first time, another's only
     * found (one deleted in another tab isn't made again by opening it).
     * @param {string} name
     */
    async folder(name) {
      return (await root()).getDirectoryHandle(name, { create: name === DEFAULT_WORKSPACE });
    },

    /**
     * Makes a workspace, empty, named `name` trimmed; refused as `workspaceNameError` refuses it.
     * @param {string} name
     * @returns {Promise<string>} the name it was made with
     */
    async create(name) {
      const trimmed = await this.newName(name);
      await made(trimmed, async () => {});
      return trimmed;
    },

    /**
     * `name` trimmed, where it can be a new workspace's; refused as `workspaceNameError` refuses
     * it otherwise.
     * @param {string} name
     */
    async newName(name) {
      const error = workspaceNameError(name, await this.list());
      if (error !== null) throw new Error(error);
      return name.trim();
    },

    /**
     * The workspace `name` as a zip: its files and folders in a folder named for it.
     * @param {string} name
     */
    async toZip(name) {
      const found = await opfsFiles(this.folder(name)).walk();
      /** @type {ZipEntry[]} */
      const entries = [{ path: name }];
      for (const { path, file } of found) {
        entries.push(
          file
            ? {
                path: `${name}/${path}`,
                data: new Uint8Array(await file.arrayBuffer()),
                modified: file.lastModified,
              }
            : { path: `${name}/${path}` },
        );
      }
      return zip(entries);
    },

    /**
     * Makes the workspace `name` of the zip `bytes`'s files, refused (nothing made) as `unzip`
     * refuses the zip.
     * @param {string} name
     * @param {Uint8Array<ArrayBuffer>} bytes
     * @returns {Promise<string>} the name it was made with
     */
    async fromZip(name, bytes) {
      const trimmed = await this.newName(name);
      const entries = withoutTopFolder(await unzip(bytes));
      await made(trimmed, async (folder) => {
        const files = opfsFiles(folder);
        for (const { path, data } of entries) {
          const parent = path.split('/').slice(0, -1).join('/');
          if (data === undefined) await files.mkdir(path);
          else {
            await files.mkdir(parent);
            await files.write(path, data);
          }
        }
      });
      return trimmed;
    },

    /**
     * Deletes the workspace `name` and all its files; the default can't be.
     * @param {string} name
     */
    async remove(name) {
      if (name === DEFAULT_WORKSPACE) throw new Error('The default workspace can’t be deleted.');
      await (await root()).removeEntry(name, { recursive: true });
    },
  };
}

/** @typedef {ReturnType<typeof workspaces>} Workspaces */
