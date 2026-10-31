// Writes the app's PNG icons (public/icons/) from its SVG one (public/icon.svg, the website's),
// drawn by Playwright's Chromium at each size: the icon as it is (192 and 512 pixels, for the
// manifest), a maskable one with room around the mark for the shape a system cuts it to (all of
// it within the middle 80%), and the home screen icon iOS takes. Run `npm run icons` after
// changing public/icon.svg, and commit what changes.

import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const PUBLIC = new URL('../public/', import.meta.url);
/** The icon's own background, which a padded one is drawn on too. */
const BACKGROUND = '#e0501c';
/** How much of a maskable icon the mark takes: within the circle a mask may keep. */
const MASKABLE_SCALE = 0.8;

/** Each icon: its file, its size in pixels, how much of it the mark takes. */
const ICONS = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  { file: 'maskable-512.png', size: 512, scale: MASKABLE_SCALE },
  { file: 'apple-touch-icon.png', size: 180, scale: 1 },
];

const svg = await readFile(new URL('icon.svg', PUBLIC), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const { file, size, scale } of ICONS) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html>
      <body style="margin: 0; display: grid; place-items: center; height: 100vh; background: ${BACKGROUND}">
        <div style="width: ${scale * 100}%; height: ${scale * 100}%">${svg}</div>
        <style>svg { display: block; width: 100%; height: 100%; }</style>
      </body>`);
    await page.screenshot({ path: fileURLToPath(new URL(`icons/${file}`, PUBLIC)) });
    console.log(`public/icons/${file}: ${size}×${size}`);
  }
} finally {
  await browser.close();
}
