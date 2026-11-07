<!--
  @component
  The workspaces, above the files: New workspace… on a row of its own, then the one open, picked
  from the list, and its menu (⋯, @kupcad/files' ContextMenu): Download .zip, Import .zip… (a
  zip picked becomes a new workspace) and Delete…. A name is asked in a dialog (NameDialog,
  refused as workspaces.js refuses one); deleting asks first (@kupcad/files' AskDialog), saying
  what is lost. The default can't be deleted: its menu has no Delete….
-->
<script>
  import { AskDialog, ContextMenu } from '@kupcad/files';
  import { DEFAULT_WORKSPACE, uniqueWorkspaceName } from '../lib/workspaces.js';
  import { stemOf } from '../lib/project.js';
  import NameDialog from './NameDialog.svelte';

  /** @import { MenuItem } from '@kupcad/files' */

  /**
   * @typedef {object} Props
   * @property {string[]} names the workspaces, the default first
   * @property {string} current the one open
   * @property {boolean} [busy] one being opened, made or deleted: nothing else is asked meanwhile
   * @property {(name: string) => void} onswitch the person picked another
   * @property {(name: string) => void} oncreate the person named a new one (trimmed, refused by none)
   * @property {(name: string) => void} onremove the person confirmed deleting the one open
   * @property {(name: string) => void} ondownload the person asked for the one open as a zip
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
    ondownload,
    onimport,
  } = $props();

  /**
   * The name asked: what for, the name it starts with, and what is done with the one given.
   * @type {{ title: string, action: string, value: string, done: (name: string) => void } | null}
   */
  let naming = $state.raw(null);
  /** Whether deleting the one open is being asked. */
  let deleting = $state(false);
  /** The menu shown, where it opened. */
  let menu = $state.raw(/** @type {{ x: number, y: number } | null} */ (null));
  let picker = $state(/** @type {HTMLInputElement | undefined} */ (undefined));

  /** The menu of the one open: the default's has nothing that would delete it. */
  const items = $derived(
    /** @type {MenuItem[]} */ ([
      { text: 'Download .zip', action: () => ondownload(current) },
      { text: 'Import .zip…', action: () => picker?.click() },
      ...(current === DEFAULT_WORKSPACE
        ? []
        : /** @type {MenuItem[]} */ (['-', { text: 'Delete…', action: () => (deleting = true) }])),
    ]),
  );

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
  <ContextMenu {items} at={menu} label="Workspace “{current}”" onclose={() => (menu = null)} />
{/if}
{#if naming}
  <NameDialog
    title={naming.title}
    action={naming.action}
    value={naming.value}
    {names}
    onname={named}
    oncancel={() => (naming = null)}
  />
{/if}
{#if deleting}
  <AskDialog
    title="Delete the workspace “{current}”?"
    text="All its files are deleted with it. It can’t be undone."
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
