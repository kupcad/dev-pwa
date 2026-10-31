import { expect, test } from '@playwright/test';

/** @import { Page } from '@playwright/test' */

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

test("downloads a file from its row's menu", async ({ page }) => {
  await opened(page);
  const downloading = page.waitForEvent('download');
  await choose(page, '/parts/tray.kup', 'Download');
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('tray.kup');
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString()).toContain('export tray');
});

test("renames and deletes from a row's menu, the script open following", async ({ page }) => {
  await opened(page);
  await choose(page, '/main.kup', 'Rename…');
  await files(page).getByRole('textbox', { name: 'Rename main.kup' }).fill('box');
  await page.keyboard.press('Enter');
  await expect(row(page, 'box.kup')).toHaveAttribute('aria-current', 'true');
  await expect(row(page, 'main.kup')).toHaveCount(0);
  page.once('dialog', (dialog) => void dialog.accept());
  await choose(page, '/parts', 'Delete…');
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
