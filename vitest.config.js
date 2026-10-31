// The tests of the IDE's own code: the project's files over a stand-in for the browser's private
// file system, and the build's service worker. On Astro's Vite config, so what they import
// compiles as the site's build compiles it (@kupcad/files' Svelte). The IDE in a browser is the
// Playwright suite's (e2e/).
/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    include: ['src/**/*.test.js', 'integrations/**/*.test.js'],
    server: { deps: { inline: [/@kupcad\//] } },
  },
});
