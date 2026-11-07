import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NameDialog from './NameDialog.svelte';

afterEach(() => document.body.replaceChildren());

/**
 * The dialog asking a name, starting with `value`, refusing the workspaces Default and Shelf.
 * @param {string} [value]
 */
function asked(value = '') {
  const onname = vi.fn();
  const oncancel = vi.fn();
  render(NameDialog, {
    props: {
      title: 'New workspace',
      action: 'Create',
      value,
      names: ['Default', 'Shelf'],
      onname,
      oncancel,
    },
  });
  const dialog = /** @type {HTMLDialogElement} */ (screen.getByRole('dialog'));
  const input = /** @type {HTMLInputElement} */ (screen.getByRole('textbox', { name: 'Name' }));
  const button = /** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: 'Create' }));
  return { onname, oncancel, dialog, input, button };
}

describe("a workspace's name asked", () => {
  it('is asked in a modal dialog, the name it starts with selected', () => {
    const { dialog, input } = asked('Shelf copy');
    expect(dialog.open).toBe(true);
    expect(screen.getByRole('dialog', { name: 'New workspace' })).toBe(dialog);
    expect(input.value).toBe('Shelf copy');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Shelf copy'.length]);
  });

  it('refuses an empty name without calling it wrong until one is typed', async () => {
    const { input, button, onname } = asked();
    expect(button.disabled).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByText('Give the workspace a name.')).toBeNull();
    await fireEvent.input(input, { target: { value: ' ' } });
    expect(screen.getByText('Give the workspace a name.')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await fireEvent.submit(input.form ?? input);
    expect(onname).not.toHaveBeenCalled();
  });

  it('says why a name is refused, and disables Create, until it is one', async () => {
    const { input, button, onname, dialog } = asked();
    await fireEvent.input(input, { target: { value: 'shelf' } });
    expect(screen.getByText('There is a workspace “shelf” already.')).toBeTruthy();
    expect(button.disabled).toBe(true);
    await fireEvent.input(input, { target: { value: '  Bins ' } });
    expect(button.disabled).toBe(false);
    await fireEvent.click(button);
    expect(onname.mock.calls).toEqual([['Bins']]);
    expect(dialog.open).toBe(false);
  });

  it('gives nothing on Cancel, or on the browser cancelling it (Escape)', async () => {
    const first = asked('Shelf 2');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect([first.oncancel.mock.calls.length, first.onname.mock.calls]).toEqual([1, []]);
    document.body.replaceChildren();
    const second = asked();
    const cancelled = new Event('cancel', { cancelable: true });
    second.dialog.dispatchEvent(cancelled);
    expect([cancelled.defaultPrevented, second.oncancel.mock.calls.length]).toEqual([true, 1]);
  });
});
