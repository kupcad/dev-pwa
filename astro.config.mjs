// @ts-check
import svelte from '@astrojs/svelte';
import { defineConfig } from 'astro/config';
import { serviceWorker } from './integrations/service-worker.js';

// https://astro.build/config
export default defineConfig({
  site: 'https://kupcad.dev',
  // The IDE is Svelte (@kupcad/files, @kupcad/playground); the service worker, written once the
  // site is built, keeps all of it for offline use
  integrations: [svelte(), serviceWorker()],
});
