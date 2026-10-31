# KupCAD IDE (kupcad.dev)

KupCAD in the browser, with a project of files: the tree of [`@kupcad/files`] beside
[`@kupcad/playground`] (the editor, the model, its parameters and exports, on the core compiled
to WebAssembly in a worker). The project is kept in the browser's private file system (OPFS), the
app works offline, and a browser can install it (a PWA). An Astro site of one page.

## How it works

* **The project** (`src/lib/opfs.js`): a folder (`project`) of the origin's private file system,
  made the first time with a starter (`src/lib/project.js`: `main.kup` importing
  `parts/tray.kup`). The tree makes scripts and folders (its bar, a row's menu), renames and
  deletes them, uploads files into a folder (Upload Files…: scripts and the files scripts read)
  and downloads a file (Download), each from a row's right-click menu (`@kupcad/files`'
  `ContextMenu`). A rename is a copy, then a removal: no rename is in every browser's OPFS. The
  first write asks the browser to keep the project when it frees space
  (`navigator.storage.persist()`).
* **A script open** (`src/components/Ide.svelte`): opened in the playground as a document of its
  own, its undo history kept while another is shown, with the files of its folder and the
  folders in it for what it imports, by their paths from the script's folder (as `kupcad` run in
  that folder reads them: `../` reaches nothing). It runs again when those files change. It is
  saved half a second after each change, and at once with ⌘S (Ctrl+S); the page asks before it
  closes on one not saved yet. The page coming back to the front reads the project again:
  another tab's change to a script is taken where this one has none unsaved, and offered above
  the editor where it has (Take theirs, Keep mine).
* **Offline** (`integrations/service-worker.js`, `worker/service-worker.js`): once the site is
  built, an Astro integration writes `dist/sw.js`, the worker's code after the URL of every file
  of the build and their version (a hash of their paths and contents). Installed, the worker
  caches them all and answers each request for one, and any navigation, from the cache. A new
  build is a new worker, which waits until the header's Update says to take over
  (`src/lib/updates.js`), and the page reloads on it.
* **Installable**: `public/manifest.webmanifest`, the icon (`public/icon.svg`, the website's)
  and its PNGs (`public/icons/`, drawn by `npm run icons`, `scripts/make-icons.js`).
* **The header** (`src/components/Header.astro`): the website's frame and font, small, with the
  docs' and the website's links (`src/site.js`).

## Commands

```sh
npm install
npm run dev            # astro dev: the IDE as you change it (no service worker)
npm run build          # dist/, sw.js with it
npm run preview        # dist/ served, the service worker working
npm run check          # astro check, svelte-check, and the worker's own types (worker/tsconfig.json)
npm run fmt            # prettier: what `fmt:check` checks
npm test               # Vitest: OPFS (over a stand-in in memory), the project, the worker's build, updates
npm run test:browser   # Playwright: the site built and driven in Chromium, offline too
npm run icons          # public/icons/ from public/icon.svg
```

Served from `dist/` as static files, over HTTPS (a service worker and OPFS need a secure origin;
localhost is one). Serve `sw.js` with `Cache-Control: no-cache`, so a browser asks for it again
on each visit.

## Packages not yet released

The IDE installs `@kupcad/*` from npm. To try a change in one before it is released, pack it in
the monorepo (`pnpm pack`, in `packages/kupcad-<name>`) and install the tarball here
(`npm install path/to/kupcad-<name>-<version>.tgz`), then put the range back before committing.

[`@kupcad/files`]: https://github.com/kupcad/kupcad/tree/main/packages/kupcad-files
[`@kupcad/playground`]: https://github.com/kupcad/kupcad/tree/main/packages/kupcad-playground
