// The tests of the IDE's own code, on Astro's Vite config, so what they import compiles as the
// site's build compiles it (@kupcad/files' Svelte): its modules in Node (the project's files over
// a stand-in for the browser's private file system, zips, the build's service worker), and its
// components (*.svelte.test.js) mounted under jsdom, as the KupCAD packages test theirs, with
// what jsdom lacks of a browser set up first (src/components/dom.test-helper.js). The IDE in a
// browser is the Playwright suite's (e2e/).
/// <reference types="vitest/config" />
import { svelteTesting } from '@testing-library/svelte/vite';
import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: {
    server: { deps: { inline: [/@kupcad\//] } },
    projects: [
      {
        extends: true,
        test: {
          name: 'modules',
          include: ['src/**/*.test.js', 'integrations/**/*.test.js'],
          exclude: ['src/**/*.svelte.test.js'],
        },
      },
      {
        extends: true,
        plugins: [svelteTesting()],
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['src/**/*.svelte.test.js'],
          setupFiles: ['src/components/dom.test-helper.js'],
        },
      },
    ],
  },
});
