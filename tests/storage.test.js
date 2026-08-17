import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryStorage,
  createDefaultState,
  createJsonCache,
  loadState,
  saveState,
  clearState,
  resolveStorage,
  STATE_KEY,
  LEGACY_ITEMS_KEY,
  LEGACY_RUNE_PRICE_KEY,
  PRICE_BASIS,
} from '../src/data/storage.js';
import { DEFAULT_RUNE_PRICE } from '../src/core/alchemy.js';

test('loadState on empty storage returns the defaults', () => {
  const state = loadState(createMemoryStorage());
  assert.deepEqual(state, createDefaultState());
  assert.equal(state.runePrice, DEFAULT_RUNE_PRICE);
});

test('loadState never yields a NaN rune price', () => {
  // The v1 bug: parseFloat(null) is NaN and `?? 200` does not catch it.
  const cases = [
    createMemoryStorage(),
    createMemoryStorage({ [LEGACY_RUNE_PRICE_KEY]: 'null' }),
    createMemoryStorage({ [STATE_KEY]: JSON.stringify({ runePrice: 'abc' }) }),
    createMemoryStorage({ [STATE_KEY]: JSON.stringify({ runePrice: null }) }),
  ];

  for (const storage of cases) {
    const state = loadState(storage);
    assert.ok(Number.isFinite(state.runePrice), 'rune price must be finite');
    assert.equal(state.runePrice, DEFAULT_RUNE_PRICE);
  }
});

test('save then load round-trips', () => {
  const storage = createMemoryStorage();
  const state = {
    ...createDefaultState(),
    items: [{ id: 'x', name: 'Rune axe', buyPrice: 14_000, alchPrice: 12_480, quantity: 3 }],
    runePrice: 175,
    priceBasis: PRICE_BASIS.INSTANT_SELL,
    sort: { field: 'profit', direction: -1 },
  };

  assert.equal(saveState(storage, state), true);
  const loaded = loadState(storage);

  assert.equal(loaded.items.length, 1);
  assert.equal(loaded.items[0].name, 'Rune axe');
  assert.equal(loaded.items[0].buyPrice, 14_000);
  assert.equal(loaded.runePrice, 175);
  assert.equal(loaded.priceBasis, PRICE_BASIS.INSTANT_SELL);
  assert.deepEqual(loaded.sort, { field: 'profit', direction: -1 });
});

test('loadState migrates a v1 save', () => {
  const storage = createMemoryStorage({
    [LEGACY_ITEMS_KEY]: JSON.stringify([
      { id: 'old-1', name: 'Adamant platebody', vendor: 4000, alch: 9600, quantity: 100 },
      { name: 'Yew longbow', vendor: 300, alch: 768, quantity: 50 },
    ]),
    [LEGACY_RUNE_PRICE_KEY]: '212',
  });

  const state = loadState(storage);

  assert.equal(state.items.length, 2);
  assert.equal(state.items[0].id, 'old-1');
  assert.equal(state.items[0].buyPrice, 4000);
  assert.equal(state.items[0].alchPrice, 9600);
  assert.ok(state.items[1].id, 'items saved without an id get one');
  assert.equal(state.runePrice, 212);
});

test('a v2 save wins over leftover v1 keys', () => {
  const storage = createMemoryStorage({
    [LEGACY_ITEMS_KEY]: JSON.stringify([{ name: 'Old', vendor: 1, alch: 2, quantity: 3 }]),
    [STATE_KEY]: JSON.stringify({ items: [{ name: 'New', buyPrice: 9, alchPrice: 9, quantity: 9 }] }),
  });

  const state = loadState(storage);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].name, 'New');
});

test('loadState survives corrupt JSON', () => {
  const storage = createMemoryStorage({ [STATE_KEY]: '{not json' });
  assert.deepEqual(loadState(storage), createDefaultState());
});

test('loadState rejects an unknown sort field or price basis', () => {
  const storage = createMemoryStorage({
    [STATE_KEY]: JSON.stringify({ sort: { field: 'hacked', direction: 7 }, priceBasis: 'weird' }),
  });
  const state = loadState(storage);
  assert.equal(state.sort.field, null);
  assert.equal(state.priceBasis, PRICE_BASIS.INSTANT_BUY);
});

test('saveState reports failure instead of throwing', () => {
  const hostile = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };
  assert.equal(saveState(hostile, createDefaultState()), false);
});

test('clearState removes v1 and v2 keys', () => {
  const storage = createMemoryStorage({
    [STATE_KEY]: '{}',
    [LEGACY_ITEMS_KEY]: '[]',
    [LEGACY_RUNE_PRICE_KEY]: '200',
  });

  clearState(storage);

  assert.equal(storage.getItem(STATE_KEY), null);
  assert.equal(storage.getItem(LEGACY_ITEMS_KEY), null);
  assert.equal(storage.getItem(LEGACY_RUNE_PRICE_KEY), null);
});

test('resolveStorage falls back when storage throws', () => {
  const broken = {
    getItem: () => null,
    setItem: () => {
      throw new Error('disabled');
    },
    removeItem: () => {},
  };

  const storage = resolveStorage(broken);
  assert.notEqual(storage, broken);
  storage.setItem('k', 'v');
  assert.equal(storage.getItem('k'), 'v');
});

test('resolveStorage keeps a working storage', () => {
  const working = createMemoryStorage();
  assert.equal(resolveStorage(working), working);
});

test('createJsonCache honours its TTL', () => {
  let now = 1000;
  const storage = createMemoryStorage();
  const cache = createJsonCache(storage, { ttlMs: 500, now: () => now });

  cache.set('k', { hello: 'world' });
  assert.deepEqual(cache.get('k'), { hello: 'world' });

  now += 400;
  assert.deepEqual(cache.get('k'), { hello: 'world' }, 'still fresh');

  now += 200;
  assert.equal(cache.get('k'), null, 'expired');
});

test('createJsonCache: misses and deletes', () => {
  const cache = createJsonCache(createMemoryStorage());
  assert.equal(cache.get('missing'), null);

  cache.set('k', [1, 2, 3]);
  cache.delete('k');
  assert.equal(cache.get('k'), null);
});
