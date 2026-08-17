/** Regression tests for the add-item form and its type-ahead search. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mountApp,
  rows,
  rowCells,
  toastMessages,
  type,
  submitForm,
  keydown,
  click,
  flush,
} from './helpers/mount.js';
import { createFakeFetch } from './helpers/fake-api.js';

function fields(document) {
  return {
    form: document.querySelector('#addForm'),
    name: document.querySelector('#itemName'),
    buy: document.querySelector('#buyPrice'),
    alch: document.querySelector('#alchPrice'),
    quantity: document.querySelector('#quantity'),
    suggestions: document.querySelector('#itemSuggestions'),
  };
}

test('submitting a known item fills prices from the API', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'Adamant platebody');
  type(f.quantity, '100');
  submitForm(f.form);
  await flush();

  assert.equal(rows(ctx.document).length, 1);
  const cells = rowCells(rows(ctx.document)[0]);
  assert.equal(cells.name, 'Adamant platebody');
  assert.equal(cells.buyPrice, '4,200');
  assert.equal(cells.alchPrice, '5,760');
  assert.equal(cells.quantity, '100');

  const item = ctx.store.getState().items[0];
  assert.equal(item.itemId, 1123);
  assert.ok(item.updatedAt > 0);
});

test('values typed by the user beat the API', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'Adamant platebody');
  type(f.buy, '3,000');
  type(f.alch, '9,999');
  type(f.quantity, '5');
  submitForm(f.form);
  await flush();

  const item = ctx.store.getState().items[0];
  assert.equal(item.buyPrice, 3000);
  assert.equal(item.alchPrice, 9999);
  assert.equal(item.itemId, 1123, 'the item is still matched to the Grand Exchange');
});

test('an unknown item is kept with the values entered by hand', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'Party hat of testing');
  type(f.buy, '1m');
  type(f.alch, '2m');
  submitForm(f.form);
  await flush();

  const item = ctx.store.getState().items[0];
  assert.equal(item.name, 'Party hat of testing');
  assert.equal(item.buyPrice, 1_000_000);
  assert.equal(item.alchPrice, 2_000_000);
  assert.equal(item.itemId, null);
  assert.ok(toastMessages(ctx.document).some((m) => m.includes('not on the Grand Exchange')));
});

test('the form resets after a submit', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'Yew longbow');
  type(f.buy, '250');
  type(f.quantity, '20');
  submitForm(f.form);
  await flush();

  assert.equal(f.name.value, '');
  assert.equal(f.buy.value, '');
  assert.equal(f.alch.value, '');
  assert.equal(f.quantity.value, '1', 'quantity returns to 1, not blank');
});

test('an empty name is ignored', (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, '   ');
  submitForm(f.form);

  assert.equal(ctx.store.getState().items.length, 0);
});

test('typing shows matching suggestions', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'rune');
  await flush();

  assert.equal(f.suggestions.hidden, false);
  assert.equal(f.name.getAttribute('aria-expanded'), 'true');

  const names = [...f.suggestions.querySelectorAll('.suggestion__name')].map((n) => n.textContent);
  assert.deepEqual(names, ['Rune axe', 'Nature rune']);
});

test('suggestions show the high alch value', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  type(fields(ctx.document).name, 'adamant');
  await flush();

  const meta = ctx.document.querySelector('.suggestion__meta');
  assert.equal(meta.textContent, 'alch 5,760');
});

test('a one-character query does not search', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'r');
  await flush();

  assert.equal(f.suggestions.hidden, true);
});

test('arrow keys move through suggestions and Enter picks one', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'rune');
  await flush();

  keydown(f.name, 'ArrowDown');
  assert.equal(f.suggestions.children[0].getAttribute('aria-selected'), 'true');
  assert.equal(f.name.getAttribute('aria-activedescendant'), 'suggestion-0');

  keydown(f.name, 'ArrowDown');
  assert.equal(f.suggestions.children[1].getAttribute('aria-selected'), 'true');

  keydown(f.name, 'Enter');

  assert.equal(f.name.value, 'Nature rune');
  assert.equal(f.alch.value, '5', 'the alch value is pre-filled from the mapping');
  assert.equal(f.suggestions.hidden, true);
});

test('ArrowUp from the top wraps to the bottom', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'rune');
  await flush();

  keydown(f.name, 'ArrowUp');
  assert.equal(f.suggestions.children[1].getAttribute('aria-selected'), 'true');
});

test('Escape closes the suggestion list', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'rune');
  await flush();
  assert.equal(f.suggestions.hidden, false);

  keydown(f.name, 'Escape');
  assert.equal(f.suggestions.hidden, true);
  assert.equal(f.name.getAttribute('aria-expanded'), 'false');
});

test('clicking a suggestion selects it', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'adamant');
  await flush();

  const option = f.suggestions.querySelector('.suggestion');
  option.dispatchEvent(new ctx.window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));

  assert.equal(f.name.value, 'Adamant platebody');
  assert.equal(f.suggestions.hidden, true);
});

test('Enter with no active suggestion submits the form', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'rune');
  await flush();

  // No ArrowDown first, so Enter should fall through to the form.
  const event = keydown(f.name, 'Enter');
  assert.equal(event.defaultPrevented, false);
});

test('a search failure never blocks manual entry', async (t) => {
  const failing = createFakeFetch({ override: () => ({ status: 500 }) });
  const ctx = mountApp({ fetch: failing });
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'adamant');
  await flush();
  assert.equal(f.suggestions.hidden, true, 'no dropdown, but no crash either');

  type(f.buy, '100');
  type(f.alch, '200');
  submitForm(f.form);
  await flush();

  assert.equal(rows(ctx.document).length, 1);
  assert.ok(toastMessages(ctx.document).some((m) => m.includes('failed')));
});

test('an API failure is reported once, not twice', async (t) => {
  const ctx = mountApp({ fetch: createFakeFetch({ override: () => ({ status: 500 }) }) });
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'Adamant platebody');
  submitForm(f.form);
  await flush();

  assert.equal(toastMessages(ctx.document).length, 1);
  assert.match(toastMessages(ctx.document)[0], /Price lookup failed/);
});

test('a stale search response cannot overwrite a newer one', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const form = ctx.app.views.addForm;
  const slow = new Promise((resolve) => setTimeout(() => resolve([{ id: 1, name: 'Stale', highAlch: 1 }]), 30));
  form.search = (query) => (query === 'slow' ? slow : Promise.resolve([{ id: 2, name: 'Fresh', highAlch: 2 }]));

  const f = fields(ctx.document);
  type(f.name, 'slow');
  type(f.name, 'fast');
  await flush(10);

  const names = [...f.suggestions.querySelectorAll('.suggestion__name')].map((n) => n.textContent);
  assert.deepEqual(names, ['Fresh']);
});

test('clearing the input closes the suggestions', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'rune');
  await flush();
  assert.equal(f.suggestions.hidden, false);

  type(f.name, '');
  assert.equal(f.suggestions.hidden, true);
});

test('the Add button submits the form', async (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const f = fields(ctx.document);
  type(f.name, 'Yew longbow');
  click(ctx.document.querySelector('#addButton'));
  await flush();

  assert.equal(rows(ctx.document).length, 1);
});
