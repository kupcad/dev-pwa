// A file or a folder copied, or moved, from the workspace open into a folder of another (the
// tree's Copy to workspace… and Move to workspace…). A name the folder has is asked about as an
// upload's is (@kupcad/files' clashQuestion): Replace, Rename to the next free name (keeping
// both), or Cancel. A move is a copy, then the removal of what was copied.

import { childPath, nameOf, nameProblem } from '@kupcad/files';

/** @import { Clash } from '@kupcad/files' */
/** @import { ProjectFiles } from './opfs.js' */

/**
 * The folder a path typed names, as a path from the workspace's root (`/`, `/parts`), or null
 * where it can't be one: each of its names one the tree takes (@kupcad/files' nameProblem: no
 * `..`, no `\`, nothing hidden).
 * @param {string} typed
 */
export function folderOf(typed) {
  const names = typed
    .trim()
    .split('/')
    .filter((name) => name !== '');
  if (names.some((name) => nameProblem(name) !== null)) return null;
  return `/${names.join('/')}`;
}

/**
 * The first free name of `name`'s with a number after its stem, as a file manager keeps both
 * (`lid 2.kup`, then `lid 3.kup`): the rule @kupcad/files' putFiles names an upload by, which
 * the package doesn't export.
 * @param {string} name
 * @param {(name: string) => Promise<boolean>} free
 */
export async function freeName(name, free) {
  const dot = name.lastIndexOf('.');
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  const numbered = /^(.*) (\d+)$/.exec(stem);
  const base = numbered ? numbered[1] : stem;
  for (let n = numbered ? Number(numbered[2]) + 1 : 2; ; n += 1) {
    const candidate = `${base} ${n}${extension}`;
    if (await free(candidate)) return candidate;
  }
}

/**
 * Copies the file or folder at `path` of `from` to `to`'s `target`, what is in a folder too.
 * @param {ProjectFiles} from
 * @param {string} path
 * @param {boolean} folder whether it is a folder
 * @param {ProjectFiles} to
 * @param {string} target
 */
async function copyAcross(from, path, folder, to, target) {
  if (!folder) {
    await to.write(target, await from.readBytes(path));
    return;
  }
  await to.mkdir(target);
  for (const child of await from.readDir(path)) {
    await copyAcross(
      from,
      childPath(path, child.name),
      child.isDirectory,
      to,
      childPath(target, child.name),
    );
  }
}

/**
 * Copies (or moves) the file or folder at `path` of `from` into the folder `dir` of `to`, made
 * where it isn't. Where `dir` has its name, `clash` asks what to do: replace what is there, take
 * the next free name, or nothing.
 * @param {object} transfer
 * @param {ProjectFiles} transfer.from
 * @param {string} transfer.path
 * @param {boolean} transfer.folder whether it is a folder
 * @param {ProjectFiles} transfer.to
 * @param {string} transfer.dir
 * @param {(name: string, renamed: string) => Promise<Clash>} transfer.clash
 * @param {boolean} [transfer.move] whether it is removed from `from` once copied
 * @returns {Promise<string | null>} the path it has in `to`, or null for none (cancelled)
 */
export async function transfer({ from, path, folder, to, dir, clash, move = false }) {
  const name = nameOf(path);
  let target = childPath(dir, name);
  if (await to.exists(target)) {
    const renamed = await freeName(name, async (free) => !(await to.exists(childPath(dir, free))));
    const choice = await clash(name, renamed);
    if (choice === 'cancel') return null;
    if (choice === 'replace') await to.remove(target);
    else target = childPath(dir, renamed);
  }
  await to.mkdir(dir);
  await copyAcross(from, path, folder, to, target);
  if (move) await from.remove(path);
  return target;
}
