/** Regression tests for the settings panel, totals cards and bulk actions. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mountApp,
  rows,
  text,
  toastMessages,
  type,
  change,
  click,
  flush,
} from './helpers/mount.js';
import { createFakeFetch } from './helpers/fake-api.js';
import { PRICE_BASIS, createMemoryStorage } from '../src/data/storage.js';

const PLATEBODY = {
  id: 'plate',
  itemId: 1123,
  name: 'Adamant platebody',
  buyPrice: 4000,
  alchPrice: 9600,
  quantity: 100,
};

const LONGBOW = {
  id: 'bow',
  itemId: 855,
  name: 'Yew longbow',
  buyPrice: 300,
  alchPrice: 768,
  quantity: 50,
};

function mountWith(items, extra = {}) {
  return mountApp({ initialState: { items, runePrice: 200, ...extra } });
}

/* ------------------------------------------------------------ totals cards */

test('totals cards render profit, xp, time and spend', (t) => {
  const ctx = mountWith([PLATEBODY, LONGBOW]);
  t.after(ctx.cleanup);

  assert.equal(text(ctx.document, '#totalProfit'), '+553,400 gp');
  assert.equal(text(ctx.document, '#totalXp'), '9,750 xp');
  assert.equal(text(ctx.document, '#totalTime'), '8m', '150 casts is 7.5 minutes, rounded');
  assert.equal(text(ctx.document, '#totalCost'), '445,000 gp');
  // Each note explains its own card: the rate is what the clock is made from,
  // and the split is what the money went on. The two halves of a note are
  // separated by a newline, which the stylesheet renders as a line break.
  assert.equal(text(ctx.document, '#castRate'), '1,200 casts an hour');
  assert.equal(text(ctx.document, '#totalSplit'), '415,000 on items\n30,000 on runes');
});

test('the profit card is coloured and notes the return', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  const card = ctx.document.querySelector('#totalProfit');
  assert.ok(card.classList.contains('value-profit'));
  assert.equal(text(ctx.document, '#totalProfitNote'), '128.6% return\n+5,400 gp per cast');
});

test('an empty list shows neutral totals', (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  assert.equal(text(ctx.document, '#totalProfit'), '0 gp');
  assert.equal(text(ctx.document, '#totalTime'), '0m');
  assert.equal(text(ctx.document, '#totalProfitNote'), 'Nothing spent yet');
});

test('a long session reports hours and minutes', (t) => {
  const ctx = mountWith([{ ...PLATEBODY, quantity: 5000 }]);
  t.after(ctx.cleanup);

  assert.equal(text(ctx.document, '#totalTime'), '4h 10m');
});

/* --------------------------------------------------------------- settings */

test('the rune price input is seeded from state and drives the totals', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  const input = ctx.document.querySelector('#runePrice');
  assert.equal(input.value, '200');

  type(input, '500');

  assert.equal(ctx.store.getState().runePrice, 500);
  assert.equal(text(ctx.document, '#totalProfit'), '+510,000 gp');
});

test('the rune price accepts shorthand and rejects negatives', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  const input = ctx.document.querySelector('#runePrice');

  type(input, '1.2k');
  assert.equal(ctx.store.getState().runePrice, 1200);

  type(input, '-5');
  assert.equal(ctx.store.getState().runePrice, 0);
});

test('typing in the rune price field is not interrupted by a re-render', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  const input = ctx.document.querySelector('#runePrice');
  input.focus();
  type(input, '1,250');

  assert.equal(ctx.store.getState().runePrice, 1250);
  assert.equal(input.value, '1,250', 'the text typed is not rewritten under the caret');
});

test('the price basis select is bound to state', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  const select = ctx.document.querySelector('#priceBasis');
  assert.equal(select.value, PRICE_BASIS.INSTANT_BUY, 'instant buy is the default');

  change(select, PRICE_BASIS.INSTANT_SELL);
  assert.equal(ctx.store.getState().priceBasis, PRICE_BASIS.INSTANT_SELL);
});

test('the price basis decides which side a refresh uses', async (t) => {
  const ctx = mountWith([{ ...PLATEBODY, buyPrice: 0 }]);
  t.after(ctx.cleanup);

  change(ctx.document.querySelector('#priceBasis'), PRICE_BASIS.INSTANT_SELL);
  click(rows(ctx.document)[0].querySelector('[data-action="refresh"]'));
  await flush();

  assert.equal(ctx.store.getItem('plate').buyPrice, 4100, 'the instant-sell price');
});

/* ----------------------------------------------------------- bulk actions */

test('refresh all updates every matched item in one request', async (t) => {
  const ctx = mountWith([
    { ...PLATEBODY, buyPrice: 1 },
    { ...LONGBOW, buyPrice: 1 },
    { id: 'manual', name: 'Manual item', buyPrice: 7, alchPrice: 7, quantity: 1 },
  ]);
  t.after(ctx.cleanup);

  click(ctx.document.querySelector('#refreshAll'));
  await flush();

  assert.equal(ctx.store.getItem('plate').buyPrice, 4200);
  assert.equal(ctx.store.getItem('bow').buyPrice, 320);
  assert.equal(ctx.store.getItem('manual').buyPrice, 7, 'manual items are left alone');
  assert.ok(toastMessages(ctx.document).some((m) => m.includes('Refreshed 2 items')));
});

test('update all prices refreshes the nature rune too', async (t) => {
  const ctx = mountWith([{ ...PLATEBODY, buyPrice: 1 }]);
  t.after(ctx.cleanup);

  click(ctx.document.querySelector('#refreshAll'));
  await flush();

  // The rune is half the cost of every cast, so leaving it stale reports a
  // profit worked out against an old cost.
  assert.equal(ctx.store.getState().runePrice, 212);
  assert.equal(ctx.document.querySelector('#runePrice').value, '212', 'the field follows');
  assert.ok(toastMessages(ctx.document).some((m) => m.includes('Nature rune 212 gp')));

  // Asked for in the same round of requests as the items, not by a separate
  // call after the fact.
  assert.equal(ctx.fetchImpl.callsMatching('/latest?id=561').length, 1);
});

test('a rune with no recent trades leaves the price alone', async (t) => {
  // The fixture prices every item except the rune, so its snapshot comes back
  // without a buy price.
  const ctx = mountApp({
    initialState: { items: [{ ...PLATEBODY, buyPrice: 1 }], runePrice: 175 },
    fetch: createFakeFetch({
      latest: { 1123: { high: 4200, highTime: 1, low: 4000, lowTime: 1 } },
    }),
  });
  t.after(ctx.cleanup);

  click(ctx.document.querySelector('#refreshAll'));
  await flush();

  assert.equal(ctx.store.getState().runePrice, 175, 'a missing price must not overwrite it');
  assert.equal(ctx.store.getItem('plate').buyPrice, 4200, 'the items still update');
});

test('the rune button says so when nothing has traded', async (t) => {
  const ctx = mountApp({
    initialState: { items: [], runePrice: 175 },
    fetch: createFakeFetch({ latest: {} }),
  });
  t.after(ctx.cleanup);

  click(ctx.document.querySelector('#fetchRunePrice'));
  await flush();

  // Without the guard this wrote 9 gp - the rune's shop value, which the price
  // client falls back to so an item row never shows 0 - and the message below
  // could never appear.
  assert.equal(ctx.store.getState().runePrice, 175);
  assert.ok(toastMessages(ctx.document).some((m) => m.includes('No recent nature rune trades')));
});

test('refresh all with nothing to refresh says so', async (t) => {
  const ctx = mountWith([{ id: 'manual', name: 'Manual', buyPrice: 1, alchPrice: 1, quantity: 1 }]);
  t.after(ctx.cleanup);

  click(ctx.document.querySelector('#refreshAll'));
  await flush();

  assert.ok(toastMessages(ctx.document).some((m) => m.includes('No items')));
});

test('the bulk buttons are disabled while the list is empty', (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  assert.equal(ctx.document.querySelector('#refreshAll').disabled, true);
  assert.equal(ctx.document.querySelector('#clearAll').disabled, true);

  ctx.store.addItem({ name: 'Something' });

  assert.equal(ctx.document.querySelector('#refreshAll').disabled, false);
  assert.equal(ctx.document.querySelector('#clearAll').disabled, false);
});

test('updating the rune price pulls the nature rune from the API', async (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  click(ctx.document.querySelector('#fetchRunePrice'));
  await flush();

  assert.equal(ctx.store.getState().runePrice, 212);
  assert.equal(ctx.document.querySelector('#runePrice').value, '212');
  assert.ok(toastMessages(ctx.document).some((m) => m.includes('212')));
});

test('clear all empties the table and can be undone', (t) => {
  const ctx = mountWith([PLATEBODY, LONGBOW]);
  t.after(ctx.cleanup);

  click(ctx.document.querySelector('#clearAll'));

  assert.equal(rows(ctx.document).length, 0);
  assert.ok(toastMessages(ctx.document).some((m) => m.includes('Cleared 2 items')));

  click(ctx.document.querySelector('.toast__action'));

  assert.equal(rows(ctx.document).length, 2);
  assert.deepEqual(ctx.store.getState().items.map((i) => i.name), ['Adamant platebody', 'Yew longbow']);
});

test('an API outage surfaces as a toast, not a crash', async (t) => {
  const ctx = mountApp({
    initialState: { items: [PLATEBODY], runePrice: 200 },
    fetch: createFakeFetch({ override: () => ({ status: 503 }) }),
  });
  t.after(ctx.cleanup);

  click(ctx.document.querySelector('#refreshAll'));
  await flush();

  assert.ok(toastMessages(ctx.document).some((m) => m.includes('503')));
  assert.equal(rows(ctx.document).length, 1, 'the table still renders');
});

/* ------------------------------------------------------- auto-refresh ---- */

test('the auto-refresh select is bound to state and defaults to 5 minutes', (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const select = ctx.document.querySelector('#autoRefresh');
  assert.equal(select.value, '300000');

  change(select, '60000');
  assert.equal(ctx.store.getState().autoRefreshMs, 60_000);

  change(select, '0');
  assert.equal(ctx.store.getState().autoRefreshMs, 0, 'off is a valid choice');
});

test('the auto-refresh interval survives a reload', (t) => {
  const storage = createMemoryStorage();

  const first = mountApp({ storage });
  change(first.document.querySelector('#autoRefresh'), '900000');
  first.cleanup();

  const second = mountApp({ storage });
  t.after(second.cleanup);

  assert.equal(second.store.getState().autoRefreshMs, 900_000);
  assert.equal(second.document.querySelector('#autoRefresh').value, '900000');
});

test('changing the interval reschedules the poller', (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  change(ctx.document.querySelector('#autoRefresh'), '60000');
  assert.equal(ctx.app.refresher.intervalMs, 60_000);

  change(ctx.document.querySelector('#autoRefresh'), '0');
  assert.equal(ctx.app.refresher.intervalMs, 0, 'off stops the schedule');
});

test('auto-refresh writes prices into the table', async (t) => {
  const ctx = mountApp({
    initialState: { items: [{ ...PLATEBODY, buyPrice: 1 }], runePrice: 200 },
  });
  t.after(ctx.cleanup);

  await ctx.app.refresher.poll();

  assert.equal(ctx.store.getItem('plate').buyPrice, 4200);
  assert.equal(rows(ctx.document)[0].querySelector('[data-cell="updatedAt"]').textContent, 'just now');
});
