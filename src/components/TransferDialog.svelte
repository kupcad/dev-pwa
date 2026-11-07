<!--
  @component
  Where a file or a folder of the workspace open is copied or moved to, asked in a modal dialog:
  another workspace (never the one open), picked from a list, and the folder in it, typed (the
  one it is in here, at first; made where it isn't). A folder the tree wouldn't take is said
  wrong, and the button disabled. With no other workspace, it says to make one first. Escape or
  Cancel closes it with nothing done. Closed either way, it says so (`ontransfer` or `oncancel`),
  for the host to drop it, the focus back where it was.
-->
<script>
  import { onMount, untrack } from 'svelte';
  import './dialog.css';
  import { folderOf } from '../lib/transfer.js';

  /**
   * @typedef {object} Props
   * @property {string} title what it asks
   * @property {string} action what its button says (Copy, Move)
   * @property {string[]} workspaces the workspaces it may go to: all but the one open
   * @property {string} folder the folder it is in, where it goes at first
   * @property {(workspace: string, folder: string) => void} ontransfer the workspace picked, and
   *   the folder typed, as a path from its root
   * @property {() => void} oncancel
   */

  /** @type {Props} */
  let { title, action, workspaces, folder, ontransfer, oncancel } = $props();

  const id = $props.id();
  /** @type {HTMLDialogElement} */
  let dialog;
  /** What had the focus when it opened, given it back once closed. */
  let before = /** @type {Element | null} */ (null);
  let closed = false;
  /** The workspace picked: the first, at first (read as it opens: it is mounted for each one asked). */
  let workspace = $state(untrack(() => workspaces[0] ?? ''));
  /** The folder typed. */
  let typed = $state(untrack(() => folder));
  /** The folder typed, as a path, or null where it can't be one. */
  const target = $derived(folderOf(typed));

  onMount(() => {
    before = document.activeElement;
    dialog.showModal();
  });

  /** Closes it, then says how. @param {() => void} said */
  function close(said) {
    if (closed) return;
    closed = true;
    dialog.close();
    if (before instanceof HTMLElement && before.isConnected) before.focus();
    said();
  }

  /** @param {SubmitEvent} event */
  function submit(event) {
    event.preventDefault();
    if (target === null || workspace === '') return;
    const [to, dir] = [workspace, target];
    close(() => ontransfer(to, dir));
  }
</script>

<dialog
  bind:this={dialog}
  class="ide-dialog"
  aria-labelledby="{id}-title"
  oncancel={(event) => {
    event.preventDefault();
    close(oncancel);
  }}
>
  <form onsubmit={submit}>
    <h2 id="{id}-title">{title}</h2>
    {#if workspaces.length === 0}
      <p>There is no other workspace. Make one first.</p>
    {:else}
      <label>
        Workspace
        <select class="kc-control" bind:value={workspace}>
          {#each workspaces as each (each)}
            <option value={each}>{each}</option>
          {/each}
        </select>
      </label>
      <label>
        Folder
        <input
          class="kc-control"
          bind:value={typed}
          aria-invalid={target === null}
          aria-describedby="{id}-problem"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <p id="{id}-problem" class="problem" aria-live="polite">
        {target === null
          ? 'A folder’s names have no \\ : * ? " < > |, and none starts with a dot.'
          : ''}
      </p>
    {/if}
    <div class="buttons">
      <button type="button" class="kc-control" onclick={() => close(oncancel)}>Cancel</button>
      {#if workspaces.length > 0}
        <button type="submit" class="kc-control kc-primary" disabled={target === null}
          >{action}</button
        >
      {/if}
    </div>
  </form>
</dialog>
