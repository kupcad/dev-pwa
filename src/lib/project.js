// What the IDE knows of a project besides its files: the starter it is made with the first time,
// what a script in it may import (and whether that changed), and the name a script's exports
// are given.

import { parentOf, within } from '@kupcad/files';

/** @import { Entry } from '@kupcad/files' */

/** The script a project opens with when none was open last: the starter's that imports the other. */
export const MAIN_SCRIPT = '/main.kup';

/** The scripts a new project starts with, by their paths: one importing the other. */
export const STARTER = {
  [MAIN_SCRIPT]: `# A tray: change its size beside the model, or the script here. Its shape is a script of its
# own, parts/tray.kup, which this one imports. New script and New folder are above the files.
import { tray } from "./parts/tray.kup"

width = param(:width, default: 80, validate: { min: 30, max: 200 }, unit: "mm", title: "Width")
depth = param(:depth, default: 50, validate: { min: 30, max: 200 }, unit: "mm", title: "Depth")
height = param(:height, default: 20, validate: { min: 8, max: 60 }, unit: "mm", title: "Height")
wall = param(:wall, default: 2, validate: { min: 1, max: 5 }, unit: "mm", title: "Wall")

tray(width, depth, height, wall).named("tray")
`,
  '/parts/tray.kup': `# An open tray: a box rounded at its upright edges, hollowed from the top, its walls and floor
# \`wall\` thick.
def tray(width, depth, height, wall)
  corner = [width, depth].min / 6
  outside = square([width, depth], center: true, round_r: corner)
  inside = square([width - 2 * wall, depth - 2 * wall], center: true, round_r: corner - wall)
  outside.extrude(height) - inside.extrude(height).translate(z: wall)
end

export tray
`,
};

/**
 * The files the script at `path` may import, each by the path it names it by: those in its
 * folder and in the folders in it, from there (the core's files are rooted at the script's
 * folder, as `kupcad` run in it is), but not the script itself.
 * @param {Entry[]} entries the project's
 * @param {string} path
 * @returns {{ entry: Entry, name: string }[]}
 */
export function importable(entries, path) {
  const dir = parentOf(path);
  const from = dir.endsWith('/') ? dir.length : dir.length + 1;
  return entries
    .filter((entry) => entry.kind !== 'folder' && entry.path !== path && within(entry.path, dir))
    .map((entry) => ({ entry, name: entry.path.slice(from) }));
}

/**
 * Whether two sets of files a script imports are the same: the same paths, each with the same
 * text or bytes.
 * @param {Record<string, string | Uint8Array>} a
 * @param {Record<string, string | Uint8Array>} b
 */
export function sameFiles(a, b) {
  const paths = Object.keys(a);
  if (paths.length !== Object.keys(b).length) return false;
  return paths.every((path) => {
    const [x, y] = [a[path], b[path]];
    if (typeof x === 'string' || typeof y === 'string') return x === y;
    return y !== undefined && x.length === y.length && x.every((byte, i) => byte === y[i]);
  });
}

/**
 * A file's name without its extension: what a script's exports are named after.
 * @param {string} name
 */
export function stemOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
