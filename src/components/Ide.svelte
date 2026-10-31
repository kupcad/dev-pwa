<!--
  @component
  The IDE: a project's files beside the playground, all in the browser. The project is a folder
  of the browser's private file system (opfs.js), made with a starter the first time
  (project.js). Its tree (@kupcad/files) makes scripts and folders (its bar, a row's menu),
  renames and deletes them, uploads the person's files into a folder and downloads one (a row's
  menu, a popover). A script clicked opens in the playground as a document of its own, its undo
  history kept while another is shown, with the files of its folder for what it imports. A
  script is saved a moment after each change (the tree marks it until then), and at once with ⌘S
  (Ctrl+S); the page asks before it closes on one not saved yet. Back in front, the page reads
  the project again: another tab's change to a script is taken where this one has none unsaved,
  and said above the editor where it has. The script open last is opened again.
-->
<script>
  import {
    childPath,
    ContextMenu,
    DATA_EXTENSIONS,
    FileTree,
    foldersAbove,
    kindOf,
    listFolder,
    nameProblem,
    parentOf,
    rowMenu,
    SCRIPT_EXTENSION,
    Scripts,
    scriptName,
    within,
  } from '@kupcad/files';
  import { download, Playground } from '@kupcad/playground';
  import { errorText } from '@kupcad/protocol';
  import { localSettings, sizeSetting, Splitter } from '@kupcad/ui';
  import { onMount, tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { opfsFiles, projectFolder } from '../lib/opfs.js';
  import { importable, MAIN_SCRIPT, sameFiles, STARTER, stemOf } from '../lib/project.js';

  /** @import { Entry, MenuItem } from '@kupcad/files' */

  /** The project's root, in its files' paths. */
  const ROOT = '/';
  /** How long a script changed waits to be saved, in milliseconds. */
  const SAVE_MS = 500;
  /** The settings' keys: the files' width, the script open last. */
  const KEYS = { files: 'ide.files', open: 'ide.open' };
  /** What the upload picker offers: the files a project shows. */
  const ACCEPT = [SCRIPT_EXTENSION, ...DATA_EXTENSIONS].map((extension) => `.${extension}`).join();

  const settings = localSettings();
  // As the settings have it; dragged, the pane's own until the drag is done
  let filesWidth = $derived(sizeSetting(settings, KEYS.files, 224));
  const fs = opfsFiles(projectFolder());
  /** The tree's closed folders, by their paths. */
  const collapsed = new SvelteSet();
  let entries = $state.raw(/** @type {Entry[]} */ ([]));
  /** The script open. */
  let open = $state.raw(/** @type {Entry | null} */ (null));
  /** What the script open may import, by the paths it names them by. */
  let files = $state.raw(/** @type {Record<string, string | Uint8Array>} */ ({}));
  /** The script open as the editor has it: as it was opened, then as the person edits it. */
  let shown = '';
  /** A name being given in the tree, and what is wrong with the last one given. */
  let editing = $state(
    /** @type {{ path: string } | { in: string, kind: 'script' | 'folder' } | null} */ (null),
  );
  let nameError = $state(/** @type {string | null} */ (null));
  /** A name given is being made into an entry: one given again meanwhile is the same. */
  let naming = false;
  /** The menu shown: a row's (or the tree's, of none), where it opened. */
  let menu = $state.raw(
    /** @type {{ entry: Entry | null, at: { x: number, y: number } } | null} */ (null),
  );
  /** What went wrong last, until it is dismissed or something else goes wrong. */
  let problem = $state('');
  /** How many scripts were asked to open: one read after a later one is asked for isn't shown. */
  let opening = 0;
  /** Each script changed that waits to be saved, by its path. */
  const saves = new Map();
  /** Whether the browser was asked to keep the project when it frees space. */
  let kept = false;
  let playground = $state(/** @type {ReturnType<typeof Playground> | undefined} */ (undefined));
  let picker = $state(/** @type {HTMLInputElement | undefined} */ (undefined));
  /** The folder the files picked to upload go in. */
  let uploadTo = ROOT;

  const scripts = new Scripts({
    read: (path) => fs.read(path),
    write: (path, text) => written(fs.write(path, text)),
    exists: (path) => fs.exists(path),
  });
  /** What another tab did to the script open under its unsaved changes, if anything. */
  const conflict = $derived(open ? scripts.conflicts.get(open.path) : undefined);

  const nameOf = (/** @type {string} */ path) => path.split('/').at(-1) ?? path;

  onMount(() => {
    void start();
    return () => {
      for (const timer of saves.values()) clearTimeout(timer);
    };
  });

  /**
   * Opens the project, made with the starter the first time, and the script open last (else its
   * main one, else its first).
   */
  async function start() {
    try {
      if ((await fs.readDir(ROOT)).length === 0) {
        for (const [path, text] of Object.entries(STARTER)) {
          await fs.mkdir(parentOf(path));
          await fs.write(path, text);
        }
      }
    } catch (error) {
      problem = `The project wasn't opened: ${errorText(error)}`;
      return;
    }
    await listNow();
    const scripts = entries.filter((entry) => entry.kind === 'script');
    const scriptAt = (/** @type {unknown} */ path) => scripts.find((entry) => entry.path === path);
    const first = scriptAt(settings.get(KEYS.open)) ?? scriptAt(MAIN_SCRIPT) ?? scripts[0];
    if (first) await openScript(first);
  }

  /**
   * A write of the person's, done: the first asks the browser to keep the project when it frees
   * space (as it may a site's storage it isn't told to keep).
   * @param {Promise<void>} writing
   */
  async function written(writing) {
    await writing;
    if (kept) return;
    kept = true;
    navigator.storage.persist?.().catch(() => {});
  }

  /**
   * Lists the project again, and reads the files the script open may import: where they changed
   * (one made, renamed, deleted, uploaded, or another tab's), the script runs again on them.
   */
  async function listNow() {
    try {
      entries = await listFolder(ROOT, fs);
      const path = open?.path;
      if (path === undefined) return;
      const imports = await importsOf(path);
      if (open?.path !== path || sameFiles(imports, files)) return;
      files = imports;
      playground?.run();
    } catch (error) {
      problem = `The files weren't listed: ${errorText(error)}`;
    }
  }

  /**
   * What the script at `path` may import, read: a script's text as it is held (saved or not), a
   * data file's bytes.
   * @param {string} path
   */
  async function importsOf(path) {
    const found = importable(entries, path);
    const contents = await Promise.all(
      found.map(({ entry }) => {
        if (scripts.has(entry.path)) return scripts.text(entry.path);
        return entry.kind === 'script' ? fs.read(entry.path) : fs.readBytes(entry.path);
      }),
    );
    return Object.fromEntries(found.map(({ name }, i) => [name, contents[i]]));
  }

  /**
   * Opens or closes the tree's folder at `path`.
   * @param {string} path
   * @param {boolean} opening
   */
  function toggle(path, opening) {
    if (opening) collapsed.delete(path);
    else collapsed.add(path);
  }

  /**
   * Opens a script in the playground, as a document of its own, the folders it is in open.
   * @param {Entry} entry
   */
  async function openScript(entry) {
    if (open?.path === entry.path) return;
    const mine = ++opening;
    let text;
    let imports;
    try {
      text = await scripts.read(entry.path);
      imports = await importsOf(entry.path);
    } catch (error) {
      if (mine === opening) problem = `${entry.name} wasn't opened: ${errorText(error)}`;
      return;
    }
    if (mine !== opening) return;
    keepEditor();
    open = entry;
    files = imports;
    shown = text;
    for (const path of foldersAbove(entries, entry.path)) collapsed.delete(path);
    settings.set(KEYS.open, entry.path);
    playground?.open(text, scripts.snapshot(entry.path));
  }

  /** Keeps the editor of the script open as it is, its undo history with it, for its return. */
  function keepEditor() {
    const snapshot = playground?.snapshot();
    if (open && snapshot) scripts.keep(open.path, snapshot);
  }

  function closeScript() {
    open = null;
    files = {};
    settings.set(KEYS.open, null);
  }

  /** @param {string} text the script open, as the person edited it */
  function edited(text) {
    if (!open) return;
    const { path } = open;
    shown = text;
    scripts.edit(path, text);
    clearTimeout(saves.get(path));
    saves.set(
      path,
      setTimeout(() => void save(path), SAVE_MS),
    );
  }

  /**
   * Saves a script; where another tab changed it since, the change is held for the person to
   * choose (above the editor) and nothing is written.
   * @param {string} path
   */
  async function save(path) {
    clearTimeout(saves.get(path));
    saves.delete(path);
    try {
      await scripts.save(path);
    } catch (error) {
      problem = `${nameOf(path)} wasn't saved: ${errorText(error)}`;
    }
  }

  const saveAll = () => Promise.all([...scripts.unsaved].map(save));

  /**
   * The person's choice for the script open, which another tab changed under their changes:
   * that tab's (for one it deleted, the script closed), or theirs, saved over it.
   * @param {'disk' | 'mine'} keep
   */
  function resolveConflict(keep) {
    if (!open) return;
    const { path } = open;
    scripts.resolve(path, keep);
    if (!scripts.has(path)) closeScript();
    else if (keep === 'mine') void save(path);
    else {
      shown = scripts.text(path);
      playground?.load(shown);
    }
  }

  /**
   * Reads the project again, as another tab may have changed it: the script open takes a change
   * to it where it has nothing unsaved, and is closed where it was deleted.
   */
  async function readAgain() {
    try {
      const dropped = await scripts.check();
      if (open && dropped.includes(open.path)) {
        problem = `${open.name} was deleted in another tab.`;
        closeScript();
      } else if (open && scripts.has(open.path) && scripts.text(open.path) !== shown) {
        shown = scripts.text(open.path);
        playground?.load(shown);
      }
    } catch (error) {
      problem = `The scripts weren't read again: ${errorText(error)}`;
    }
    await listNow();
  }

  /**
   * The folder an entry made from `entry`'s menu goes in: a folder's own, the one a file is in;
   * from none (the bar, the tree's own menu), the open script's, else the project's.
   * @param {Entry | null} entry
   */
  function folderFor(entry) {
    if (entry) return entry.kind === 'folder' ? entry.path : parentOf(entry.path);
    return open ? parentOf(open.path) : ROOT;
  }

  /**
   * Starts a new entry's name in the tree, in `entry`'s folder (folderFor), that folder open.
   * @param {'script' | 'folder'} kind
   * @param {Entry | null} [entry]
   */
  function startNew(kind, entry = null) {
    const dir = folderFor(entry);
    collapsed.delete(dir);
    for (const path of foldersAbove(entries, dir)) collapsed.delete(path);
    nameError = null;
    editing = { in: dir, kind };
  }

  /** @param {Entry} entry */
  function startRename(entry) {
    nameError = null;
    editing = { path: entry.path };
  }

  /**
   * Makes the name given in the tree an entry: a new one, or a row's new name. One refused stays
   * in the field, what is wrong with it said under it.
   * @param {string} given
   */
  async function commitName(given) {
    const now = editing;
    if (!now || naming) return;
    const wrong = nameProblem(given);
    if (wrong) {
      nameError = wrong;
      return;
    }
    naming = true;
    try {
      if ('in' in now) await makeEntry(now.in, now.kind, given);
      else await renameEntry(now.path, given);
    } catch (error) {
      nameError = errorText(error);
    } finally {
      naming = false;
    }
  }

  /**
   * Makes a script (empty, opened, the editor focused) or a folder in `dir`.
   * @param {string} dir
   * @param {'script' | 'folder'} kind
   * @param {string} given
   */
  async function makeEntry(dir, kind, given) {
    const named = kind === 'script' ? scriptName(given) : given;
    const path = childPath(dir, named);
    if (await fs.exists(path)) {
      nameError = `${named} is there already.`;
      return;
    }
    await written(kind === 'script' ? fs.write(path, '') : fs.mkdir(path));
    editing = null;
    await listNow();
    const made = entries.find((entry) => entry.path === path);
    if (kind !== 'script' || !made) return;
    await openScript(made);
    await tick();
    playground?.focus();
  }

  /**
   * Renames the entry at `from`, the scripts in it saved first; the script open, in it, stays
   * open by its new path, its undo history with it.
   * @param {string} from
   * @param {string} given
   */
  async function renameEntry(from, given) {
    const kind = entries.find((entry) => entry.path === from)?.kind;
    const named = kind === 'script' ? scriptName(given) : given;
    const to = childPath(parentOf(from), named);
    // OPFS tells names apart by their case: `a.kup` to `A.kup` is to another name
    if (await fs.exists(to)) {
      nameError = `${named} is there already.`;
      return;
    }
    await saveAll();
    keepEditor();
    await written(fs.rename(from, to));
    scripts.rename(from, to);
    // A copy: renaming adds to what is iterated
    for (const path of Array.from(collapsed)) {
      if (!within(path, from)) continue;
      collapsed.delete(path);
      collapsed.add(to + path.slice(from.length));
    }
    if (open && within(open.path, from)) {
      const path = to + open.path.slice(from.length);
      open = { ...open, path, name: nameOf(path) };
      settings.set(KEYS.open, path);
    }
    editing = null;
    await listNow();
  }

  /**
   * Deletes an entry, once the person says so; the script open, in it, is closed.
   * @param {Entry} entry
   */
  async function removeEntry(entry) {
    const what =
      entry.kind === 'folder'
        ? `the folder “${entry.name}” and everything in it`
        : `“${entry.name}”`;
    if (!confirm(`Delete ${what}? This can't be undone.`)) return;
    try {
      await fs.remove(entry.path);
    } catch (error) {
      problem = `${entry.name} wasn't deleted: ${errorText(error)}`;
      return;
    }
    for (const [path, timer] of saves) {
      if (!within(path, entry.path)) continue;
      clearTimeout(timer);
      saves.delete(path);
    }
    scripts.drop(entry.path);
    for (const path of collapsed) if (within(path, entry.path)) collapsed.delete(path);
    if (open && within(open.path, entry.path)) closeScript();
    await listNow();
  }

  /** Asks the person for files to put in `dir`. @param {string} dir */
  function upload(dir) {
    uploadTo = dir;
    picker?.click();
  }

  /**
   * Puts the files picked in their folder, asking before one replaces a file there; those the
   * tree wouldn't show (no script, nor a file a script reads) are refused.
   * @param {Event & { currentTarget: HTMLInputElement }} event
   */
  async function uploaded(event) {
    const picked = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    const dir = uploadTo;
    const refused = picked.filter((file) => nameProblem(file.name) || !kindOf(file.name));
    try {
      for (const file of picked) {
        if (refused.includes(file)) continue;
        const path = childPath(dir, file.name);
        if ((await fs.exists(path)) && !confirm(`Replace “${file.name}”?`)) continue;
        await written(fs.write(path, new Uint8Array(await file.arrayBuffer())));
      }
    } catch (error) {
      problem = `The files weren't uploaded: ${errorText(error)}`;
    }
    if (refused.length > 0) {
      problem = `Not uploaded, being no script or file a script reads: ${refused.map((file) => file.name).join(', ')}`;
    }
    collapsed.delete(dir);
    // A script replaced is read again
    await readAgain();
  }

  /**
   * Saves a file to the person's downloads: a script as it is in the editor.
   * @param {Entry} entry
   */
  async function downloadEntry(entry) {
    try {
      const data = scripts.has(entry.path)
        ? new Blob([scripts.text(entry.path)], { type: 'text/plain' })
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
    return rowMenu(entry, {
      newScript: () => startNew('script', entry),
      newFolder: () => startNew('folder', entry),
      rename: () => entry && startRename(entry),
      remove: () => entry && void removeEntry(entry),
      upload: () => upload(folderFor(entry)),
      download: () => entry && void downloadEntry(entry),
    });
  }

  /**
   * What drops the menu `shown` once it closes, unless another opened in its place meanwhile.
   * @param {typeof menu} shown
   */
  const closer = (shown) => () => {
    if (menu === shown) menu = null;
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
    if (scripts.unsaved.size === 0) return;
    event.preventDefault();
    void saveAll();
  }
</script>

<svelte:window onkeydown={keydown} onfocus={() => void readAgain()} onbeforeunload={beforeunload} />
<svelte:document
  onvisibilitychange={() => {
    if (document.visibilityState === 'hidden') void saveAll();
  }}
/>

<div class="ide" style:--files-width="{filesWidth}px">
  <nav class="side" aria-label="Files">
    <div class="tree">
      <FileTree
        {entries}
        {collapsed}
        selected={open?.path ?? null}
        unsaved={scripts.unsaved}
        root={ROOT}
        {editing}
        problem={nameError}
        onopen={(entry) => void openScript(entry)}
        ontoggle={(entry, opening) => toggle(entry.path, opening)}
        oncommit={(given) => void commitName(given)}
        oncancel={() => (editing = null)}
        onmenu={(entry, at) => (menu = { entry, at })}
        onrename={startRename}
        ontrash={(entry) => void removeEntry(entry)}
        onnew={(kind) => startNew(kind)}
      />
    </div>
    {#if problem}
      <p class="problem" role="alert">
        <span>{problem}</span>
        <button type="button" aria-label="Dismiss" onclick={() => (problem = '')}>×</button>
      </p>
    {:else}
      <p class="kept">Kept in this browser. Download a file to keep a copy of your own.</p>
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
      <div class="conflict" role="alert">
        {#if conflict === null}
          <span>{open.name} was deleted in another tab. Keeping yours saves it again.</span>
          <button type="button" class="kc-control" onclick={() => resolveConflict('disk')}>
            Discard mine
          </button>
        {:else}
          <span>{open.name} changed in another tab.</span>
          <button type="button" class="kc-control" onclick={() => resolveConflict('disk')}>
            Take theirs
          </button>
        {/if}
        <button type="button" class="kc-control" onclick={() => resolveConflict('mine')}>
          Keep mine
        </button>
      </div>
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
    {#if !open}
      <p class="none">Open a script from the files, or make one with New script.</p>
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
  .kept,
  .problem {
    margin: 0;
    padding: 6px 12px;
    font-size: 12px;
    border-top: 1px solid var(--kc-border);
  }
  .kept {
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
  /* No script open: the playground under a word on what to do */
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
  /* What another tab did to the script under its unsaved changes, and the person's choice */
  .conflict {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--kc-gap);
    padding: 6px var(--kc-gap);
    background: var(--kc-accent-subtle);
    border-bottom: 1px solid var(--kc-accent);
  }
  .conflict span {
    flex: 1 1 12em;
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
