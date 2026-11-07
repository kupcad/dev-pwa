<!--
  @component
  The workspaces, above the files: New workspace… on a row of its own (a dialog asking the name,
  refused as workspaces.js refuses one), then the one open, picked from the list, and Delete…
  beside it, which deletes it with all its files once the person confirms it (a dialog too). The
  default can't be deleted.
-->
<script>
  import { DEFAULT_WORKSPACE, MAX_WORKSPACE_NAME, workspaceNameError } from '../lib/workspaces.js';

  /**
   * @typedef {object} Props
   * @property {string[]} names the workspaces, the default first
   * @property {string} current the one open
   * @property {boolean} [busy] one being opened, made or deleted: nothing else is asked meanwhile
   * @property {(name: string) => void} onswitch the person picked another
   * @property {(name: string) => void} oncreate the person named a new one (trimmed, refused by none)
   * @property {(name: string) => void} onremove the person confirmed deleting the one open
   */

  /** @type {Props} */
  let { names, current, busy = false, onswitch, oncreate, onremove } = $props();

  let creating = $state(/** @type {HTMLDialogElement | undefined} */ (undefined));
  let removing = $state(/** @type {HTMLDialogElement | undefined} */ (undefined));
  /** The name being typed for a new workspace. */
  let name = $state('');
  /** Whether the person has tried to make it: until then, an empty name isn't called wrong. */
  let tried = $state(false);
  /** Why the name typed can't be a new workspace's, or null. */
  const nameError = $derived(workspaceNameError(name, names));

  function startCreate() {
    name = '';
    tried = false;
    creating?.showModal();
  }

  /** @param {SubmitEvent} event */
  function create(event) {
    event.preventDefault();
    tried = true;
    if (nameError !== null) return;
    creating?.close();
    oncreate(name.trim());
  }

  /** @param {SubmitEvent} event */
  function remove(event) {
    event.preventDefault();
    removing?.close();
    onremove(current);
  }
</script>

<div class="workspaces">
  <button
    type="button"
    class="kc-control new"
    title="New workspace"
    disabled={busy}
    onclick={startCreate}>New workspace…</button
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
      title={current === DEFAULT_WORKSPACE
        ? 'The default workspace can’t be deleted'
        : `Delete the workspace “${current}”`}
      disabled={busy || current === DEFAULT_WORKSPACE}
      onclick={() => removing?.showModal()}>Delete…</button
    >
  </div>
</div>

<dialog bind:this={creating} aria-labelledby="new-workspace-title">
  <form method="dialog" onsubmit={create}>
    <h2 id="new-workspace-title">New workspace</h2>
    <label>
      Name
      <!-- svelte-ignore a11y_autofocus: the dialog is opened to type this -->
      <input
        class="kc-control"
        bind:value={name}
        autofocus
        maxlength={MAX_WORKSPACE_NAME * 2}
        aria-invalid={tried && nameError !== null}
        aria-describedby="new-workspace-problem"
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    <p id="new-workspace-problem" class="problem" aria-live="polite">
      {tried || name.trim() !== '' ? (nameError ?? '') : ''}
    </p>
    <div class="buttons">
      <button type="button" class="kc-control" onclick={() => creating?.close()}>Cancel</button>
      <button type="submit" class="kc-control kc-primary">Create</button>
    </div>
  </form>
</dialog>

<dialog bind:this={removing} aria-labelledby="delete-workspace-title">
  <form method="dialog" onsubmit={remove}>
    <h2 id="delete-workspace-title">Delete the workspace “{current}”?</h2>
    <p>All its files are deleted with it. It can’t be undone.</p>
    <div class="buttons">
      <!-- svelte-ignore a11y_autofocus: the safe answer is the one a key press takes -->
      <button
        type="button"
        class="kc-control kc-primary"
        autofocus
        onclick={() => removing?.close()}>Cancel</button
      >
      <button type="submit" class="kc-control">Delete</button>
    </div>
  </form>
</dialog>

<style>
  /* New on a row of its own, then the one open and Delete beside it */
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
  /* As @kupcad/files' AskDialog draws its questions */
  dialog {
    width: min(26em, calc(100vw - 32px));
    margin: auto;
    padding: 16px;
    font-family: var(--kc-font);
    font-size: var(--kc-font-size);
    color: var(--kc-fg);
    background: var(--kc-bg);
    border: 1px solid var(--kc-border);
    border-radius: var(--kc-radius);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.25);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.3);
  }
  h2 {
    margin: 0;
    font-size: 1.05em;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  dialog p {
    margin: 8px 0 0;
    color: var(--kc-muted);
    overflow-wrap: anywhere;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 12px;
  }
  .problem {
    min-height: 1.3em;
    font-size: 12px;
  }
  dialog p.problem {
    margin-top: 6px;
    color: var(--kc-error);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--kc-gap);
    margin-top: 16px;
  }
</style>
