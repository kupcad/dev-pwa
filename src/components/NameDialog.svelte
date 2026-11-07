<!--
  @component
  A workspace's name asked in a modal dialog (a new one's, one imported, renamed or duplicated):
  the name it starts with selected, why the one typed can't be a workspace's said as it is typed
  (as workspaces.js refuses one), and the button that gives it disabled until it can. Escape or
  Cancel closes it with nothing given. Closed either way, it says so (`onname` with the name
  trimmed, or `oncancel`), for the host to drop it, the focus back where it was.
-->
<script>
  import { onMount, untrack } from 'svelte';
  import { MAX_WORKSPACE_NAME, workspaceNameError } from '../lib/workspaces.js';

  /**
   * @typedef {object} Props
   * @property {string} title what it asks
   * @property {string} action what its button says (Create, Rename…)
   * @property {string} [value] the name it starts with
   * @property {string[]} names the workspaces whose names the name may not have
   * @property {(name: string) => void} onname the name given, trimmed
   * @property {() => void} oncancel
   */

  /** @type {Props} */
  let { title, action, value = '', names, onname, oncancel } = $props();

  const id = $props.id();
  /** @type {HTMLDialogElement} */
  let dialog;
  /** @type {HTMLInputElement} */
  let input;
  /** What had the focus when it opened, given it back once closed. */
  let before = /** @type {Element | null} */ (null);
  let closed = false;
  /** The name typed: `value` first, which is read as it opens (the dialog is mounted for each name asked). */
  let name = $state(untrack(() => value));
  /** Whether the person has typed: an empty name isn't called wrong before. */
  let typed = $state(false);
  /** Why the name typed can't be the workspace's, or null. */
  const error = $derived(workspaceNameError(name, names));

  onMount(() => {
    before = document.activeElement;
    dialog.showModal();
    input.select();
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
    if (error !== null) return;
    const given = name.trim();
    close(() => onname(given));
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="{id}-title"
  oncancel={(event) => {
    event.preventDefault();
    close(oncancel);
  }}
>
  <form onsubmit={submit}>
    <h2 id="{id}-title">{title}</h2>
    <label>
      Name
      <input
        bind:this={input}
        bind:value={name}
        class="kc-control"
        maxlength={MAX_WORKSPACE_NAME * 2}
        aria-invalid={typed && error !== null}
        oninput={() => (typed = true)}
        aria-describedby="{id}-problem"
        autocomplete="off"
        spellcheck="false"
      />
    </label>
    <p id="{id}-problem" class="problem" aria-live="polite">{typed ? (error ?? '') : ''}</p>
    <div class="buttons">
      <button type="button" class="kc-control" onclick={() => close(oncancel)}>Cancel</button>
      <button type="submit" class="kc-control kc-primary" disabled={error !== null}>{action}</button
      >
    </div>
  </form>
</dialog>

<style>
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
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 12px;
  }
  .problem {
    min-height: 1.3em;
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--kc-error);
    overflow-wrap: anywhere;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--kc-gap);
    margin-top: 16px;
  }
</style>
