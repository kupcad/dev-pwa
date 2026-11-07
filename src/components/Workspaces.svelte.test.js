import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Workspaces from './Workspaces.svelte';

afterEach(() => document.body.replaceChildren());

/**
 * The workspaces' bar, Shelf open (or the one given), its callbacks mocked.
 * @param {string} [current]
 */
function bar(current = 'Shelf') {
  const props = {
    names: ['Default', 'Shelf', 'Shelf copy'],
    current,
    onswitch: vi.fn(),
    oncreate: vi.fn(),
    onremove: vi.fn(),
    onrename: vi.fn(),
    onduplicate: vi.fn(),
    ondownload: vi.fn(),
    onimport: vi.fn(),
    measure: vi.fn(async () => ({ files: 3, bytes: 2100 })),
  };
  render(Workspaces, { props });
  return props;
}

/** The items of the workspace open's menu, opened. */
async function menuItems() {
  await fireEvent.click(screen.getByRole('button', { name: 'Workspace actions' }));
  return within(screen.getByRole('menu')).getAllByRole('menuitem');
}

/** Chooses `text` from the workspace open's menu. @param {string} text */
async function choose(text) {
  const item = (await menuItems()).find((each) => each.textContent?.trim() === text);
  if (!item) throw new Error(`No ${text} in the menu`);
  await fireEvent.click(item);
}

const nameField = () =>
  /** @type {HTMLInputElement} */ (screen.getByRole('textbox', { name: 'Name' }));

describe('the workspaces’ bar', () => {
  it("has New workspace… on top, the list, and the one open's menu", async () => {
    bar();
    expect(screen.getByRole('button', { name: 'New workspace…' })).toBeTruthy();
    expect(
      /** @type {HTMLSelectElement} */ (screen.getByRole('combobox', { name: 'Workspace' })).value,
    ).toBe('Shelf');
    expect((await menuItems()).map((item) => item.textContent?.trim())).toEqual([
      'Rename…',
      'Duplicate…',
      'Download .zip',
      'Import .zip…',
      'Delete…',
    ]);
  });

  it('offers no Rename… or Delete… of the default', async () => {
    bar('Default');
    expect((await menuItems()).map((item) => item.textContent?.trim())).toEqual([
      'Duplicate…',
      'Download .zip',
      'Import .zip…',
    ]);
  });

  it('makes a workspace of a name it takes, Create disabled until then', async () => {
    const { oncreate } = bar();
    await fireEvent.click(screen.getByRole('button', { name: 'New workspace…' }));
    const create = /** @type {HTMLButtonElement} */ (
      screen.getByRole('button', { name: 'Create' })
    );
    expect(create.disabled).toBe(true);
    await fireEvent.input(nameField(), { target: { value: 'SHELF' } });
    expect(screen.getByText('There is a workspace “SHELF” already.')).toBeTruthy();
    expect(create.disabled).toBe(true);
    await fireEvent.input(nameField(), { target: { value: 'Bins' } });
    await fireEvent.click(create);
    expect(oncreate.mock.calls).toEqual([['Bins']]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('makes none on Cancel', async () => {
    const { oncreate } = bar();
    await fireEvent.click(screen.getByRole('button', { name: 'New workspace…' }));
    await fireEvent.input(nameField(), { target: { value: 'Bins' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(oncreate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renames the one open, its name prefilled, which it may keep in another case', async () => {
    const { onrename } = bar();
    await choose('Rename…');
    expect(screen.getByRole('dialog', { name: 'Rename workspace' })).toBeTruthy();
    expect(nameField().value).toBe('Shelf');
    await fireEvent.input(nameField(), { target: { value: 'shelf copy' } });
    expect(screen.getByText('There is a workspace “shelf copy” already.')).toBeTruthy();
    await fireEvent.input(nameField(), { target: { value: 'SHELF' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onrename.mock.calls).toEqual([['Shelf', 'SHELF']]);
  });

  it('duplicates the one open, named "<name> copy" made new', async () => {
    const { onduplicate } = bar();
    await choose('Duplicate…');
    expect(nameField().value).toBe('Shelf copy 2');
    await fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(onduplicate.mock.calls).toEqual([['Shelf', 'Shelf copy 2']]);
  });

  it('deletes the one open once asked, saying what is lost; Cancel deletes nothing', async () => {
    const { onremove, measure } = bar();
    await choose('Delete…');
    const asked = screen.getByRole('dialog', { name: 'Delete the workspace “Shelf”?' });
    expect(measure).toHaveBeenCalledWith('Shelf');
    await waitFor(() =>
      expect(asked.textContent).toContain('All its files are deleted with it: 3 files, 2.1 KB.'),
    );
    await fireEvent.click(within(asked).getByRole('button', { name: 'Cancel' }));
    expect(onremove).not.toHaveBeenCalled();
    await choose('Delete…');
    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onremove.mock.calls).toEqual([['Shelf']]);
  });

  it('shows the one open in the list until it is another: a switch refused leaves it', async () => {
    const { onswitch } = bar();
    const select = /** @type {HTMLSelectElement} */ (
      screen.getByRole('combobox', { name: 'Workspace' })
    );
    await fireEvent.change(select, { target: { value: 'Default' } });
    expect(onswitch.mock.calls).toEqual([['Default']]);
    expect(select.value).toBe('Shelf');
  });

  it('downloads the one open, and imports a zip picked, named after it', async () => {
    const { ondownload, onimport } = bar();
    await choose('Download .zip');
    expect(ondownload.mock.calls).toEqual([['Shelf']]);
    const picker = /** @type {HTMLInputElement} */ (screen.getByLabelText('Import .zip'));
    const zip = new File([new Uint8Array([80, 75])], 'Shelf.zip', { type: 'application/zip' });
    await fireEvent.change(picker, { target: { files: [zip] } });
    expect(screen.getByRole('dialog', { name: 'Import workspace' })).toBeTruthy();
    expect(nameField().value).toBe('Shelf 2');
    await fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onimport.mock.calls).toEqual([[zip, 'Shelf 2']]);
  });
});
