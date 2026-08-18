/**
 * Live contract tests against the real OSRS Wiki prices API.
 *
 * These are NOT part of `npm test` — they need the network and would make the
 * regression suite flaky. Run them with `npm run test:live` when you want to
 * confirm the service still matches the fixtures in tests/helpers/fake-api.js.
 *
 * They assert the *shape* of the payload, never specific prices.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PricesApi, DEFAULT_BASE_URL } from '../../src/data/prices-api.js';
import { NATURE_RUNE_ITEM_ID } from '../../src/core/alchemy.js';
import { PRICE_BASIS } from '../../src/data/storage.js';

const TIMEOUT_MS = 30_000;
const ADAMANT_PLATEBODY_ID = 1123;

/** One shared instance so the mapping is fetched once for the whole file. */
const api = new PricesApi();

test('the base URL is the documented endpoint', () => {
  assert.equal(DEFAULT_BASE_URL, 'https://prices.runescape.wiki/api/v1/osrs');
});

test('/mapping returns the fields the app depends on', { timeout: TIMEOUT_MS }, async () => {
  const mapping = await api.getMapping();

  assert.ok(mapping.length > 3000, `expected thousands of items, got ${mapping.length}`);

  for (const entry of mapping.slice(0, 50)) {
    assert.equal(typeof entry.id, 'number');
    assert.equal(typeof entry.name, 'string');
    assert.equal(typeof entry.highAlch, 'number');
    assert.equal(typeof entry.members, 'boolean');
    assert.match(entry.icon, /^https:\/\//);
  }
});

test('a known item still has the expected identity', { timeout: TIMEOUT_MS }, async () => {
  const entry = await api.findByName('Adamant platebody');

  assert.ok(entry, 'Adamant platebody should exist in the mapping');
  assert.equal(entry.id, ADAMANT_PLATEBODY_ID);
  assert.ok(entry.highAlch > 0, 'it should be alchable');
});

test('/latest returns high/low prices for a single id', { timeout: TIMEOUT_MS }, async () => {
  const prices = await api.getLatestPrices([ADAMANT_PLATEBODY_ID]);
  const price = prices.get(ADAMANT_PLATEBODY_ID);

  assert.ok(price, 'a price entry should come back');
  for (const key of ['high', 'low', 'highTime', 'lowTime']) {
    assert.ok(price[key] === null || typeof price[key] === 'number', `${key} should be a number or null`);
  }
});

test('/latest in bulk covers every requested id', { timeout: TIMEOUT_MS }, async () => {
  const ids = [ADAMANT_PLATEBODY_ID, 855, 1359, NATURE_RUNE_ITEM_ID];
  const prices = await api.getLatestPrices(ids);

  for (const id of ids) {
    assert.ok(prices.has(id), `missing price for item ${id}`);
  }
});

test('a snapshot is complete enough to add a row', { timeout: TIMEOUT_MS }, async () => {
  const snapshot = await api.getSnapshot('Adamant platebody', {
    priceBasis: PRICE_BASIS.INSTANT_BUY,
  });

  assert.equal(snapshot.itemId, ADAMANT_PLATEBODY_ID);
  assert.ok(snapshot.highAlch > 0);
  assert.ok(snapshot.buyPrice > 0, 'a traded item should have a usable buy price');
  assert.match(snapshot.icon, /^https:\/\//);
});

test('the nature rune price is fetchable', { timeout: TIMEOUT_MS }, async () => {
  const snapshot = await api.getSnapshot(NATURE_RUNE_ITEM_ID);

  assert.equal(snapshot.name, 'Nature rune');
  assert.ok(snapshot.buyPrice > 0 && snapshot.buyPrice < 100_000, 'a sane rune price');
});

test('icon URLs actually resolve', { timeout: TIMEOUT_MS }, async () => {
  const snapshot = await api.getSnapshot('Adamant platebody');
  const response = await fetch(snapshot.icon, { method: 'GET' });

  assert.equal(response.ok, true, `icon request failed: ${response.status} ${snapshot.icon}`);
  assert.match(response.headers.get('content-type') ?? '', /^image\//);
});

test('an unknown item name resolves to null rather than throwing', { timeout: TIMEOUT_MS }, async () => {
  assert.equal(await api.getSnapshot('Definitely not a real item 12345'), null);
});

test('the auto-refresher updates real items end to end', { timeout: TIMEOUT_MS }, async () => {
  const { AutoRefresher } = await import('../../src/state/auto-refresh.js');
  const { AppStore } = await import('../../src/state/store.js');
  const { createMemoryStorage } = await import('../../src/data/storage.js');

  const store = new AppStore({
    storage: createMemoryStorage(),
    initialState: {
      items: [
        {
          id: 'live-1',
          itemId: ADAMANT_PLATEBODY_ID,
          name: 'Adamant platebody',
          buyPrice: 1,
          // Left empty so the refresh has to fill it in from the mapping.
          alchPrice: 0,
          quantity: 1,
        },
      ],
    },
  });

  const refresher = new AutoRefresher({ store, api });
  const updated = await refresher.poll();

  assert.equal(updated, 1);

  const item = store.getItem('live-1');
  assert.ok(item.buyPrice > 1, 'a real price replaced the placeholder');
  assert.ok(item.alchPrice > 0, 'the missing high alch value was filled from the mapping');
  assert.ok(Date.now() - item.updatedAt < TIMEOUT_MS, 'updatedAt was stamped just now');

  // A second poll must move the buy price only, never the alch value.
  const alchAfterFirst = item.alchPrice;
  store.editItemField('live-1', 'alchPrice', '424242');
  await refresher.poll();

  assert.equal(
    store.getItem('live-1').alchPrice,
    424_242,
    'a real refresh never rewrites the alch value',
  );
  assert.notEqual(alchAfterFirst, 424_242, 'the fixture actually changed it');
});
