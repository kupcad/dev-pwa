<!--
  @component
  The workspaces, above the files: New workspace… on a row of its own, then the one open, picked
  from the list, and its menu (⋯, @kupcad/files' ContextMenu): Rename…, Duplicate…, Download .zip,
  Import .zip… (a zip picked becomes a new workspace) and Delete…. A name is asked in a dialog
  (NameDialog, refused as workspaces.js refuses one; a rename may keep its own name, in another
  case too); deleting asks first (@kupcad/files' AskDialog), saying what is lost (its files
  counted as it asks). The last workspace can't
  be deleted: its Delete… is greyed out.
-->
<script>
  import { AskDialog, ContextMenu } from '@kupcad/files';
  import { uniqueWorkspaceName } from '../lib/workspaces.js';
  import { stemOf } from '../lib/project.js';
  import { formatBytes } from '../lib/storage.js';
  import NameDialog from './NameDialog.svelte';

  /** @import { MenuItem } from '@kupcad/files' */

  /**
   * @typedef {object} Props
   * @property {string[]} names the workspaces, in alphabetical order
   * @property {string} current the one open
   * @property {boolean} [busy] one being opened, made or deleted: nothing else is asked meanwhile
   * @property {(name: string) => void} onswitch the person picked another
   * @property {(name: string) => void} oncreate the person named a new one (trimmed, refused by none)
   * @property {(name: string) => void} onremove the person confirmed deleting the one open
   * @property {(from: string, to: string) => void} onrename the person renamed the one open
   * @property {(from: string, to: string) => void} onduplicate the person named a copy of the one
   *   open
   * @property {(name: string) => void} ondownload the person asked for the one open as a zip
   * @property {(name: string) => Promise<{ files: number, bytes: number }>} measure how many
   *   files the workspace `name` has, and their bytes: what deleting it loses
   * @property {(file: File, name: string) => void} onimport the person picked a zip to import,
   *   and named the workspace it makes
   */

  /** @type {Props} */
  let {
    names,
    current,
    busy = false,
    onswitch,
    oncreate,
    onremove,
    onrename,
    onduplicate,
    ondownload,
    onimport,
    measure,
  } = $props();

  /**
   * The name asked: what for, the name it starts with, the names it may not be where not all the
   * workspaces' (a rename may keep its own), and what is done with the one given.
   * @type {{ title: string, action: string, value: string, taken?: string[], done: (name: string) => void } | null}
   */
  let naming = $state.raw(null);
  /** Whether deleting the one open is being asked. */
  let deleting = $state(false);
  /** What deleting it loses, once counted (`…` until then; empty where it couldn't be). */
  let lost = $state('');
  /** The menu shown, where it opened. */
  let menu = $state.raw(/** @type {{ x: number, y: number } | null} */ (null));
  let picker = $state(/** @type {HTMLInputElement | undefined} */ (undefined));

  /** The menu of the one open: Delete… greyed out while it is the last (it can't be deleted). */
  const items = $derived.by(() => {
    /** @type {MenuItem[]} */
    const all = [
      { text: 'Rename…', action: startRename },
      { text: 'Duplicate…', action: startDuplicate },
      { text: 'Download .zip', action: () => ondownload(current) },
      { text: 'Import .zip…', action: () => picker?.click() },
      '-',
      { text: 'Delete…', action: startDelete, enabled: names.length > 1 },
    ];
    return all;
  });

  async function startDelete() {
    const name = current;
    lost = '…';
    deleting = true;
    try {
      const { files, bytes } = await measure(name);
      if (current === name)
        lost = `${files} ${files === 1 ? 'file' : 'files'}, ${formatBytes(bytes)}`;
    } catch {
      lost = '';
    }
  }

  function startRename() {
    const from = current;
    naming = {
      title: 'Rename workspace',
      action: 'Rename',
      value: from,
      taken: names.filter((name) => name !== from),
      done: (to) => onrename(from, to),
    };
  }

  function startDuplicate() {
    const from = current;
    naming = {
      title: 'Duplicate workspace',
      action: 'Duplicate',
      value: uniqueWorkspaceName(`${from} copy`, names),
      done: (to) => onduplicate(from, to),
    };
  }

  /**
   * What drops the menu `opened` once it closes, unless another opened in its place meanwhile
   * (as the IDE drops a row's).
   * @param {typeof menu} opened
   */
  const closer = (opened) => () => {
    if (menu === opened) menu = null;
  };

  /** @param {MouseEvent & { currentTarget: HTMLButtonElement }} event */
  function openMenu(event) {
    const { left, bottom } = event.currentTarget.getBoundingClientRect();
    menu = { x: left, y: bottom + 2 };
  }

  /** The name asked given: the dialog dropped, then what it was asked for done. @param {string} name */
  function named(name) {
    const done = naming?.done;
    naming = null;
    done?.(name);
  }

  /** @param {Event & { currentTarget: HTMLInputElement }} event the zip picked to import */
  function picked(event) {
    const [file] = event.currentTarget.files ?? [];
    event.currentTarget.value = '';
    if (!file) return;
    naming = {
      title: 'Import workspace',
      action: 'Import',
      value: uniqueWorkspaceName(stemOf(file.name), names),
      done: (name) => onimport(file, name),
    };
  }
</script>

<div class="workspaces">
  <button
    type="button"
    class="kc-control"
    disabled={busy}
    onclick={() =>
      (naming = { title: 'New workspace', action: 'Create', value: '', done: oncreate })}
    >New workspace…</button
  >
  <div class="open">
    <select
      class="kc-control"
      aria-label="Workspace"
      value={current}
      disabled={busy}
      onchange={(event) => {
        const picked = event.currentTarget.value;
        // The list shows the one open until it is another: a switch refused leaves it as it was
        event.currentTarget.value = current;
        onswitch(picked);
      }}
    >
      {#each names as each (each)}
        <option value={each}>{each}</option>
      {/each}
    </select>
    <button
      type="button"
      class="kc-control"
      aria-label="Workspace actions"
      aria-haspopup="menu"
      title="Workspace actions"
      disabled={busy}
      onclick={openMenu}>⋯</button
    >
  </div>
</div>
<input
  bind:this={picker}
  type="file"
  accept=".zip,application/zip"
  hidden
  aria-label="Import .zip"
  onchange={picked}
/>

{#if menu}
  {#key menu}
    <ContextMenu {items} at={menu} label="Workspace “{current}”" onclose={closer(menu)} />
  {/key}
{/if}
{#if naming}
  <NameDialog
    title={naming.title}
    action={naming.action}
    value={naming.value}
    names={naming.taken ?? names}
    onname={named}
    oncancel={() => (naming = null)}
  />
{/if}
{#if deleting}
  <AskDialog
    title="Delete the workspace “{current}”?"
    text="All its files are deleted with it{lost ? `: ${lost}` : ''}. It can’t be undone."
    answers={[
      { text: 'Cancel', value: 'cancel', primary: true },
      { text: 'Delete', value: 'delete' },
    ]}
    cancel="cancel"
    onanswer={(answer) => {
      deleting = false;
      if (answer === 'delete') onremove(current);
    }}
  />
{/if}

<style>
  /* New on a row of its own, then the one open and its menu beside it */
  .workspaces {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--kc-border);
  }
  .open {
    display: flex;
    gap: 4px;
  }
  select {
    flex: 1;
    min-width: 0;
  }
  .open button {
    flex: none;
  }
</style>
