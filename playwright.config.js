// The IDE in a browser, as a visitor gets it: the site built (its service worker with it) and
// served by `astro preview`, driven in Chromium, each test in a browser context of its own (its
// own private file system: a new project).
import { defineConfig, devices } from '@playwright/test';

const PORT = 4329;
const url = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: url,
    // Headless Chromium draws WebGL in software (SwiftShader), which CI's machines need
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  // A server of the run's own, in the foreground: it takes no lock another preview would wait on
  webServer: {
    command: `astro build && astro preview --ignore-lock --host 127.0.0.1 --port ${PORT}`,
    url,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
