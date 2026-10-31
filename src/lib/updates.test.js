import { describe, expect, it, vi } from 'vitest';
import { offerUpdates } from './updates.js';

/**
 * A page on a registration whose worker may be waiting, its button, and what they did.
 * @param {{ waiting?: boolean, controlled?: boolean }} [state]
 */
function pageOn({ waiting = false, controlled = true } = {}) {
  const worker = Object.assign(new EventTarget(), { postMessage: vi.fn() });
  const registration = Object.assign(new EventTarget(), {
    waiting: waiting ? worker : null,
    installing: /** @type {typeof worker | null} */ (null),
  });
  const workers = Object.assign(new EventTarget(), { controller: controlled ? {} : null });
  const button = Object.assign(new EventTarget(), { hidden: true });
  const reload = vi.fn();
  offerUpdates(
    /** @type {any} */ (registration),
    /** @type {any} */ (workers),
    /** @type {any} */ (button),
    reload,
  );
  return { worker, registration, workers, button, reload };
}

describe("the header's Update", () => {
  it('shows while a newer worker waits, not for the first one installed', () => {
    expect(pageOn({ waiting: true }).button.hidden).toBe(false);
    expect(pageOn({ waiting: true, controlled: false }).button.hidden).toBe(true);
    expect(pageOn().button.hidden).toBe(true);
  });

  it('shows once a newer worker found later is installed', () => {
    const page = pageOn();
    const newer = Object.assign(new EventTarget(), { postMessage: vi.fn() });
    page.registration.installing = newer;
    page.registration.dispatchEvent(new Event('updatefound'));
    expect(page.button.hidden).toBe(true);
    page.registration.waiting = newer;
    newer.dispatchEvent(new Event('statechange'));
    expect(page.button.hidden).toBe(false);
  });

  it('has the newer worker take over when pressed, and reloads the page on it', () => {
    const page = pageOn({ waiting: true });
    page.button.dispatchEvent(new Event('click'));
    expect(page.worker.postMessage).toHaveBeenCalledWith('update');
    expect(page.reload).not.toHaveBeenCalled();
    page.workers.dispatchEvent(new Event('controllerchange'));
    expect(page.reload).toHaveBeenCalledOnce();
  });

  it("doesn't reload a page the first worker takes over", () => {
    const page = pageOn({ controlled: false });
    page.workers.dispatchEvent(new Event('controllerchange'));
    expect(page.reload).not.toHaveBeenCalled();
  });
});
