// The service worker (sw.js, which the build writes), registered once the page has loaded, and
// the header's Update button: shown while a newer build, installed beside the one this page
// runs on, waits for it; pressed, the newer one takes over and the page reloads on it. A browser
// looks for a newer build as a page loads; a page left open (an installed app's window, for
// days) looks again as it comes back to the front, and every hour it stays there.

/** Where the build puts the worker. */
const WORKER_URL = '/sw.js';
/** How long a page waits, at the least, between two looks for a newer build, in milliseconds. */
export const CHECK_MS = 60 * 60 * 1000;

/**
 * Registers the service worker once the page has loaded, `button` offering its updates.
 * @param {HTMLButtonElement} button
 * @param {ServiceWorkerContainer | undefined} [workers] none where the browser has none
 */
export function registerWorker(button, workers = navigator.serviceWorker) {
  if (!workers) return;
  const register = () =>
    workers
      .register(WORKER_URL)
      .then((registration) => {
        offerUpdates(registration, workers, button, () => location.reload());
        checkForUpdates(registration);
      })
      .catch((error) => console.warn('KupCAD will not work offline:', error));
  if (document.readyState === 'complete') void register();
  else addEventListener('load', () => void register(), { once: true });
}

/**
 * Shows `button` while a newer worker waits (the first one installed waits for nothing): pressed,
 * that worker takes over, and once it has, the page reloads on it.
 * @param {Pick<ServiceWorkerRegistration, 'waiting' | 'installing' | 'addEventListener'>} registration
 * @param {Pick<ServiceWorkerContainer, 'controller' | 'addEventListener'>} workers
 * @param {Pick<HTMLButtonElement, 'hidden' | 'addEventListener'>} button
 * @param {() => void} reload
 */
export function offerUpdates(registration, workers, button, reload) {
  let updating = false;
  const offer = () => {
    button.hidden = !(registration.waiting && workers.controller);
  };
  offer();
  registration.addEventListener('updatefound', () =>
    registration.installing?.addEventListener('statechange', offer),
  );
  button.addEventListener('click', () => {
    updating = true;
    registration.waiting?.postMessage('update');
  });
  // The first worker takes over a page too (clients.claim): no reason to reload that one
  workers.addEventListener('controllerchange', () => {
    if (updating) reload();
  });
}

/**
 * Looks for a newer worker while the page stays open: as it comes back to the front, and every
 * CHECK_MS while it is there, at most once each CHECK_MS (registering looked a moment ago). One
 * found installs beside this one, and offerUpdates offers it. A look that fails (offline) says
 * nothing: the next one looks again.
 * @param {Pick<ServiceWorkerRegistration, 'update'>} registration
 * @param {Pick<Document, 'visibilityState' | 'addEventListener'>} [page]
 */
export function checkForUpdates(registration, page = document) {
  let looked = Date.now();
  const look = () => {
    if (page.visibilityState !== 'visible' || Date.now() - looked < CHECK_MS) return;
    looked = Date.now();
    registration.update().catch(() => {});
  };
  page.addEventListener('visibilitychange', look);
  setInterval(look, CHECK_MS);
}
