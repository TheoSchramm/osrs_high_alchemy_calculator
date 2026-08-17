/**
 * End-to-end regression tests for persistence: what a user sees after a reload,
 * and what an existing v1 user sees after upgrading.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { mountApp, rows, rowCells, text, type, click, flush } from './helpers/mount.js';
import {
  createMemoryStorage,
  LEGACY_ITEMS_KEY,
  LEGACY_RUNE_PRICE_KEY,
  STATE_KEY,
  PRICE_BASIS,
} from '../src/data/storage.js';

test('a v1 save renders correctly on first load after upgrading', (t) => {
  const storage = createMemoryStorage({
    [LEGACY_ITEMS_KEY]: JSON.stringify([
      {
        id: 'legacy-plate',
        name: 'Adamant platebody',
        vendor: 4000,
        alch: 9600,
        quantity: 100,
        icon: 'https://static.runelite.net/cache/item/icon/1123.png',
      },
      { name: 'Yew longbow', vendor: 300, alch: 768, quantity: 50 },
    ]),
    [LEGACY_RUNE_PRICE_KEY]: '212',
  });

  const ctx = mountApp({ storage });
  t.after(ctx.cleanup);

  assert.equal(rows(ctx.document).length, 2);

  const cells = rowCells(rows(ctx.document)[0]);
  assert.equal(cells.name, 'Adamant platebody');
  assert.equal(cells.buyPrice, '4,000');
  assert.equal(cells.alchPrice, '9,600');
  assert.equal(cells.profit, '+538,800', 'v1 profit maths is preserved');

  assert.equal(ctx.document.querySelector('#runePrice').value, '212');
  assert.equal(
    ctx.document.querySelector('.cell-item__icon').getAttribute('src'),
    'https://static.runelite.net/cache/item/icon/1123.png',
    'the old icon URL still works',
  );
});

test('the migrated state is written back in the v2 format', (t) => {
  const storage = createMemoryStorage({
    [LEGACY_ITEMS_KEY]: JSON.stringify([{ name: 'Rune axe', vendor: 14_000, alch: 12_480, quantity: 4 }]),
  });

  const ctx = mountApp({ storage });
  t.after(ctx.cleanup);

  // Any change triggers a save.
  type(ctx.document.querySelector('#runePrice'), '190');

  const saved = JSON.parse(storage.getItem(STATE_KEY));
  assert.equal(saved.version, 2);
  assert.equal(saved.items[0].buyPrice, 14_000);
  assert.equal(saved.items[0].alchPrice, 12_480);
  assert.equal('vendor' in saved.items[0], false);
  assert.equal(saved.runePrice, 190);
});

test('a v1 save with no rune price falls back to the default, not NaN', (t) => {
  const storage = createMemoryStorage({
    [LEGACY_ITEMS_KEY]: JSON.stringify([{ name: 'Rune axe', vendor: 1, alch: 2, quantity: 1 }]),
  });

  const ctx = mountApp({ storage });
  t.after(ctx.cleanup);

  assert.equal(ctx.document.querySelector('#runePrice').value, '200');
  assert.equal(text(ctx.document, '#totalProfit'), '-199 gp', 'the maths is finite');
});

test('a reload restores items, rune price, basis and sort', async (t) => {
  const storage = createMemoryStorage();

  const first = mountApp({ storage });
  type(first.document.querySelector('#itemName'), 'Adamant platebody');
  type(first.document.querySelector('#quantity'), '100');
  first.document.querySelector('#addForm').dispatchEvent(
    new first.window.Event('submit', { bubbles: true, cancelable: true }),
  );
  await flush();

  type(first.document.querySelector('#runePrice'), '175');
  first.document.querySelector('#priceBasis').value = PRICE_BASIS.INSTANT_SELL;
  first.document.querySelector('#priceBasis').dispatchEvent(
    new first.window.Event('change', { bubbles: true }),
  );
  click(first.document.querySelector('th[data-sort="profit"]'));
  first.cleanup();

  // A fresh mount against the same storage stands in for a page reload.
  const second = mountApp({ storage });
  t.after(second.cleanup);

  assert.equal(rows(second.document).length, 1);
  assert.equal(rowCells(rows(second.document)[0]).name, 'Adamant platebody');
  assert.equal(second.document.querySelector('#runePrice').value, '175');
  assert.equal(second.document.querySelector('#priceBasis').value, PRICE_BASIS.INSTANT_SELL);
  assert.equal(
    second.document.querySelector('th[data-sort="profit"]').getAttribute('aria-sort'),
    'ascending',
  );
});

test('inline edits survive a reload', (t) => {
  const storage = createMemoryStorage();

  const first = mountApp({ storage, initialState: { items: [{ id: 'x', name: 'Rune axe', buyPrice: 1, alchPrice: 2, quantity: 3 }] } });
  const cell = first.document.querySelector('[data-field="quantity"]');
  cell.textContent = '99';
  cell.dispatchEvent(new first.window.FocusEvent('focusout', { bubbles: true }));
  first.cleanup();

  const second = mountApp({ storage });
  t.after(second.cleanup);

  assert.equal(rowCells(rows(second.document)[0]).quantity, '99');
});

test('corrupt saved data does not stop the app from starting', (t) => {
  const storage = createMemoryStorage({ [STATE_KEY]: '{{{ not json' });
  const ctx = mountApp({ storage });
  t.after(ctx.cleanup);

  assert.equal(rows(ctx.document).length, 0);
  assert.equal(ctx.document.querySelector('#emptyState').hidden, false);
  assert.equal(ctx.document.querySelector('#runePrice').value, '200');
});

test('storage that refuses writes still leaves a usable app', (t) => {
  const readOnly = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {},
  };

  const ctx = mountApp({ storage: readOnly });
  t.after(ctx.cleanup);

  ctx.store.addItem({ name: 'Adamant platebody', buyPrice: 4000, alchPrice: 9600, quantity: 10 });

  assert.equal(rows(ctx.document).length, 1, 'the session works, it just will not persist');
});
