import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_MS, checkForUpdates, offerUpdates } from './updates.js';

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

/**
 * A page in front, its registration just made, and how the page goes to the back or the front.
 * @param {() => Promise<void>} [update] what looking does
 */
function openPage(update = async () => {}) {
  const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  // Looks counted by hand: a spy (vi.fn) handles the promise it returns, and so would hide a
  // failed look the page left unhandled
  let looks = 0;
  const registration = {
    update: () => {
      looks += 1;
      return update();
    },
  };
  checkForUpdates(/** @type {any} */ (registration), /** @type {any} */ (page));
  /** @param {'visible' | 'hidden'} state */
  const turn = (state) => {
    page.visibilityState = state;
    page.dispatchEvent(new Event('visibilitychange'));
  };
  return { looks: () => looks, turn };
}

describe('looking for a newer build while the page stays open', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('looks every hour the page stays in front', () => {
    const { looks } = openPage();
    vi.advanceTimersByTime(CHECK_MS - 1);
    expect(looks()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(looks()).toBe(1);
    vi.advanceTimersByTime(CHECK_MS);
    expect(looks()).toBe(2);
  });

  it('looks as the page comes back to the front an hour or more after the last look', () => {
    const { looks, turn } = openPage();
    turn('hidden');
    // In the back, the hour passes without a look
    vi.advanceTimersByTime(3 * CHECK_MS);
    expect(looks()).toBe(0);
    turn('visible');
    expect(looks()).toBe(1);
    turn('hidden');
    turn('visible');
    expect(looks()).toBe(1);
  });

  it('looks no sooner than an hour after registering, which looked', () => {
    const { looks, turn } = openPage();
    vi.advanceTimersByTime(CHECK_MS / 2);
    turn('hidden');
    turn('visible');
    expect(looks()).toBe(0);
  });

  it('says nothing of a look that fails (offline), and looks again the next hour', async () => {
    const { looks } = openPage(() => Promise.reject(new TypeError('Failed to fetch')));
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    await vi.advanceTimersByTimeAsync(CHECK_MS);
    expect(looks()).toBe(2);
  });
});
