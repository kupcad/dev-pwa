// The IDE's workspaces: projects of their own, each a folder of the browser's private file system
// under `workspaces/` (OPFS has no namespaces of its own), its name the folder's. The default one
// is always there and can't be deleted; the others are made, and deleted with all their files.

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
 * The workspaces in `storage`'s private file system: listed, each one's folder, made and deleted.
 * @param {Pick<StorageManager, 'getDirectory'>} [storage]
 */
export function workspaces(storage = navigator.storage) {
  /** The folder the workspaces are in, made the first time. */
  const root = async () =>
    (await storage.getDirectory()).getDirectoryHandle(WORKSPACES_FOLDER, { create: true });

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
      const error = workspaceNameError(name, await this.list());
      if (error !== null) throw new Error(error);
      const trimmed = name.trim();
      await (await root()).getDirectoryHandle(trimmed, { create: true });
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
