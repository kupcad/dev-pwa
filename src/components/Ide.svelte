<!--
  @component
  The IDE: a project's files beside the playground, all in the browser. The project (@kupcad/files'
  Project) is a workspace's folder of the browser's private file system (opfs.js, workspaces.js),
  the default given a starter while it is empty (project.js). The workspaces are above the files
  (Workspaces): one picked opens its own project (the one open saved first), New workspace… makes
  one, empty, and opens it, Download .zip saves the one open as a zip, Import .zip… makes one of a
  zip and opens it, Rename… and Duplicate… rename and copy the one open (each a copy: OPFS has no
  rename) and open it, and Delete… deletes the one open with its files, the default left open; each
  opens the file it had open last. The URL names the workspace open (#w=…; changed, it opens the
  one it names), and the tabs tell each other of their changes to the workspaces (a
  BroadcastChannel), which they follow at once. An empty workspace offers a script, an upload and the
  example in place of the playground; under the files, the storage used is said. A file or a
  folder is copied or moved to another workspace from its row's menu (TransferDialog, transfer.js). Its tree (@kupcad/files) makes scripts and folders (its bar, a row's menu),
  renames and deletes them, takes the person's files into a folder (dropped on it from the
  system's file manager, or uploaded from a row's menu: a name the folder has asked about,
  Replace, Rename or Cancel) and downloads one (a row's menu, a popover). A script clicked opens
  in the playground as a document of its own, its undo history kept while another is shown, with
  the files of its folder for what it imports; a JSON file (a package's kupcad.json and
  kupcad.lock, data a script imports) opens there too, edited with nothing run. A file is saved a
  moment after each change (the tree marks it until then), and at once with ⌘S (Ctrl+S); the page
  asks before it closes on one not saved yet. Back in front, the page reads the project again:
  another tab's change to a file is taken where this one has none unsaved, and said above the
  editor where it has. The file open last is opened again.
-->
<script>
  import {
    AskDialog,
    clashQuestion,
    ConflictBar,
    ContextMenu,
    DATA_EXTENSIONS,
    FileTree,
    languageOf,
    nameOf,
    parentOf,
    Project,
    refuseStrayDrop,
    rowMenu,
    SCRIPT_EXTENSION,
    within,
  } from '@kupcad/files';
  import { download, Playground } from '@kupcad/playground';
  import { errorText } from '@kupcad/protocol';
  import { localSettings, sizeSetting, Splitter } from '@kupcad/ui';
  import { onMount, tick } from 'svelte';
  import { opfsFiles } from '../lib/opfs.js';
  import { importable, MAIN_SCRIPT, sameFiles, STARTER, stemOf } from '../lib/project.js';
  import { DEFAULT_WORKSPACE, hashOf, workspaceOfHash, workspaces } from '../lib/workspaces.js';
  import { storageUse } from '../lib/storage.js';
  import { transfer } from '../lib/transfer.js';
  import { MAX_ZIP_BYTES } from '../lib/zip.js';
  import TransferDialog from './TransferDialog.svelte';
  import Workspaces from './Workspaces.svelte';

  /** @import { Clash, Entry, MenuItem } from '@kupcad/files' */

  /**
   * A change of the workspaces, as a tab tells the others of it: one made (created, duplicated,
   * imported), deleted or renamed, or the files of one changed.
   * @typedef {{ kind: 'made' | 'deleted' | 'files', name: string } | { kind: 'renamed', from: string, to: string }} Change
   */

  /** The project's root, in its files' paths. */
  const ROOT = '/';
  /** How long a script changed waits to be saved, in milliseconds. */
  const SAVE_MS = 500;
  /** The settings' keys: the files' width, the workspace open, each workspace's file open last. */
  const KEYS = { files: 'ide.files', workspace: 'ide.workspace', open: 'ide.open' };
  /** What the storage line's note that the browser may clear it means. */
  const MAY_CLEAR =
    "The browser may delete the IDE's files when the device runs low on space. Installing the app usually keeps them; Download .zip keeps a copy.";
  /** How long a change to the storage waits to be said, in milliseconds. */
  const STORAGE_MS = 1000;
  /** The channel the tabs tell each other of their changes to the workspaces on. */
  const CHANNEL = 'kupcad-workspaces';
  /** What the upload picker offers: the files a project shows. */
  const ACCEPT = [SCRIPT_EXTENSION, ...DATA_EXTENSIONS].map((extension) => `.${extension}`).join();

  const settings = localSettings();
  // As the settings have it; dragged, the pane's own until the drag is done
  let filesWidth = $derived(sizeSetting(settings, KEYS.files, 224));
  const spaces = workspaces();
  /** A write of the person's: the first asks the browser to keep the project when it frees space. */
  const kept = (/** @type {Promise<void>} */ writing) =>
    writing.then(() => {
      keep();
      storageChanged();
    });
  /** The workspaces there are, the default first. */
  let workspaceNames = $state.raw([DEFAULT_WORKSPACE]);
  /** The workspace the page opens first: the one its URL names, else the one open last. */
  const opensFirst = firstWorkspace();
  /** The workspace open: at first `opensFirst`, until the list says it is there. */
  let workspace = $state(opensFirst);
  /** Whether a workspace is being opened, made or deleted: the workspaces ask nothing meanwhile. */
  let busy = $state(true);
  /** The changes of the workspaces asked for, run one after another (`serially`). */
  let queue = Promise.resolve();
  /** What the tabs tell each other of their changes to the workspaces. */
  let channel = /** @type {BroadcastChannel | null} */ (null);
  /** The workspace open's files. */
  let fs = opfsFiles(spaces.folder(opensFirst));
  /** The project: the workspace open's tree, its scripts, the name being given in it, the saves waiting. */
  let project = $state.raw(projectOf(fs));
  /** The file open. */
  let open = $state.raw(/** @type {Entry | null} */ (null));
  /** What the script open may import, by the paths it names them by. */
  let files = $state.raw(/** @type {Record<string, string | Uint8Array>} */ ({}));
  /**
   * The files read for `files`, by their paths: each as it was when read (its size and time
   * written), so one unchanged isn't read again.
   * @type {Map<string, { stamp: string, content: string | Uint8Array }>}
   */
  const imported = new Map();
  /** The file open as the editor has it: as it was opened, then as the person edits it. */
  let shown = '';
  /** The menu shown: a row's (or the tree's, of none), where it opened. */
  let menu = $state.raw(
    /** @type {{ entry: Entry | null, at: { x: number, y: number } } | null} */ (null),
  );
  /**
   * The question asked (AskDialog's), while the person answers it.
   * @type {{ title: string, text?: string, answers: { text: string, value: string, primary?: boolean }[], cancel: string, answer: (value: string) => void } | null}
   */
  let question = $state.raw(null);
  /** The file or folder being copied (or moved) to another workspace, while the person says where. */
  let transferring = $state.raw(/** @type {{ entry: Entry, move: boolean } | null} */ (null));
  /** What went wrong last, until it is dismissed or something else goes wrong. */
  let problem = $state('');
  /** How many files were asked to open: one read after a later one is asked for isn't shown. */
  let opening = 0;
  /** Whether the browser was asked to keep the project when it frees space. */
  let asked = false;
  /** What the origin's storage holds, as said under the files (null: the browser doesn't say). */
  let storage = $state.raw(/** @type {Awaited<ReturnType<typeof storageUse>>} */ (null));
  /** The wait before the storage is said again, while there is one. */
  let storageTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
  let playground = $state(/** @type {ReturnType<typeof Playground> | undefined} */ (undefined));
  let picker = $state(/** @type {HTMLInputElement | undefined} */ (undefined));
  /** The folder the files picked to upload go in. */
  let uploadTo = ROOT;

  /** What another tab did to the file open under its unsaved changes, if anything. */
  const conflict = $derived(open ? project.scripts.conflicts.get(open.path) : undefined);

  onMount(() => {
    channel = new BroadcastChannel(CHANNEL);
    channel.addEventListener('message', (event) => void heard(event.data));
    void begin();
    return () => {
      channel?.close();
      project.dispose();
    };
  });

  /**
   * A workspace's project over its files.
   * @param {ReturnType<typeof opfsFiles>} spaceFiles
   */
  function projectOf(spaceFiles) {
    return new Project(
      ROOT,
      {
        readDir: (path) => spaceFiles.readDir(path),
        read: (path) => spaceFiles.read(path),
        exists: (path) => spaceFiles.exists(path),
        write: (path, text) => kept(spaceFiles.write(path, text)),
        writeBytes: (path, bytes) => kept(spaceFiles.write(path, bytes)),
        mkdir: (path) => kept(spaceFiles.mkdir(path)),
        rename: (from, to) => kept(spaceFiles.rename(from, to)),
        remove: (path) => spaceFiles.remove(path).then(storageChanged),
      },
      {
        onproblem: (text) => (problem = text),
        onsave: (path) => void save(path),
        saveAfterMs: () => SAVE_MS,
      },
    );
  }

  /** The workspace the page opens first: the one its URL names, else the one open last, else the default. */
  function firstWorkspace() {
    const last = settings.get(KEYS.workspace);
    return workspaceOfHash(location.hash) ?? (typeof last === 'string' ? last : DEFAULT_WORKSPACE);
  }

  /** The file the workspace open had open last, by its path, or null. */
  function lastOpen() {
    const all = settings.get(KEYS.open);
    const path =
      typeof all === 'object' && all !== null
        ? /** @type {Record<string, unknown>} */ (all)[workspace]
        : undefined;
    return typeof path === 'string' ? path : null;
  }

  /**
   * Keeps `path` as the file the workspace `name` has open (null: none).
   * @param {string | null} path
   */
  function keepOpen(path, name = workspace) {
    const all = settings.get(KEYS.open);
    /** @type {Record<string, unknown>} */
    const byWorkspace = typeof all === 'object' && all !== null ? { ...all } : {};
    if (path === null) delete byWorkspace[name];
    else byWorkspace[name] = path;
    settings.set(KEYS.open, byWorkspace);
  }

  /**
   * Runs `task`, a change of the workspaces, once those asked before it are done: the
   * workspaces ask nothing meanwhile (`busy`). Each task says its own failure.
   * @param {() => Promise<void>} task
   */
  function serially(task) {
    const run = queue.then(async () => {
      busy = true;
      try {
        await task();
      } finally {
        busy = false;
      }
    });
    queue = run.catch(() => {});
    return run;
  }

  /** Lists the workspaces again; whether they were (else it says so). */
  async function relist() {
    try {
      workspaceNames = await spaces.list();
      return true;
    } catch (error) {
      problem = `The workspaces weren't listed: ${errorText(error)}`;
      return false;
    }
  }

  /**
   * Tells the other tabs of a change to the workspaces.
   * @param {Change} change
   */
  const announce = (change) => channel?.postMessage(change);

  /** Shows the workspace open in the page's URL, in place of what it showed (no step in the history). */
  function showInHash() {
    const hash = hashOf(workspace);
    if (location.hash !== hash) history.replaceState(history.state, '', hash);
  }

  /**
   * Lists the workspaces, then opens the one the URL names, else the one open last (the default
   * where it's gone).
   */
  function begin() {
    return serially(async () => {
      if (!(await relist())) return;
      if (!workspaceNames.includes(workspace)) leaveFor(DEFAULT_WORKSPACE);
      showInHash();
      await start();
    });
  }

  /**
   * Leaves the workspace open for `name`'s, nothing of it shown yet (`start` shows it): its
   * project dropped, with what was being opened and read of it.
   * @param {string} name
   */
  function leaveFor(name) {
    project.dispose();
    opening += 1;
    open = null;
    files = {};
    imported.clear();
    workspace = name;
    settings.set(KEYS.workspace, name);
    showInHash();
    fs = opfsFiles(spaces.folder(name));
    project = projectOf(fs);
  }

  /**
   * Saves all of the workspace open, its editor's file as it is: whether it all was (else what
   * would be done to it isn't, which says so).
   */
  async function savedFirst() {
    keepEditor();
    await saveAll();
    if (project.scripts.unsaved.size === 0) return true;
    problem = `Not all of “${workspace}” was saved, so it stays as it is.`;
    return false;
  }

  /**
   * Opens the workspace `name`, the one open saved first (where it can't be, it stays open, and
   * the URL says so again).
   * @param {string} name
   */
  async function openWorkspace(name) {
    if (name !== workspace && (await savedFirst())) {
      leaveFor(name);
      await start();
    }
    showInHash();
  }

  /** Opens another workspace, the one picked. @param {string} name */
  const switchWorkspace = (name) => serially(() => openWorkspace(name));

  /** The URL names another workspace (the person changed it): it opens, where there is one. */
  function hashChanged() {
    const name = workspaceOfHash(location.hash);
    if (name !== null && name !== workspace && !workspaceNames.includes(name)) {
      problem = `There is no workspace “${name}”.`;
    }
    if (name !== null && workspaceNames.includes(name)) void switchWorkspace(name);
    else showInHash();
  }

  /**
   * Makes a workspace with `make` and opens it.
   * @param {() => Promise<string>} make what makes it, saying the name it has
   * @param {string} failed what is said where it fails
   */
  const made = (make, failed) =>
    serially(async () => {
      let name;
      try {
        name = await make();
      } catch (error) {
        problem = `${failed}: ${errorText(error)}`;
        return;
      }
      announce({ kind: 'made', name });
      if (await relist()) await openWorkspace(name);
    });

  /** Makes a workspace, empty, and opens it. @param {string} name */
  const createWorkspace = (name) => made(() => spaces.create(name), "The workspace wasn't made");

  /**
   * Makes the workspace `to` a copy of `from` (the one open, saved first), and opens it on the
   * file `from` has open.
   * @param {string} from
   * @param {string} to
   */
  const duplicateWorkspace = (from, to) =>
    made(async () => {
      if (!(await savedFirst())) throw new Error('Not all of it was saved.');
      const copy = await spaces.duplicate(from, to);
      keepOpen(lastOpen(), copy);
      return copy;
    }, `The workspace “${from}” wasn't duplicated`);

  /**
   * Makes the workspace `name` of the zip `file`'s files, and opens it.
   * @param {File} file
   * @param {string} name
   */
  const importWorkspace = (file, name) =>
    made(async () => {
      if (file.size > MAX_ZIP_BYTES) {
        throw new Error(`It is larger than ${MAX_ZIP_BYTES / 1024 / 1024} MB.`);
      }
      return spaces.fromZip(name, new Uint8Array(await file.arrayBuffer()));
    }, `${file.name} wasn't imported`);

  /**
   * Deletes the workspace `name` (the one open) with its files, and opens the default.
   * @param {string} name
   */
  const removeWorkspace = (name) =>
    serially(async () => {
      if (name === DEFAULT_WORKSPACE) return;
      leaveFor(DEFAULT_WORKSPACE);
      try {
        await spaces.remove(name);
        keepOpen(null, name);
        announce({ kind: 'deleted', name });
      } catch (error) {
        problem = `The workspace “${name}” wasn't deleted: ${errorText(error)}`;
      }
      await relist();
      await start();
    });

  /**
   * Renames the workspace `from` (the one open, saved first) to `to`, and opens it again by its
   * new name, on the file it had open.
   * @param {string} from
   * @param {string} to
   */
  const renameWorkspace = (from, to) =>
    serially(async () => {
      if (!(await savedFirst())) return;
      let renamed;
      try {
        renamed = await spaces.rename(from, to);
      } catch (error) {
        problem = `The workspace “${from}” wasn't renamed: ${errorText(error)}`;
        return;
      }
      if (renamed === from) return;
      announce({ kind: 'renamed', from, to: renamed });
      await followRename(renamed);
    });

  /**
   * Opens the workspace open again by its new name, `to`, on the file it had open, which is kept
   * as its own; what wasn't saved yet (renamed in another tab) is saved in it.
   * @param {string} to
   */
  async function followRename(to) {
    const unsaved = [...project.scripts.unsaved].map((path) => [path, project.scripts.text(path)]);
    const last = lastOpen();
    keepOpen(null);
    keepOpen(last, to);
    leaveFor(to);
    try {
      for (const [path, text] of unsaved) await fs.write(path, text);
    } catch (error) {
      problem = `Not all of “${to}” was saved: ${errorText(error)}`;
    }
    await relist();
    await start();
  }

  /**
   * Another tab changed the workspaces: they are listed again, and the one open follows a
   * change to it (deleted: the default opened; renamed: opened by its new name; its files
   * changed: read again).
   * @param {Change} change
   */
  const heard = (change) =>
    serially(async () => {
      if (change.kind === 'files') {
        if (change.name === workspace) await refreshProject();
        return;
      }
      if (!(await relist())) return;
      if (change.kind === 'renamed' && change.from === workspace) {
        await followRename(change.to);
      } else if (!workspaceNames.includes(workspace)) {
        problem = `The workspace “${workspace}” was deleted in another tab.`;
        leaveFor(DEFAULT_WORKSPACE);
        await start();
      }
    });

  /**
   * Saves the workspace `name` (the one open, saved first) to the person's downloads, as a zip.
   * @param {string} name
   */
  const downloadWorkspace = (name) =>
    serially(async () => {
      try {
        if (await savedFirst()) download(await spaces.toZip(name), `${name}.zip`);
      } catch (error) {
        problem = `The workspace “${name}” wasn't downloaded: ${errorText(error)}`;
      }
    });

  /**
   * Opens the workspace's project, and the file open last (else its main script, else its
   * first). The default is given the starter, as an example, while it is empty (the first time,
   * or everything deleted); another starts as it was made, empty.
   */
  async function start() {
    try {
      const empty = (await fs.readDir(ROOT)).length === 0;
      if (empty && workspace === DEFAULT_WORKSPACE) await writeExample();
    } catch (error) {
      problem = `The project wasn't opened: ${errorText(error)}`;
      return;
    }
    await listNow();
    storageChanged();
    const opened = project.entries.filter((entry) => languageOf(entry.name) !== null);
    const at = (/** @type {string | null} */ path) => opened.find((entry) => entry.path === path);
    const first =
      at(lastOpen()) ?? at(MAIN_SCRIPT) ?? opened.find((entry) => entry.kind === 'script');
    if (first) await openScript(first);
  }

  /** Writes the starter in the workspace open: the example. */
  async function writeExample() {
    for (const [path, text] of Object.entries(STARTER)) {
      await fs.mkdir(parentOf(path));
      await fs.write(path, text);
    }
  }

  /** Gives the workspace open, empty, the example, and opens its main script. */
  const addExample = () =>
    serially(async () => {
      try {
        await kept(writeExample());
      } catch (error) {
        problem = `The example wasn't added: ${errorText(error)}`;
      }
      await start();
    });

  /**
   * Says what the origin's storage holds again, a moment after it changed (once for the changes
   * of that moment: a browser's estimate isn't free).
   */
  function storageChanged() {
    if (storageTimer !== undefined) return;
    storageTimer = setTimeout(async () => {
      storageTimer = undefined;
      storage = await storageUse();
    }, STORAGE_MS);
  }

  /** Asks the browser, once, to keep the project when it frees space (as it may a site's storage it isn't told to keep). */
  function keep() {
    if (asked) return;
    asked = true;
    navigator.storage.persist?.().catch(() => {});
  }

  /**
   * Lists the project again, and reads the files the script open may import: where they changed
   * (one made, renamed, deleted, uploaded, or another tab's), the script runs again on them.
   */
  async function listNow() {
    await project.list();
    const path = open?.path;
    if (path === undefined) return;
    try {
      const imports = await importsOf(path);
      if (open?.path !== path || sameFiles(imports, files)) return;
      files = imports;
      playground?.run();
    } catch (error) {
      problem = `The files weren't read: ${errorText(error)}`;
    }
  }

  /**
   * What the script at `path` may import, read: a script's text as it is held (saved or not), a
   * data file's bytes; a file as it was when read last isn't read again.
   * @param {string} path
   */
  async function importsOf(path) {
    const found = importable(project.entries, path);
    for (const read of imported.keys()) {
      if (!found.some(({ entry }) => entry.path === read)) imported.delete(read);
    }
    const contents = await Promise.all(
      found.map(async ({ entry }) => {
        if (project.scripts.has(entry.path)) return project.scripts.text(entry.path);
        const { size, lastModified } = await fs.stat(entry.path);
        const stamp = `${size}:${lastModified}`;
        const read = imported.get(entry.path);
        if (read?.stamp === stamp) return read.content;
        const content =
          entry.kind === 'script' ? await fs.read(entry.path) : await fs.readBytes(entry.path);
        imported.set(entry.path, { stamp, content });
        return content;
      }),
    );
    return Object.fromEntries(found.map(({ name }, i) => [name, contents[i]]));
  }

  /**
   * Opens a script, or a JSON file, in the playground, as a document of its own, the folders it
   * is in open.
   * @param {Entry} entry
   */
  async function openScript(entry) {
    if (open?.path === entry.path) return;
    const mine = ++opening;
    let text;
    let imports;
    try {
      text = await project.scripts.read(entry.path);
      imports = await importsOf(entry.path);
    } catch (error) {
      if (mine === opening) problem = `${entry.name} wasn't opened: ${errorText(error)}`;
      return;
    }
    if (mine !== opening) return;
    keepEditor();
    open = entry;
    files = imports;
    project.reveal(entry.path);
    keepOpen(entry.path);
    show(text);
  }

  /**
   * Shows `text` as the file open's, in the playground: a document of its own, with the undo
   * history kept for it, run where it is a script.
   * @param {string} text
   */
  function show(text) {
    if (!open) return;
    shown = text;
    playground?.open(text, project.scripts.snapshot(open.path), languageOf(open.name) ?? 'kupcad');
  }

  /** Keeps the editor of the file open as it is, its undo history with it, for its return. */
  function keepEditor() {
    const snapshot = playground?.snapshot();
    if (open && snapshot) project.scripts.keep(open.path, snapshot);
  }

  function closeScript() {
    open = null;
    files = {};
    keepOpen(null);
  }

  /** @param {string} text the file open, as the person edited it */
  function edited(text) {
    if (!open) return;
    shown = text;
    project.edit(open.path, text);
  }

  /**
   * Saves a file; where another tab changed it since, the change is held for the person to
   * choose (above the editor) and nothing is written.
   * @param {string} path
   */
  async function save(path) {
    project.saving(path);
    try {
      await project.scripts.save(path);
    } catch (error) {
      problem = `${nameOf(path)} wasn't saved: ${errorText(error)}`;
    }
  }

  const saveAll = () => Promise.all([...project.scripts.unsaved].map(save));

  /**
   * The person's choice for the script open, which another tab changed under their changes:
   * that tab's (for one it deleted, the script closed), or theirs, saved over it.
   * @param {'disk' | 'mine'} choice
   */
  function resolveConflict(choice) {
    if (!open) return;
    const { path } = open;
    project.scripts.resolve(path, choice);
    if (!project.scripts.has(path)) closeScript();
    else if (choice === 'mine') void save(path);
    else {
      keepEditor();
      show(project.scripts.text(path));
    }
  }

  /**
   * Reads the workspaces and the project again, as another tab may have changed them: the
   * workspace open, deleted there, is left for the default.
   */
  async function readAgain() {
    if (busy) return;
    if (!(await relist())) return;
    if (!workspaceNames.includes(workspace)) {
      await heard({ kind: 'deleted', name: workspace });
      return;
    }
    await refreshProject();
  }

  /**
   * Reads the project again: the script open takes a change to it where it has nothing unsaved,
   * and is closed where it was deleted.
   */
  async function refreshProject() {
    try {
      const dropped = await project.scripts.check();
      if (open && dropped.includes(open.path)) {
        problem = `${open.name} was deleted in another tab.`;
        closeScript();
      } else if (
        open &&
        project.scripts.has(open.path) &&
        project.scripts.text(open.path) !== shown
      ) {
        keepEditor();
        show(project.scripts.text(open.path));
      }
    } catch (error) {
      problem = `The scripts weren't read again: ${errorText(error)}`;
    }
    await listNow();
  }

  /**
   * Makes the name given in the tree an entry (the project's `commitName`): a script made is
   * opened, to be written; the file open, renamed or in a folder renamed, stays open by its new
   * path.
   * @param {string} given
   */
  async function commitName(given) {
    const done = await project.commitName(given);
    if (!done) return;
    if ('made' in done) {
      if (done.made.kind !== 'script') return;
      await openScript(done.made);
      await tick();
      playground?.focus();
    } else if (open && within(open.path, done.renamed.from)) {
      const path = done.renamed.to + open.path.slice(done.renamed.from.length);
      open = { ...open, path, name: nameOf(path) };
      keepOpen(path);
    }
  }

  /**
   * Deletes an entry, once the person says so; the file open, in it, is closed.
   * @param {Entry} entry
   */
  async function removeEntry(entry) {
    const what =
      entry.kind === 'folder'
        ? `the folder “${entry.name}” and everything in it`
        : `“${entry.name}”`;
    const answer = await ask({
      title: `Delete ${what}?`,
      text: "It can't be undone.",
      answers: [
        { text: 'Cancel', value: 'cancel', primary: true },
        { text: 'Delete', value: 'delete' },
      ],
      cancel: 'cancel',
    });
    if (answer !== 'delete') return;
    if (!(await project.remove(entry))) return;
    if (open && within(open.path, entry.path)) closeScript();
    await listNow();
  }

  /** Asks the person for files to put in `dir`. @param {string} dir */
  function upload(dir) {
    uploadTo = dir;
    picker?.click();
  }

  /** @param {Event & { currentTarget: HTMLInputElement }} event the files picked to upload */
  async function uploaded(event) {
    const picked = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    await addFiles(picked, uploadTo);
  }

  /**
   * Puts files the person gave (dropped on the tree, picked to upload) in the folder `dir` (the
   * project's `addFiles`, asking about a name it has); a script replaced is read again.
   * @param {File[]} given
   * @param {string} dir
   */
  async function addFiles(given, dir) {
    const put = await project.addFiles(
      given,
      dir,
      (name, renamed, folder) =>
        /** @type {Promise<Clash>} */ (ask(clashQuestion(name, renamed, folder))),
    );
    if (put.length > 0) await readAgain();
  }

  /**
   * Asks the person, in a dialog.
   * @param {Omit<NonNullable<typeof question>, 'answer'>} asking
   * @returns {Promise<string>} the answer given
   */
  function ask(asking) {
    return new Promise((answer) => (question = { ...asking, answer }));
  }

  /**
   * Saves a file to the person's downloads: a script as it is in the editor.
   * @param {Entry} entry
   */
  async function downloadEntry(entry) {
    try {
      const data = project.scripts.has(entry.path)
        ? new Blob([project.scripts.text(entry.path)], { type: 'text/plain' })
        : await fs.readBytes(entry.path);
      download(data, entry.name);
    } catch (error) {
      problem = `${entry.name} wasn't downloaded: ${errorText(error)}`;
    }
  }

  /**
   * The menu of a row of the tree, or of the tree itself (null).
   * @param {Entry | null} entry
   * @returns {MenuItem[]}
   */
  function menuOf(entry) {
    const items = rowMenu(entry, {
      newScript: () => project.startNew('script', project.folderFor(entry, open?.path)),
      newFolder: () => project.startNew('folder', project.folderFor(entry, open?.path)),
      rename: () => entry && project.startRename(entry),
      remove: () => entry && void removeEntry(entry),
      upload: () => upload(project.folderFor(entry, open?.path)),
      download: () => entry && void downloadEntry(entry),
    });
    if (!entry) return items;
    // Taken to another workspace: the IDE's own, after what @kupcad/files' menu has
    return [
      ...items,
      '-',
      { text: 'Copy to workspace…', action: () => (transferring = { entry, move: false }) },
      { text: 'Move to workspace…', action: () => (transferring = { entry, move: true }) },
    ];
  }

  /**
   * The person said where the file or folder being copied (or moved) goes: the dialog dropped,
   * then it is.
   * @param {string} name
   * @param {string} dir
   */
  function transferTo(name, dir) {
    if (!transferring) return;
    const { entry, move } = transferring;
    transferring = null;
    void transferEntry(entry, move, name, dir);
  }

  /**
   * Copies (or moves) `entry` into the folder `dir` of the workspace `name`, the one open saved
   * first: a name the folder has is asked about, as an upload's is. That workspace's tabs are
   * told; moved, the file open, in it, is closed.
   * @param {Entry} entry
   * @param {boolean} move
   * @param {string} name
   * @param {string} dir
   */
  const transferEntry = (entry, move, name, dir) =>
    serially(async () => {
      if (!(await savedFirst())) return;
      const where = dir === ROOT ? `“${name}”` : `“${nameOf(dir)}” of “${name}”`;
      try {
        const put = await transfer({
          from: fs,
          path: entry.path,
          folder: entry.kind === 'folder',
          to: opfsFiles(spaces.folder(name)),
          dir,
          move,
          clash: (given, renamed) =>
            /** @type {Promise<Clash>} */ (ask(clashQuestion(given, renamed, where))),
        });
        if (put === null) return;
        announce({ kind: 'files', name });
      } catch (error) {
        problem = `${entry.name} wasn't ${move ? 'moved' : 'copied'}: ${errorText(error)}`;
      }
      if (move) {
        if (open && within(open.path, entry.path)) closeScript();
        await refreshProject();
      }
      storageChanged();
    });

  /**
   * What drops the menu `opened` once it closes, unless another opened in its place meanwhile.
   * @param {typeof menu} opened
   */
  const closer = (opened) => () => {
    if (menu === opened) menu = null;
  };

  /** @param {KeyboardEvent} event */
  function keydown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      void saveAll();
    }
  }

  /** The page closing on a script not saved yet: it is, and the person is asked to wait. @param {BeforeUnloadEvent} event */
  function beforeunload(event) {
    if (project.scripts.unsaved.size === 0) return;
    event.preventDefault();
    void saveAll();
  }
</script>

<svelte:window
  onkeydown={keydown}
  onfocus={() => void readAgain()}
  onhashchange={hashChanged}
  onbeforeunload={beforeunload}
  ondragover={refuseStrayDrop}
  ondrop={refuseStrayDrop}
/>
<svelte:document
  onvisibilitychange={() => {
    if (document.visibilityState === 'hidden') void saveAll();
  }}
/>

<div class="ide" style:--files-width="{filesWidth}px">
  <nav class="side" aria-label="Files">
    <Workspaces
      names={workspaceNames}
      current={workspace}
      {busy}
      onswitch={(name) => void switchWorkspace(name)}
      oncreate={(name) => void createWorkspace(name)}
      onremove={(name) => void removeWorkspace(name)}
      onrename={(from, to) => void renameWorkspace(from, to)}
      onduplicate={(from, to) => void duplicateWorkspace(from, to)}
      ondownload={(name) => void downloadWorkspace(name)}
      onimport={(file, name) => void importWorkspace(file, name)}
      measure={(name) => spaces.size(name)}
    />
    <div class="tree">
      <FileTree
        entries={project.entries}
        collapsed={project.collapsed}
        selected={open?.path ?? null}
        unsaved={project.scripts.unsaved}
        root={ROOT}
        editing={project.editing}
        problem={project.nameError}
        onopen={(entry) => void openScript(entry)}
        opens={(entry) => languageOf(entry.name) === 'json'}
        ontoggle={(entry, opening) => project.toggle(entry.path, opening)}
        oncommit={(given) => void commitName(given)}
        oncancel={() => project.cancelNaming()}
        onmenu={(entry, at) => (menu = { entry, at })}
        onrename={(entry) => project.startRename(entry)}
        ontrash={(entry) => void removeEntry(entry)}
        onnew={(kind) => project.startNew(kind, project.folderFor(null, open?.path))}
        ondropfiles={(dropped, dir) => void addFiles(dropped, dir)}
      />
    </div>
    {#if problem}
      <p class="problem" role="alert">
        <span>{problem}</span>
        <button type="button" aria-label="Dismiss" onclick={() => (problem = '')}>×</button>
      </p>
    {:else if storage}
      <p class="storage">
        {storage.used}{#if storage.mayClear}<br /><span title={MAY_CLEAR}
            >May be cleared if space runs low</span
          >{/if}
      </p>
    {/if}
  </nav>
  <Splitter
    bind:size={filesWidth}
    min={160}
    max={480}
    label="Resize the files"
    onchange={(size) => settings.set(KEYS.files, size)}
  />
  <main class="work">
    {#if open && conflict !== undefined}
      <ConflictBar name={open.name} {conflict} where="in another tab" onresolve={resolveConflict} />
    {/if}
    <div class="playground" inert={!open}>
      <Playground
        bind:this={playground}
        name={open ? stemOf(open.name) : 'model'}
        {files}
        {settings}
        onsource={edited}
      />
    </div>
    {#if !open && !busy}
      {#if project.entries.length > 0}
        <p class="none">Open a script from the files.</p>
      {:else}
        <div class="none">
          <div class="empty" role="group" aria-labelledby="empty-workspace">
            <p id="empty-workspace">This workspace is empty.</p>
            <div class="actions">
              <button
                type="button"
                class="kc-control kc-primary"
                onclick={() => project.startNew('script', ROOT)}>New script</button
              >
              <button type="button" class="kc-control" onclick={() => upload(ROOT)}
                >Upload files…</button
              >
              <button type="button" class="kc-control" onclick={() => void addExample()}
                >Add the example</button
              >
            </div>
          </div>
        </div>
      {/if}
    {/if}
  </main>
</div>
{#if menu}
  {#key menu}
    <ContextMenu
      items={menuOf(menu.entry)}
      at={menu.at}
      label={menu.entry?.name ?? 'Files'}
      onclose={closer(menu)}
    />
  {/key}
{/if}
{#if transferring}
  <TransferDialog
    title="{transferring.move ? 'Move' : 'Copy'} “{transferring.entry.name}” to another workspace"
    action={transferring.move ? 'Move' : 'Copy'}
    workspaces={workspaceNames}
    current={workspace}
    folder={parentOf(transferring.entry.path)}
    ontransfer={transferTo}
    oncancel={() => (transferring = null)}
  />
{/if}
{#if question}
  {#key question}
    <AskDialog
      title={question.title}
      text={question.text}
      answers={question.answers}
      cancel={question.cancel}
      onanswer={(value) => {
        question?.answer(value);
        question = null;
      }}
    />
  {/key}
{/if}
<input bind:this={picker} type="file" multiple accept={ACCEPT} hidden onchange={uploaded} />

<style>
  .ide {
    display: flex;
    height: 100%;
    min-height: 0;
    font-family: var(--kc-font);
    font-size: var(--kc-font-size);
    color: var(--kc-fg);
    background: var(--kc-bg);
  }
  .side {
    flex: none;
    display: flex;
    flex-direction: column;
    width: var(--files-width);
    min-width: 0;
    border-right: 1px solid var(--kc-border);
  }
  .tree {
    flex: 1;
    min-height: 0;
  }
  .storage,
  .problem {
    margin: 0;
    padding: 6px 12px;
    font-size: 12px;
    border-top: 1px solid var(--kc-border);
  }
  .storage {
    color: var(--kc-muted);
  }
  .problem {
    display: flex;
    align-items: start;
    gap: 6px;
    color: var(--kc-error);
  }
  .problem button {
    flex: none;
    margin-left: auto;
    padding: 0 4px;
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
  }
  .work {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .playground {
    flex: 1;
    min-height: 0;
  }
  /* No script open: the playground under a word on what to do (in an empty workspace, buttons) */
  .none {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    padding: 2em;
    text-align: center;
    color: var(--kc-muted);
    background: var(--kc-bg);
  }
  .empty p {
    margin: 0 0 12px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--kc-gap);
  }
  /* Narrow, the files over the playground, a few rows of them, nothing to resize between */
  @media (max-width: 800px) {
    .ide {
      flex-direction: column;
    }
    .side {
      width: auto;
      height: 12rem;
      border-right: none;
      border-bottom: 1px solid var(--kc-border);
    }
    .ide > :global(.kc-splitter) {
      display: none;
    }
  }
</style>
