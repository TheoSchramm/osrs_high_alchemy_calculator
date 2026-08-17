import test from 'node:test';
import assert from 'node:assert/strict';

import { AppStore } from '../src/state/store.js';
import { createMemoryStorage, PRICE_BASIS, STATE_KEY } from '../src/data/storage.js';
import {
  selectRows,
  selectTotals,
  selectRefreshableIds,
  selectBestRow,
} from '../src/state/selectors.js';
import { SORT_DIRECTIONS } from '../src/core/sorting.js';

function makeStore() {
  return new AppStore({ storage: createMemoryStorage() });
}

test('addItem normalizes and appends', () => {
  const store = makeStore();
  const item = store.addItem({ name: 'Yew longbow', vendor: '300', alch: '768', quantity: '50' });

  assert.equal(store.getState().items.length, 1);
  assert.equal(item.buyPrice, 300, 'v1 field names are accepted');
  assert.equal(item.alchPrice, 768);
  assert.equal(item.quantity, 50);
  assert.ok(item.id);
});

test('subscribers fire on every change and can unsubscribe', () => {
  const store = makeStore();
  let calls = 0;
  const off = store.subscribe(() => {
    calls += 1;
  });

  store.addItem({ name: 'A' });
  store.setRunePrice(150);
  assert.equal(calls, 2);

  off();
  store.addItem({ name: 'B' });
  assert.equal(calls, 2, 'no more notifications after unsubscribing');
});

test('state is replaced, not mutated in place', () => {
  const store = makeStore();
  const before = store.getState();
  store.addItem({ name: 'A' });

  assert.notEqual(store.getState(), before, 'a new state object is produced');
  assert.equal(before.items.length, 0, 'the old snapshot is unchanged');
});

test('editItemField parses what the user typed', () => {
  const store = makeStore();
  const item = store.addItem({ name: 'Rune axe', buyPrice: 100 });

  store.editItemField(item.id, 'buyPrice', '14,000');
  assert.equal(store.getItem(item.id).buyPrice, 14_000);

  store.editItemField(item.id, 'quantity', '2k');
  assert.equal(store.getItem(item.id).quantity, 2000);
});

test('editItemField on a missing id is a no-op', () => {
  const store = makeStore();
  assert.equal(store.editItemField('nope', 'buyPrice', 1), null);
});

test('removeItem removes only the target', () => {
  const store = makeStore();
  const a = store.addItem({ name: 'A' });
  store.addItem({ name: 'B' });

  assert.equal(store.removeItem(a.id), true);
  assert.deepEqual(store.getState().items.map((i) => i.name), ['B']);
  assert.equal(store.removeItem('missing'), false);
});

test('applySnapshot updates prices and stamps the time', () => {
  const store = makeStore();
  const item = store.addItem({ name: 'Adamant platebody', quantity: 40 });

  store.applySnapshot(item.id, {
    itemId: 1123,
    name: 'Adamant platebody',
    highAlch: 9600,
    buyPrice: 4200,
    icon: 'https://example.test/i.png',
  });

  const updated = store.getItem(item.id);
  assert.equal(updated.itemId, 1123);
  assert.equal(updated.alchPrice, 9600);
  assert.equal(updated.buyPrice, 4200);
  assert.equal(updated.quantity, 40);
  assert.ok(updated.updatedAt > 0);
});

test('setRunePrice clamps and setPriceBasis validates', () => {
  const store = makeStore();

  store.setRunePrice('-50');
  assert.equal(store.getState().runePrice, 0);

  store.setRunePrice('1,250');
  assert.equal(store.getState().runePrice, 1250);

  store.setPriceBasis(PRICE_BASIS.INSTANT_SELL);
  assert.equal(store.getState().priceBasis, PRICE_BASIS.INSTANT_SELL);

  store.setPriceBasis('nonsense');
  assert.equal(store.getState().priceBasis, PRICE_BASIS.INSTANT_SELL, 'unchanged');
});

test('toggleSort cycles ascending then descending', () => {
  const store = makeStore();

  store.toggleSort('profit');
  assert.deepEqual(store.getState().sort, { field: 'profit', direction: SORT_DIRECTIONS.ASC });

  store.toggleSort('profit');
  assert.deepEqual(store.getState().sort, { field: 'profit', direction: SORT_DIRECTIONS.DESC });

  store.toggleSort('name');
  assert.deepEqual(store.getState().sort, { field: 'name', direction: SORT_DIRECTIONS.ASC });
});

test('changes persist and reload into a fresh store', () => {
  const storage = createMemoryStorage();

  const first = new AppStore({ storage });
  first.addItem({ name: 'Adamant platebody', buyPrice: 4000, alchPrice: 9600, quantity: 100 });
  first.setRunePrice(180);

  const second = new AppStore({ storage });
  assert.equal(second.getState().items.length, 1);
  assert.equal(second.getState().items[0].name, 'Adamant platebody');
  assert.equal(second.getState().runePrice, 180);
});

test('reset clears both state and storage', () => {
  const storage = createMemoryStorage();
  const store = new AppStore({ storage });
  store.addItem({ name: 'A' });

  store.reset();

  assert.equal(store.getState().items.length, 0);
  assert.equal(new AppStore({ storage }).getState().items.length, 0);
  assert.ok(storage.getItem(STATE_KEY), 'the cleared state is written back');
});

test('a store without storage still works', () => {
  const store = new AppStore();
  store.addItem({ name: 'A' });
  assert.equal(store.getState().items.length, 1);
});

test('selectRows applies the sort and attaches derived figures', () => {
  const store = makeStore();
  store.addItem({ name: 'Yew longbow', buyPrice: 300, alchPrice: 768, quantity: 50 });
  store.addItem({ name: 'Adamant platebody', buyPrice: 4000, alchPrice: 9600, quantity: 100 });
  store.setRunePrice(200);
  store.toggleSort('profit');
  store.toggleSort('profit'); // descending

  const rows = selectRows(store.getState());
  assert.deepEqual(rows.map((r) => r.item.name), ['Adamant platebody', 'Yew longbow']);
  assert.equal(rows[0].derived.profit, 540_000);
});

test('selectTotals aggregates the table', () => {
  const store = makeStore();
  store.setRunePrice(200);
  store.addItem({ name: 'A', buyPrice: 4000, alchPrice: 9600, quantity: 100 });
  store.addItem({ name: 'B', buyPrice: 300, alchPrice: 768, quantity: 50 });

  const totals = selectTotals(store.getState());
  assert.equal(totals.casts, 150);
  assert.equal(totals.profit, 540_000 + 13_400);
  assert.equal(totals.xp, 9750);
});

test('selectRefreshableIds only returns API-known items', () => {
  const store = makeStore();
  store.addItem({ name: 'Known', itemId: 1123 });
  store.addItem({ name: 'Manual' });

  assert.deepEqual(selectRefreshableIds(store.getState()), [1123]);
});

test('selectBestRow finds the top earner, or null when empty', () => {
  const store = makeStore();
  assert.equal(selectBestRow(store.getState()), null);

  store.addItem({ name: 'Meh', buyPrice: 0, alchPrice: 100, quantity: 1 });
  store.addItem({ name: 'Great', buyPrice: 0, alchPrice: 10_000, quantity: 10 });

  assert.equal(selectBestRow(store.getState()).item.name, 'Great');
});
