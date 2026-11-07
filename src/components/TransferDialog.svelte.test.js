import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TransferDialog from './TransferDialog.svelte';

afterEach(() => document.body.replaceChildren());

/**
 * The dialog asking where `/parts/lid.kup` of the workspace Shelf is moved to.
 * @param {string[]} workspaces
 */
function asked(workspaces = ['Default', 'Bins', 'Shelf']) {
  const ontransfer = vi.fn();
  const oncancel = vi.fn();
  render(TransferDialog, {
    props: {
      title: 'Move “lid.kup” to another workspace',
      action: 'Move',
      workspaces,
      current: 'Shelf',
      folder: '/parts',
      ontransfer,
      oncancel,
    },
  });
  return { ontransfer, oncancel, dialog: screen.getByRole('dialog') };
}

describe('where a file goes to another workspace', () => {
  it('offers every workspace but the one open, and the folder it is in here', () => {
    const { dialog } = asked();
    expect(/** @type {HTMLDialogElement} */ (dialog).open).toBe(true);
    const picker = screen.getByRole('combobox', { name: 'Workspace' });
    expect(
      within(picker)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Default', 'Bins']);
    expect(/** @type {HTMLInputElement} */ (screen.getByRole('textbox')).value).toBe('/parts');
  });

  it('gives the workspace picked and the folder typed, as a path', async () => {
    const { ontransfer } = asked();
    await fireEvent.change(screen.getByRole('combobox', { name: 'Workspace' }), {
      target: { value: 'Bins' },
    });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Folder' }), {
      target: { value: 'pieces/lids/' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(ontransfer.mock.calls).toEqual([['Bins', '/pieces/lids']]);
  });

  it('refuses a folder the tree would not take', async () => {
    const { ontransfer } = asked();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Folder' }), {
      target: { value: '../escape' },
    });
    const move = /** @type {HTMLButtonElement} */ (screen.getByRole('button', { name: 'Move' }));
    expect(move.disabled).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Folder' }).getAttribute('aria-invalid')).toBe(
      'true',
    );
    await fireEvent.submit(/** @type {HTMLFormElement} */ (move.form));
    expect(ontransfer).not.toHaveBeenCalled();
  });

  it('says to make another workspace first where there is none', () => {
    asked(['Shelf']);
    expect(screen.getByText('There is no other workspace. Make one first.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move' })).toBeNull();
  });

  it('does nothing on Cancel', async () => {
    const { ontransfer, oncancel, dialog } = asked();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect([oncancel.mock.calls.length, ontransfer.mock.calls]).toEqual([1, []]);
    expect(/** @type {HTMLDialogElement} */ (dialog).open).toBe(false);
  });
});
