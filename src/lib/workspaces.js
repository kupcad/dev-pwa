// The IDE's workspaces: projects of their own, each a folder of the browser's private file system
// under `workspaces/` (OPFS has no namespaces of its own), its name the folder's. None is special:
// the first visit makes one, `Default`, with the example in it (as one does where all were
// cleared), and any is renamed, or deleted with all its files while another is left.
// Each is renamed and duplicated by copying its folder (OPFS has no rename).
// Each is downloaded as a zip of its files in a folder named for it, and a zip is imported as a
// new one, its files with or without such a folder: the files the tree shows (scripts and the data
// they read), the rest left out.

import { kindOf, SKIPPED_FOLDER } from '@kupcad/files';
import { copyFolder, opfsFiles } from './opfs.js';
import { unzip, zip } from './zip.js';

/** @import { ZipEntry } from './zip.js' */

/** The folder of the origin's private file system the workspaces are in. */
const WORKSPACES_FOLDER = 'workspaces';
/** The name of the workspace a first visit makes (where there is none), with the example in it. */
export const FIRST_WORKSPACE = 'Default';
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

/** Whether `path` is in a folder the tree hides, or is one. @param {string} path */
const inHiddenFolder = (path) => path.split('/').some((name) => SKIPPED_FOLDER.test(name));

/**
 * The entries of a zip (`withoutTopFolder`'s) a workspace keeps: the files the tree shows, scripts
 * and the data they read (@kupcad/files' kindOf), in no folder it hides (a hidden one,
 * `node_modules`, `target`: SKIPPED_FOLDER), and the folders that hold nothing; the rest
 * counted. Kept, the others would be in the browser's storage unseen, used by no script, and
 * in the workspace's next zip.
 * @param {ZipEntry[]} entries
 * @returns {{ kept: ZipEntry[], skipped: number }}
 */
export function usableEntries(entries) {
  const files = entries.filter((entry) => entry.data !== undefined);
  const kept = files.filter(
    ({ path }) =>
      !inHiddenFolder(path) && kindOf(/** @type {string} */ (path.split('/').at(-1))) !== null,
  );
  // A folder made where a file kept is in it; one that holds nothing is kept as it is
  const empty = entries.filter(
    ({ path, data }) =>
      data === undefined &&
      !inHiddenFolder(path) &&
      !files.some((file) => file.path.startsWith(`${path}/`)),
  );
  return { kept: [...empty, ...kept], skipped: files.length - kept.length };
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

  /**
   * Moves the workspace `from` to `to`, a name no other has: a copy, then the deletion of what
   * was copied (OPFS has no rename).
   * @param {string} from
   * @param {string} to
   */
  const move = async (from, to) => {
    const source = await (await root()).getDirectoryHandle(from);
    await made(to, (folder) => copyFolder(source, folder));
    await (await root()).removeEntry(from, { recursive: true });
  };

  return {
    /**
     * The workspaces' names, in alphabetical order.
     * @returns {Promise<string[]>}
     */
    async list() {
      /** @type {string[]} */
      const names = [];
      for await (const handle of (await root()).values()) {
        if (handle.kind === 'directory') names.push(handle.name);
      }
      return names.toSorted((a, b) => a.localeCompare(b));
    },

    /**
     * The workspaces' names, as `list` gives them; where there is none (a first visit, or all
     * cleared), the first is made, `FIRST_WORKSPACE`, with `starter`'s files in it.
     * @param {Record<string, string>} starter the files, by their paths (`/parts/tray.kup`)
     * @returns {Promise<string[]>}
     */
    async listOrMakeFirst(starter) {
      const names = await this.list();
      if (names.length > 0) return names;
      await made(FIRST_WORKSPACE, async (folder) => {
        const files = opfsFiles(folder);
        for (const [path, text] of Object.entries(starter)) {
          await files.mkdir(path.split('/').slice(0, -1).join('/'));
          await files.write(path, text);
        }
      });
      return this.list();
    },

    /**
     * The folder of the workspace `name`, found, never made (one deleted in another tab isn't
     * made again by opening it).
     * @param {string} name
     */
    async folder(name) {
      return (await root()).getDirectoryHandle(name);
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
     * @param {string} [except] a workspace whose name it may have (one being renamed)
     */
    async newName(name, except) {
      const others = (await this.list()).filter((other) => other !== except);
      const error = workspaceNameError(name, others);
      if (error !== null) throw new Error(error);
      return name.trim();
    },

    /**
     * Makes the workspace `to`, a copy of `from` with all its files.
     * @param {string} from
     * @param {string} to
     * @returns {Promise<string>} the name it was made with
     */
    async duplicate(from, to) {
      const trimmed = await this.newName(to);
      const source = await this.folder(from);
      await made(trimmed, (folder) => copyFolder(source, folder));
      return trimmed;
    },

    /**
     * Renames the workspace `from` to `to`; its own name, in another case, is one it may be
     * given.
     * @param {string} from
     * @param {string} to
     * @returns {Promise<string>} the name it was given
     */
    async rename(from, to) {
      const trimmed = await this.newName(to, from);
      if (trimmed === from) return from;
      if (trimmed.toLowerCase() === from.toLowerCase()) {
        // A browser's OPFS may keep its names in a file system that ignores case, where the
        // copy would be the folder itself: it goes by a name of its own first
        const between = uniqueWorkspaceName(`${trimmed} (renaming)`, await this.list());
        await move(from, between);
        await move(between, trimmed);
      } else {
        await move(from, trimmed);
      }
      return trimmed;
    },

    /**
     * How many files the workspace `name` has, and how many bytes they are.
     * @param {string} name
     */
    async size(name) {
      const found = (await opfsFiles(this.folder(name)).walk()).flatMap(({ file }) =>
        file ? [file.size] : [],
      );
      return { files: found.length, bytes: found.reduce((sum, size) => sum + size, 0) };
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
     * Makes the workspace `name` of the zip `bytes`'s files that it uses (`usableEntries`),
     * refused (nothing made) as `unzip` refuses the zip.
     * @param {string} name
     * @param {Uint8Array<ArrayBuffer>} bytes
     * @returns {Promise<{ name: string, skipped: number }>} the name it was made with, and how
     *   many of the zip's files were left out
     */
    async fromZip(name, bytes) {
      const trimmed = await this.newName(name);
      const { kept: entries, skipped } = usableEntries(withoutTopFolder(await unzip(bytes)));
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
      return { name: trimmed, skipped };
    },

    /**
     * Deletes the workspace `name` and all its files, while another is left: the last can't be.
     * @param {string} name
     */
    async remove(name) {
      if ((await this.list()).every((other) => other === name)) {
        throw new Error('The last workspace can’t be deleted.');
      }
      await (await root()).removeEntry(name, { recursive: true });
    },
  };
}

/** @typedef {ReturnType<typeof workspaces>} Workspaces */
