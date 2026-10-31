// The service worker (sw.js, which the build writes), registered once the page has loaded, and
// the header's Update button: shown while a newer build, installed beside the one this page
// runs on, waits for it; pressed, the newer one takes over and the page reloads on it.

/** Where the build puts the worker. */
const WORKER_URL = '/sw.js';

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
      .then((registration) => offerUpdates(registration, workers, button, () => location.reload()))
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
