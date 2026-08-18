/**
 * Tests for the polling scheduler.
 *
 * Timers and the clock are injected, so these run instantly and deterministically
 * rather than waiting on real intervals.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { AutoRefresher } from '../src/state/auto-refresh.js';
import { AppStore } from '../src/state/store.js';
import { PricesApi } from '../src/data/prices-api.js';
import { createMemoryStorage, AUTO_REFRESH_OPTIONS } from '../src/data/storage.js';
import { createFakeFetch } from './helpers/fake-api.js';

/**
 * Drain everything the microtask queue has pending. The API chain awaits a
 * mapping fetch and then a price fetch, so a couple of Promise.resolve() ticks
 * is not enough to see a poll through.
 */
const flush = async (times = 5) => {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

/** A controllable stand-in for setTimeout/setInterval. */
function createClock() {
  let now = 0;
  let nextId = 1;
  const scheduled = new Map();

  return {
    now: () => now,
    timers: {
      setTimeout(fn, delay) {
        const id = nextId++;
        scheduled.set(id, { fn, at: now + (delay ?? 0) });
        return id;
      },
      clearTimeout(id) {
        scheduled.delete(id);
      },
    },
    get pending() {
      return scheduled.size;
    },
    /** Advance time, firing anything that comes due. */
    async advance(ms) {
      const target = now + ms;
      let guard = 0;
      for (;;) {
        const due = [...scheduled.entries()]
          .filter(([, task]) => task.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due || (guard += 1) > 100) break;

        const [id, task] = due;
        scheduled.delete(id);
        now = task.at;
        task.fn();
        // Let the async poll settle before looking for the next timer.
        await flush();
      }
      now = target;
    },
  };
}

function setup(options = {}) {
  const store = new AppStore({
    storage: createMemoryStorage(),
    initialState: {
      items: [
        { id: 'a', itemId: 1123, name: 'Adamant platebody', buyPrice: 1, alchPrice: 1, quantity: 1 },
        { id: 'b', itemId: 855, name: 'Yew longbow', buyPrice: 1, alchPrice: 1, quantity: 1 },
      ],
      autoRefreshMs: options.autoRefreshMs ?? 60_000,
      ...options.state,
    },
  });

  const clock = createClock();
  const fetchImpl = options.fetch ?? createFakeFetch();
  const api = new PricesApi({ fetch: fetchImpl });
  const events = [];

  const refresher = new AutoRefresher({
    store,
    api,
    timers: clock.timers,
    now: clock.now,
    isVisible: options.isVisible ?? (() => true),
    onEvent: (event) => events.push(event),
  });

  return { store, clock, api, refresher, events, fetchImpl };
}

test('polls on the configured interval', async () => {
  const { refresher, clock, events } = setup({ autoRefreshMs: 60_000 });
  refresher.start();

  assert.deepEqual(events, [], 'nothing happens before the first interval elapses');

  await clock.advance(60_000);
  assert.equal(events.filter((e) => e.type === 'success').length, 1);

  await clock.advance(60_000);
  assert.equal(events.filter((e) => e.type === 'success').length, 2);
});

test('a poll writes fresh prices and stamps updatedAt', async () => {
  const { refresher, clock, store } = setup();
  refresher.start();
  await clock.advance(60_000);

  const item = store.getItem('a');
  assert.equal(item.buyPrice, 4200, 'the fixture instant-buy price');
  assert.ok(item.updatedAt > 0);
});

test('off means off', async () => {
  const { refresher, clock, events } = setup({ autoRefreshMs: 0 });
  refresher.start();

  assert.equal(clock.pending, 0, 'no timer is scheduled at all');
  await clock.advance(10 * 60_000);
  assert.deepEqual(events, []);
});

test('does not poll while the tab is hidden', async () => {
  let visible = false;
  const { refresher, clock, events } = setup({ isVisible: () => visible });
  refresher.start();

  await clock.advance(60_000);
  assert.deepEqual(events, [], 'a hidden tab stays quiet');

  // Coming back should catch up rather than wait out another full interval.
  visible = true;
  refresher.handleVisibilityChange();
  await flush();

  assert.equal(events.filter((e) => e.type === 'success').length, 1);
});

test('skips polling when nothing is known to the Grand Exchange', async () => {
  const { refresher, clock, events } = setup({
    state: { items: [{ id: 'm', name: 'Hand-entered', buyPrice: 1, alchPrice: 1, quantity: 1 }] },
  });
  refresher.start();

  await clock.advance(60_000);
  assert.deepEqual(events, [], 'no request is worth making');
});

test('a slow poll does not stack up requests', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  const { refresher, clock, events, api } = setup();
  const original = api.getSnapshots.bind(api);
  api.getSnapshots = async (...args) => {
    await gate;
    return original(...args);
  };

  refresher.start();
  await clock.advance(60_000); // first poll starts and blocks
  assert.equal(await refresher.poll(), null, 'a second poll is refused while one is open');

  release();
  await flush();

  assert.ok(events.filter((e) => e.type === 'start').length <= 1);
});

test('a failure is reported and the schedule survives it', async () => {
  let failing = true;
  const fetchImpl = createFakeFetch({
    override: (url) => (failing && url.includes('/latest') ? { status: 503 } : null),
  });

  const { refresher, clock, events } = setup({ fetch: fetchImpl });
  refresher.start();

  await clock.advance(60_000);
  assert.equal(events.filter((e) => e.type === 'error').length, 1);

  failing = false;
  await clock.advance(60_000);
  assert.equal(events.filter((e) => e.type === 'success').length, 1, 'it recovers on its own');
});

test('stop cancels the schedule', async () => {
  const { refresher, clock, events } = setup();
  refresher.start();
  refresher.stop();

  assert.equal(clock.pending, 0);
  await clock.advance(5 * 60_000);
  assert.deepEqual(events, []);
});

test('reschedule picks up a changed interval', async () => {
  const { refresher, clock, store, events } = setup({ autoRefreshMs: 900_000 });
  refresher.start();

  await clock.advance(60_000);
  assert.deepEqual(events, [], 'not due yet on the long interval');

  store.setAutoRefreshMs(60_000);
  refresher.reschedule();

  await clock.advance(60_000);
  assert.equal(events.filter((e) => e.type === 'success').length, 1);
});

test('an item added between polls is included in the next one', async () => {
  const { refresher, clock, store } = setup();
  refresher.start();

  store.addItem({ name: 'Rune axe', itemId: 1359, buyPrice: 1, alchPrice: 1, quantity: 1 });
  await clock.advance(60_000);

  const added = store.getState().items.find((item) => item.itemId === 1359);
  assert.equal(added.buyPrice, 14_000);
});

test('the store only accepts offered intervals', () => {
  const store = new AppStore({ storage: createMemoryStorage() });
  const before = store.getState().autoRefreshMs;

  store.setAutoRefreshMs(1000);
  assert.equal(store.getState().autoRefreshMs, before, 'a one-second poll is refused');

  store.setAutoRefreshMs(900_000);
  assert.equal(store.getState().autoRefreshMs, 900_000);

  for (const option of AUTO_REFRESH_OPTIONS) {
    store.setAutoRefreshMs(option);
    assert.equal(store.getState().autoRefreshMs, option);
  }
});
