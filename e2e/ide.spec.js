import { expect, test } from '@playwright/test';
import { zip } from '../src/lib/zip.js';

/** @import { Page } from '@playwright/test' */

/** A file's text as a zip holds it. @param {string} value */
const encoded = (value) => new TextEncoder().encode(value);
/** How long the core may take to load and run a script: its module compiles on a first visit. */
const RUN_MS = 60_000;

test.setTimeout(120_000);

/** The tree of files. @param {Page} page */
const files = (page) => page.getByRole('navigation', { name: 'Files' });
/** A row of the tree, by its name. @param {Page} page @param {string} name */
const row = (page, name) => files(page).getByRole('button', { name, exact: true });
/** The run's status. @param {Page} page */
const status = (page) => page.getByRole('main').getByRole('status');

/**
 * The page on a new project, its first script run. @param {Page} page
 */
async function opened(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(status(page)).toHaveText(/Ready · \d+ ms/, { timeout: RUN_MS });
  return errors;
}

/**
 * Chooses `item` from the menu of the row of `path` (its tooltip).
 * @param {Page} page
 * @param {string} path
 * @param {string} item
 */
async function choose(page, path, item) {
  await files(page).getByTitle(path, { exact: true }).click({ button: 'right' });
  const name = path.split('/').at(-1);
  await page.getByRole('menu', { name }).getByRole('menuitem', { name: item }).click();
}

test('opens a new project on its starter: the scripts listed, main.kup run with what it imports', async ({
  page,
}) => {
  const errors = await opened(page);
  await expect(row(page, 'parts')).toBeVisible();
  await expect(row(page, 'tray.kup')).toBeVisible();
  await expect(row(page, 'main.kup')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('list', { name: 'Parts' })).toContainText('tray');
  await expect(page.getByRole('spinbutton', { name: 'Width' })).toBeVisible();
  // The header's links, out of the IDE
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: 'Docs' })).toHaveAttribute(
    'href',
    'https://docs.kupcad.org/',
  );
  await expect(header.getByRole('link', { name: 'Website' })).toHaveAttribute(
    'href',
    'https://kupcad.org/',
  );
  expect(errors).toEqual([]);
});

test('makes a script from the bar, saves it as it is written, and opens it again after a reload', async ({
  page,
}) => {
  await opened(page);
  await files(page).getByRole('button', { name: 'New script' }).click();
  await files(page).getByRole('textbox', { name: 'New script name' }).fill('box');
  await page.keyboard.press('Enter');
  await expect(row(page, 'box.kup')).toHaveAttribute('aria-current', 'true');
  // The editor has the focus: the new script is written at once
  await page.keyboard.type('cube(5).named("cube")\n');
  await expect(page.getByRole('list', { name: 'Parts' })).toContainText('cube', {
    timeout: RUN_MS,
  });
  // Saved a moment after: no longer marked unsaved
  await expect(row(page, 'box.kup')).toBeVisible();
  await page.reload();
  await expect(row(page, 'box.kup')).toHaveAttribute('aria-current', 'true', { timeout: RUN_MS });
  await expect(page.locator('.cm-content')).toContainText('cube(5).named("cube")');
});

test("keeps each script's own undo history while another is open", async ({ page }) => {
  await opened(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  // One step of its history (a newline would be another)
  await page.keyboard.type('# mine');
  await row(page, 'tray.kup').click();
  await expect(page.locator('.cm-content')).toContainText('def tray');
  // Nothing of main.kup's to undo here
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.cm-content')).toContainText('def tray');
  await row(page, 'main.kup').click();
  await expect(page.locator('.cm-content')).toContainText('# mine');
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.cm-content')).not.toContainText('# mine');
});

/**
 * Chooses `item` from the menu of the workspace open.
 * @param {Page} page
 * @param {string} item
 */
async function chooseForWorkspace(page, item) {
  await page.getByRole('button', { name: 'Workspace actions' }).click();
  await page
    .getByRole('menu', { name: /^Workspace “/ })
    .getByRole('menuitem', { name: item })
    .click();
}

/** The list of the workspaces, showing the one open. @param {Page} page */
const picker = (page) => page.getByRole('combobox', { name: 'Workspace' });

/**
 * The bytes of a download. @param {import('@playwright/test').Download} download
 */
async function bytesOf(download) {
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test("downloads a file from its row's menu", async ({ page }) => {
  await opened(page);
  const downloading = page.waitForEvent('download');
  await choose(page, '/parts/tray.kup', 'Download');
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('tray.kup');
  expect((await bytesOf(download)).toString()).toContain('export tray');
});

test("renames and deletes from a row's menu, the script open following", async ({ page }) => {
  await opened(page);
  await choose(page, '/main.kup', 'Rename…');
  await files(page).getByRole('textbox', { name: 'Rename main.kup' }).fill('box');
  await page.keyboard.press('Enter');
  await expect(row(page, 'box.kup')).toHaveAttribute('aria-current', 'true');
  await expect(row(page, 'main.kup')).toHaveCount(0);
  await choose(page, '/parts', 'Delete…');
  const asked = page.getByRole('dialog', {
    name: 'Delete the folder “parts” and everything in it?',
  });
  // Cancel is the one focused: Enter deletes nothing
  await expect(asked.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await asked.getByRole('button', { name: 'Delete' }).click();
  await expect(row(page, 'tray.kup')).toHaveCount(0);
  await expect(row(page, 'parts')).toHaveCount(0);
  // box.kup imported what was deleted: its run says so
  await expect(status(page)).toHaveText(/Failed/, { timeout: RUN_MS });
});

test("uploads the person's files into a folder, refusing what no script reads", async ({
  page,
}) => {
  await opened(page);
  const choosing = page.waitForEvent('filechooser');
  await choose(page, '/parts', 'Upload Files…');
  const chooser = await choosing;
  await chooser.setFiles([
    { name: 'sizes.json', mimeType: 'application/json', buffer: Buffer.from('{"w": 3}') },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') },
  ]);
  await expect(files(page).getByText('sizes.json', { exact: true })).toBeVisible();
  await expect(files(page).getByRole('alert')).toContainText('notes.txt');
});

/**
 * Drops `dropped` on the row of `path` (its tooltip), as files dragged from the system's file
 * manager are.
 * @param {Page} page
 * @param {string} path
 * @param {{ name: string, text: string }[]} dropped
 */
async function drop(page, path, dropped) {
  const dataTransfer = await page.evaluateHandle((given) => {
    const transfer = new DataTransfer();
    for (const { name, text } of given) transfer.items.add(new File([text], name));
    return transfer;
  }, dropped);
  const target = files(page).getByTitle(path, { exact: true });
  await target.dispatchEvent('dragover', { dataTransfer });
  await target.dispatchEvent('drop', { dataTransfer });
}

test("takes files dropped from the system's file manager into the folder dropped on", async ({
  page,
}) => {
  await opened(page);
  await drop(page, '/parts', [
    { name: 'lid.kup', text: 'cube(4)\n' },
    { name: 'notes.txt', text: 'notes' },
  ]);
  await expect(files(page).getByTitle('/parts/lid.kup', { exact: true })).toBeVisible();
  await expect(files(page).getByRole('alert')).toContainText('notes.txt');
});

test('asks of a name the folder has: Rename keeps both, Cancel adds none', async ({ page }) => {
  await opened(page);
  await drop(page, '/parts/tray.kup', [{ name: 'tray.kup', text: 'cube(5)\n' }]);
  const asked = page.getByRole('dialog', { name: '“tray.kup” is in parts already' });
  await expect(asked).toContainText('add yours as “tray 2.kup”');
  await expect(asked.getByRole('button', { name: 'Rename' })).toBeFocused();
  await asked.getByRole('button', { name: 'Rename' }).click();
  await expect(files(page).getByTitle('/parts/tray 2.kup', { exact: true })).toBeVisible();
  await drop(page, '/parts', [
    { name: 'cup.kup', text: 'cube(6)\n' },
    { name: 'tray.kup', text: 'cube(7)\n' },
  ]);
  await expect(asked).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(asked).toHaveCount(0);
  await expect(files(page).getByTitle('/parts/cup.kup', { exact: true })).toHaveCount(0);
  // The original was kept as it was
  await row(page, 'tray.kup').click();
  await expect(page.locator('.cm-content')).toContainText('def tray');
});

test('refuses files dropped where nothing takes them, not to open them in place of the IDE', async ({
  page,
}) => {
  await opened(page);
  const refused = await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['cube(1)'], 'a.kup'));
    const over = new DragEvent('dragover', {
      dataTransfer: transfer,
      bubbles: true,
      cancelable: true,
    });
    document.querySelector('header')?.dispatchEvent(over);
    return [over.defaultPrevented, transfer.dropEffect];
  });
  expect(refused).toEqual([true, 'none']);
});

test("opens a package's kupcad.json and kupcad.lock as JSON, edited and saved, nothing run", async ({
  page,
}) => {
  await opened(page);
  await drop(page, '/main.kup', [
    { name: 'kupcad.json', text: '{\n  "name": "trays",\n  "version": "1.0.0"\n}\n' },
    { name: 'kupcad.lock', text: '{\n  "version": "1.0.0",\n  "packages": {}\n}\n' },
  ]);
  await row(page, 'kupcad.lock').click();
  await expect(page.locator('.cm-content')).toContainText('"packages": {}');
  await row(page, 'kupcad.json').click();
  await expect(row(page, 'kupcad.json')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.cm-content')).toContainText('"name": "trays"');
  // Nothing run: no status, no model's parts
  await expect(status(page)).toHaveCount(0);
  // Highlighted as JSON: a key in a colour of its own
  const colours = await page.evaluate(() => {
    const key = [...document.querySelectorAll('.cm-line span')].find(
      (span) => span.textContent === '"name"',
    );
    const line = key?.closest('.cm-line');
    return key && line && [getComputedStyle(key).color, getComputedStyle(line).color];
  });
  expect(colours?.[0]).not.toBe(colours?.[1]);
  // Edited, saved a moment after, and there after a reload
  await page.locator('.cm-content').getByText('trays').dblclick();
  await page.keyboard.type('bins');
  await expect(row(page, 'kupcad.json')).toBeVisible();
  await page.reload();
  await expect(row(page, 'kupcad.json')).toHaveAttribute('aria-current', 'true', {
    timeout: RUN_MS,
  });
  await expect(page.locator('.cm-content')).toContainText('"name": "bins"');
});

test("takes another tab's change to the JSON file open as JSON still, nothing run", async ({
  page,
}) => {
  await opened(page);
  await drop(page, '/main.kup', [{ name: 'kupcad.json', text: '{ "name": "trays" }\n' }]);
  await row(page, 'kupcad.json').click();
  await expect(page.locator('.cm-content')).toContainText('"name": "trays"');
  // Another tab writes it, and this one comes back to the front
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const spaces = await root.getDirectoryHandle('workspaces');
    const project = await spaces.getDirectoryHandle('Default');
    const file = await project.getFileHandle('kupcad.json');
    const writable = await file.createWritable();
    await writable.write('{ "name": "bins" }\n');
    await writable.close();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.cm-content')).toContainText('"name": "bins"');
  await expect(status(page)).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Parts' })).toHaveCount(0);
});

test('keeps each workspace a project of its own: made, switched between, and deleted, the last kept', async ({
  page,
}) => {
  const errors = await opened(page);
  await expect(picker(page)).toHaveValue('Default');
  // The last workspace can't be deleted: its Delete… is greyed out
  await page.getByRole('button', { name: 'Workspace actions' }).click();
  const actions = page.getByRole('menu', { name: 'Workspace “Default”' });
  await expect(actions.getByRole('menuitem', { name: 'Download .zip' })).toBeVisible();
  await expect(actions.getByRole('menuitem', { name: 'Delete…' })).toBeDisabled();
  await page.keyboard.press('Escape');

  // A name the workspaces have, in any case, or none, is refused in the dialog
  await page.getByRole('button', { name: 'New workspace…' }).click();
  const making = page.getByRole('dialog', { name: 'New workspace' });
  await expect(making.getByRole('button', { name: 'Create' })).toBeDisabled();
  await making.getByRole('textbox', { name: 'Name' }).fill('default');
  await expect(making).toContainText('There is a workspace “default” already.');
  await expect(making.getByRole('button', { name: 'Create' })).toBeDisabled();
  await making.getByRole('textbox', { name: 'Name' }).fill('  Shelf ');
  await making.getByRole('button', { name: 'Create' }).click();
  await expect(making).toBeHidden();

  // The new one opens empty: only the first visit's is given the starter
  await expect(picker(page)).toHaveValue('Shelf');
  await expect(row(page, 'main.kup')).toHaveCount(0);
  await files(page).getByRole('button', { name: 'New script' }).click();
  await files(page).getByRole('textbox', { name: 'New script name' }).fill('shelf');
  await page.keyboard.press('Enter');
  await expect(row(page, 'shelf.kup')).toHaveAttribute('aria-current', 'true');
  await page.keyboard.type('cube(3)\n');

  // Default has its own files: none of Shelf's
  await picker(page).selectOption('Default');
  await expect(row(page, 'main.kup')).toHaveAttribute('aria-current', 'true', { timeout: RUN_MS });
  await expect(row(page, 'shelf.kup')).toHaveCount(0);

  // Back in Shelf after a reload, its script open last is open again, as it was written
  await picker(page).selectOption('Shelf');
  await expect(row(page, 'shelf.kup')).toHaveAttribute('aria-current', 'true', {
    timeout: RUN_MS,
  });
  await page.reload();
  await expect(picker(page)).toHaveValue('Shelf', { timeout: RUN_MS });
  await expect(row(page, 'shelf.kup')).toHaveAttribute('aria-current', 'true', {
    timeout: RUN_MS,
  });
  await expect(page.locator('.cm-content')).toContainText('cube(3)');

  // Deleting asks first; Cancel keeps it
  await chooseForWorkspace(page, 'Delete…');
  const deleting = page.getByRole('dialog', { name: 'Delete the workspace “Shelf”?' });
  await deleting.getByRole('button', { name: 'Cancel' }).click();
  await expect(picker(page)).toHaveValue('Shelf');
  await chooseForWorkspace(page, 'Delete…');
  await deleting.getByRole('button', { name: 'Delete' }).click();
  await expect(picker(page)).toHaveValue('Default');
  await expect(picker(page).getByRole('option')).toHaveText(['Default']);
  await expect(row(page, 'main.kup')).toHaveAttribute('aria-current', 'true', { timeout: RUN_MS });
  expect(errors).toEqual([]);
});

/**
 * Makes the workspace `name` from the bar, which opens it, and a script `name.kup` in it with
 * `text` typed in.
 * @param {Page} page
 * @param {string} name
 * @param {string} text
 */
async function newWorkspace(page, name, text) {
  await page.getByRole('button', { name: 'New workspace…' }).click();
  const making = page.getByRole('dialog', { name: 'New workspace' });
  await making.getByRole('textbox', { name: 'Name' }).fill(name);
  await making.getByRole('button', { name: 'Create' }).click();
  await expect(picker(page)).toHaveValue(name);
  await files(page).getByRole('button', { name: 'New script' }).click();
  await files(page).getByRole('textbox', { name: 'New script name' }).fill(name.toLowerCase());
  await page.keyboard.press('Enter');
  await expect(row(page, `${name.toLowerCase()}.kup`)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.type(text);
}

test('renames the workspace open, in its case alone too, and duplicates it, its files with it', async ({
  page,
}) => {
  const errors = await opened(page);
  await newWorkspace(page, 'Shelf', 'cube(3)\n');

  // Renamed with what was typed and not yet saved, the script open still open
  await chooseForWorkspace(page, 'Rename…');
  const renaming = page.getByRole('dialog', { name: 'Rename workspace' });
  const name = renaming.getByRole('textbox', { name: 'Name' });
  await expect(name).toHaveValue('Shelf');
  await name.fill('default');
  await expect(renaming).toContainText('There is a workspace “default” already.');
  await name.fill('Bins');
  await renaming.getByRole('button', { name: 'Rename' }).click();
  await expect(picker(page)).toHaveValue('Bins');
  await expect(picker(page).getByRole('option')).toHaveText(['Bins', 'Default']);
  await expect(row(page, 'shelf.kup')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.cm-content')).toContainText('cube(3)');

  await chooseForWorkspace(page, 'Rename…');
  await name.fill('BINS');
  await renaming.getByRole('button', { name: 'Rename' }).click();
  await expect(picker(page).getByRole('option')).toHaveText(['BINS', 'Default']);

  await chooseForWorkspace(page, 'Duplicate…');
  const duplicating = page.getByRole('dialog', { name: 'Duplicate workspace' });
  await expect(duplicating.getByRole('textbox', { name: 'Name' })).toHaveValue('BINS copy');
  await duplicating.getByRole('button', { name: 'Duplicate' }).click();
  await expect(picker(page)).toHaveValue('BINS copy');
  await expect(picker(page).getByRole('option')).toHaveText(['BINS', 'BINS copy', 'Default']);
  await expect(row(page, 'shelf.kup')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('.cm-content')).toContainText('cube(3)');
  expect(errors).toEqual([]);
});

test('keeps the workspace open in the URL: opened by it, and each tab in its own', async ({
  page,
  context,
}) => {
  const errors = await opened(page);
  await expect(page).toHaveURL(/#w=Default$/);
  await newWorkspace(page, 'Shelf 1', 'cube(3)\n');
  await expect(page).toHaveURL(/#w=Shelf%201$/);
  const steps = await page.evaluate(() => history.length);

  // The person changes the URL: the workspace it names opens, no step added to the history
  await page.evaluate(() => (location.hash = '#w=Default'));
  await expect(picker(page)).toHaveValue('Default');
  await expect(row(page, 'main.kup')).toHaveAttribute('aria-current', 'true', { timeout: RUN_MS });
  await page.evaluate(() => (location.hash = '#w=Nowhere'));
  await expect(files(page).getByRole('alert')).toContainText('There is no workspace “Nowhere”.');
  await expect(page).toHaveURL(/#w=Default$/);
  await picker(page).selectOption('Shelf 1');
  await expect(page).toHaveURL(/#w=Shelf%201$/);
  expect(await page.evaluate(() => history.length)).toBe(steps + 2);

  // Another tab opens the one its URL names, this one keeping its own
  const other = await context.newPage();
  await other.goto('/#w=Default');
  await expect(row(other, 'main.kup')).toHaveAttribute('aria-current', 'true', {
    timeout: RUN_MS,
  });
  await expect(picker(other)).toHaveValue('Default');
  await expect(picker(page)).toHaveValue('Shelf 1');
  // One it doesn't have opens the first in the list, the URL put right
  await other.goto('/#w=Gone');
  await expect(picker(other)).toHaveValue('Default', { timeout: RUN_MS });
  await expect(other).toHaveURL(/#w=Default$/);
  expect(errors).toEqual([]);
});

test("follows another tab's changes to the workspaces at once: made, renamed, deleted", async ({
  page,
  context,
}) => {
  await opened(page);
  const other = await context.newPage();
  await other.goto('/');
  await expect(row(other, 'main.kup')).toHaveAttribute('aria-current', 'true', {
    timeout: RUN_MS,
  });

  await newWorkspace(page, 'Bins', 'cube(4)\n');
  await expect(picker(other).getByRole('option')).toHaveText(['Bins', 'Default']);
  await picker(other).selectOption('Bins');
  await expect(row(other, 'bins.kup')).toHaveAttribute('aria-current', 'true', {
    timeout: RUN_MS,
  });

  await chooseForWorkspace(page, 'Rename…');
  const renaming = page.getByRole('dialog', { name: 'Rename workspace' });
  await renaming.getByRole('textbox', { name: 'Name' }).fill('Crates');
  await renaming.getByRole('button', { name: 'Rename' }).click();
  await expect(picker(other)).toHaveValue('Crates');
  await expect(other).toHaveURL(/#w=Crates$/);
  await expect(row(other, 'bins.kup')).toHaveAttribute('aria-current', 'true', {
    timeout: RUN_MS,
  });

  await chooseForWorkspace(page, 'Delete…');
  await page
    .getByRole('dialog', { name: 'Delete the workspace “Crates”?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(picker(other)).toHaveValue('Default');
  await expect(files(other).getByRole('alert')).toContainText(
    'The workspace “Crates” was deleted in another tab.',
  );

  // Default, renamed, is followed as any other is
  await expect(picker(page)).toHaveValue('Default');
  await chooseForWorkspace(page, 'Rename…');
  await renaming.getByRole('textbox', { name: 'Name' }).fill('Home');
  await renaming.getByRole('button', { name: 'Rename' }).click();
  await expect(picker(other)).toHaveValue('Home');
  await expect(picker(other).getByRole('option')).toHaveText(['Home']);
});

test('offers an empty workspace a script, an upload or the example; deleting says what is lost', async ({
  page,
}) => {
  const errors = await opened(page);
  // What the origin's storage holds, under the files
  await expect(files(page).getByText(/^[\d.]+ \w+ of [\d.]+ \w+ used/)).toBeVisible();
  await page.getByRole('button', { name: 'New workspace…' }).click();
  const making = page.getByRole('dialog', { name: 'New workspace' });
  await making.getByRole('textbox', { name: 'Name' }).fill('Empty');
  await making.getByRole('button', { name: 'Create' }).click();
  const work = page.getByRole('group', { name: 'This workspace is empty.' });
  await expect(work).toBeVisible();

  await work.getByRole('button', { name: 'New script' }).click();
  await expect(files(page).getByRole('textbox', { name: 'New script name' })).toBeFocused();
  await page.keyboard.press('Escape');

  const choosing = page.waitForEvent('filechooser');
  await work.getByRole('button', { name: 'Upload files…' }).click();
  await (
    await choosing
  ).setFiles({ name: 'lid.kup', mimeType: 'text/plain', buffer: Buffer.from('cube(1)\n') });
  await expect(row(page, 'lid.kup')).toBeVisible();
  await expect(page.getByText('Open a script from the files.')).toBeVisible();
  await row(page, 'lid.kup').click();

  await chooseForWorkspace(page, 'Delete…');
  const deleting = page.getByRole('dialog', { name: 'Delete the workspace “Empty”?' });
  await expect(deleting).toContainText('All its files are deleted with it: 1 file, 8 bytes.');
  await deleting.getByRole('button', { name: 'Cancel' }).click();

  await newWorkspace(page, 'Example', '');
  await choose(page, '/example.kup', 'Delete…');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await work.getByRole('button', { name: 'Add the example' }).click();
  await expect(row(page, 'main.kup')).toHaveAttribute('aria-current', 'true', { timeout: RUN_MS });
  await expect(row(page, 'tray.kup')).toBeVisible();
  await expect(status(page)).toHaveText(/Ready · \d+ ms/, { timeout: RUN_MS });
  expect(errors).toEqual([]);
});

test('moves and copies a file to another workspace, a tab with it open seeing it at once', async ({
  page,
  context,
}) => {
  const errors = await opened(page);
  // With no other workspace, a row's menu doesn't offer to take it to one
  await files(page).getByTitle('/main.kup', { exact: true }).click({ button: 'right' });
  const alone = page.getByRole('menu', { name: 'main.kup' });
  await expect(alone.getByRole('menuitem', { name: 'Rename…' })).toBeVisible();
  await expect(alone.getByRole('menuitem', { name: /to workspace/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'New workspace…' }).click();
  const making = page.getByRole('dialog', { name: 'New workspace' });
  await making.getByRole('textbox', { name: 'Name' }).fill('Bins');
  await making.getByRole('button', { name: 'Create' }).click();
  await expect(picker(page)).toHaveValue('Bins');
  await picker(page).selectOption('Default');
  await expect(row(page, 'main.kup')).toHaveAttribute('aria-current', 'true', { timeout: RUN_MS });
  const other = await context.newPage();
  await other.goto('/#w=Bins');
  await expect(picker(other)).toHaveValue('Bins', { timeout: RUN_MS });

  await choose(page, '/parts/tray.kup', 'Move to workspace…');
  const moving = page.getByRole('dialog', { name: 'Move “tray.kup” to another workspace' });
  // Never the workspace open; the folder it is in here, at first
  await expect(moving.getByRole('combobox', { name: 'Workspace' }).getByRole('option')).toHaveText([
    'Bins',
  ]);
  await expect(moving.getByRole('textbox', { name: 'Folder' })).toHaveValue('/parts');
  await moving.getByRole('button', { name: 'Move' }).click();
  await expect(row(page, 'tray.kup')).toHaveCount(0);
  await expect(files(other).getByTitle('/parts/tray.kup', { exact: true })).toBeVisible();

  // Copied twice: the second asks of the name, Rename keeping both
  for (let i = 0; i < 2; i += 1) {
    await choose(page, '/main.kup', 'Copy to workspace…');
    await page
      .getByRole('dialog', { name: 'Copy “main.kup” to another workspace' })
      .getByRole('button', { name: 'Copy' })
      .click();
  }
  const asked = page.getByRole('dialog', { name: '“main.kup” is in “Bins” already' });
  await asked.getByRole('button', { name: 'Rename' }).click();
  await expect(row(other, 'main 2.kup')).toBeVisible();
  await expect(row(other, 'main.kup')).toBeVisible();
  await expect(row(page, 'main.kup')).toHaveAttribute('aria-current', 'true');
  expect(errors).toEqual([]);
});

test('makes Default only on a first visit: renamed, then deleted, it never comes back', async ({
  page,
}) => {
  const errors = await opened(page);
  await chooseForWorkspace(page, 'Rename…');
  const renaming = page.getByRole('dialog', { name: 'Rename workspace' });
  await renaming.getByRole('textbox', { name: 'Name' }).fill('Main');
  await renaming.getByRole('button', { name: 'Rename' }).click();
  await expect(picker(page)).toHaveValue('Main');
  await expect(row(page, 'main.kup')).toHaveAttribute('aria-current', 'true', { timeout: RUN_MS });

  await page.getByRole('button', { name: 'New workspace…' }).click();
  const making = page.getByRole('dialog', { name: 'New workspace' });
  await making.getByRole('textbox', { name: 'Name' }).fill('Other');
  await making.getByRole('button', { name: 'Create' }).click();
  await expect(picker(page)).toHaveValue('Other');
  await picker(page).selectOption('Main');
  await expect(row(page, 'main.kup')).toHaveAttribute('aria-current', 'true', { timeout: RUN_MS });
  await chooseForWorkspace(page, 'Delete…');
  await page
    .getByRole('dialog', { name: 'Delete the workspace “Main”?' })
    .getByRole('button', { name: 'Delete' })
    .click();

  // The one left opens, as it was: empty, no Default made, no starter written
  const empty = page.getByRole('group', { name: 'This workspace is empty.' });
  for (let reloaded = 0; reloaded < 2; reloaded += 1) {
    await expect(picker(page)).toHaveValue('Other', { timeout: RUN_MS });
    await expect(picker(page).getByRole('option')).toHaveText(['Other']);
    await expect(empty).toBeVisible();
    await expect(row(page, 'main.kup')).toHaveCount(0);
    if (reloaded === 0) await page.reload();
  }
  // The last can't be deleted
  await page.getByRole('button', { name: 'Workspace actions' }).click();
  await expect(
    page
      .getByRole('menu', { name: 'Workspace “Other”' })
      .getByRole('menuitem', { name: 'Delete…' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('downloads a workspace as a zip, and imports it as a new one, its name made new', async ({
  page,
}, testInfo) => {
  const errors = await opened(page);
  const downloading = page.waitForEvent('download');
  await chooseForWorkspace(page, 'Download .zip');
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('Default.zip');
  const saved = testInfo.outputPath('Default.zip');
  await download.saveAs(saved);

  const choosing = page.waitForEvent('filechooser');
  await chooseForWorkspace(page, 'Import .zip…');
  await (await choosing).setFiles(saved);
  const importing = page.getByRole('dialog', { name: 'Import workspace' });
  await expect(importing.getByRole('textbox', { name: 'Name' })).toHaveValue('Default 2');
  await importing.getByRole('button', { name: 'Import' }).click();
  await expect(picker(page)).toHaveValue('Default 2');
  await expect(row(page, 'main.kup')).toHaveAttribute('aria-current', 'true', { timeout: RUN_MS });
  await expect(row(page, 'tray.kup')).toBeVisible();
  await expect(status(page)).toHaveText(/Ready · \d+ ms/, { timeout: RUN_MS });
  expect(errors).toEqual([]);
});

test("imports a zip's scripts and data alone, saying how many others it left out", async ({
  page,
}) => {
  const errors = await opened(page);
  const mixed = await zip([
    { path: 'main.kup', data: encoded('cube(4)\n') },
    { path: 'README.md', data: encoded('# Notes\n') },
    { path: '.git/config', data: encoded('') },
  ]);
  const choosing = page.waitForEvent('filechooser');
  await chooseForWorkspace(page, 'Import .zip…');
  await (
    await choosing
  ).setFiles({
    name: 'notes.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await mixed.arrayBuffer()),
  });
  await page
    .getByRole('dialog', { name: 'Import workspace' })
    .getByRole('button', { name: 'Import' })
    .click();
  await expect(picker(page)).toHaveValue('notes');
  await expect(row(page, 'main.kup')).toBeVisible({ timeout: RUN_MS });
  await expect(files(page).getByRole('status')).toContainText(
    "2 files KupCAD doesn't use were left out of notes.zip.",
  );
  expect(errors).toEqual([]);
});

test('refuses a zip with a path out of its folder, making no workspace of it', async ({ page }) => {
  await opened(page);
  const bad = await zip([{ path: '../escape.kup', data: new TextEncoder().encode('cube(1)') }]);
  const choosing = page.waitForEvent('filechooser');
  await chooseForWorkspace(page, 'Import .zip…');
  await (
    await choosing
  ).setFiles({
    name: 'escape.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await bad.arrayBuffer()),
  });
  await page
    .getByRole('dialog', { name: 'Import workspace' })
    .getByRole('button', { name: 'Import' })
    .click();
  await expect(files(page).getByRole('alert')).toContainText('leaves its folder');
  await expect(picker(page).getByRole('option')).toHaveText(['Default']);
  await expect(picker(page)).toHaveValue('Default');
});

test('works offline once it has loaded, the core and all', async ({ page, context }) => {
  await opened(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(status(page)).toHaveText(/Ready · \d+ ms/, { timeout: RUN_MS });
  await expect(row(page, 'main.kup')).toHaveAttribute('aria-current', 'true');
});

test('is an app a browser installs: its manifest and icons', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(href ?? '')).json();
  expect(manifest).toMatchObject({ name: 'KupCAD', start_url: '/', display: 'standalone' });
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect([icon.src, response.status()]).toEqual([icon.src, 200]);
  }
  expect(manifest.icons.map((/** @type {{ purpose?: string }} */ icon) => icon.purpose)).toContain(
    'maskable',
  );
});
