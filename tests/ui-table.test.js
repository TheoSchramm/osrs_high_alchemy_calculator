/**
 * Regression tests for the items table: rendering, sorting, inline editing,
 * row actions and the totals row.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mountApp,
  rows,
  rowCells,
  text,
  toastMessages,
  click,
  editCell,
  keydown,
  flush,
} from './helpers/mount.js';

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

test('an empty list shows the empty state and hides the totals row', (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  assert.equal(rows(ctx.document).length, 0);
  assert.equal(ctx.document.querySelector('#emptyState').hidden, false);
  assert.equal(ctx.document.querySelector('#itemsFoot').hidden, true);
  assert.equal(text(ctx.document, '#rowCount'), '');
});

test('rows render every derived column', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  const [tr] = rows(ctx.document);
  const cells = rowCells(tr);

  assert.equal(cells.name, 'Adamant platebody');
  assert.equal(cells.buyPrice, '4,000');
  assert.equal(cells.alchPrice, '9,600');
  assert.equal(cells.quantity, '100');
  assert.equal(cells.costItems, '400,000');
  assert.equal(cells.costRunes, '20,000');
  assert.equal(cells.profitPerCast, '+5,400');
  assert.equal(cells.profit, '+540,000');
});

test('adding items reveals the totals row and the item count', (t) => {
  const ctx = mountWith([PLATEBODY, LONGBOW]);
  t.after(ctx.cleanup);

  assert.equal(rows(ctx.document).length, 2);
  assert.equal(ctx.document.querySelector('#emptyState').hidden, true);
  assert.equal(ctx.document.querySelector('#itemsFoot').hidden, false);
  assert.equal(text(ctx.document, '#rowCount'), '2 items · 150 casts');
  assert.equal(text(ctx.document, '[data-total="profit"]'), '+553,400');
  assert.equal(text(ctx.document, '[data-total="costItems"]'), '415,000');
});

test('a losing item is coloured as a loss', (t) => {
  const ctx = mountWith([{ id: 'axe', name: 'Rune axe', buyPrice: 14_000, alchPrice: 12_480, quantity: 10 }]);
  t.after(ctx.cleanup);

  const profitCell = ctx.document.querySelector('[data-cell="profit"]');
  assert.equal(profitCell.textContent, '-17,200');
  assert.ok(profitCell.classList.contains('value-loss'));
  assert.equal(profitCell.classList.contains('value-profit'), false);
});

test('clicking a header sorts and marks the column', (t) => {
  const ctx = mountWith([PLATEBODY, LONGBOW]);
  t.after(ctx.cleanup);

  const header = ctx.document.querySelector('th[data-sort="profit"]');
  click(header);

  assert.equal(header.getAttribute('aria-sort'), 'ascending');
  assert.deepEqual(
    rows(ctx.document).map((tr) => rowCells(tr).name),
    ['Yew longbow', 'Adamant platebody'],
  );

  click(header);
  assert.equal(header.getAttribute('aria-sort'), 'descending');
  assert.deepEqual(
    rows(ctx.document).map((tr) => rowCells(tr).name),
    ['Adamant platebody', 'Yew longbow'],
  );
});

test('only the active column carries aria-sort', (t) => {
  const ctx = mountWith([PLATEBODY, LONGBOW]);
  t.after(ctx.cleanup);

  click(ctx.document.querySelector('th[data-sort="profit"]'));
  click(ctx.document.querySelector('th[data-sort="name"]'));

  assert.equal(ctx.document.querySelector('th[data-sort="profit"]').hasAttribute('aria-sort'), false);
  assert.equal(ctx.document.querySelector('th[data-sort="name"]').getAttribute('aria-sort'), 'ascending');
});

test('headers sort from the keyboard', (t) => {
  const ctx = mountWith([PLATEBODY, LONGBOW]);
  t.after(ctx.cleanup);

  const header = ctx.document.querySelector('th[data-sort="name"]');
  assert.equal(header.tabIndex, 0);

  keydown(header, 'Enter');
  assert.equal(header.getAttribute('aria-sort'), 'ascending');
});

test('editing a cell updates the store and re-renders the row', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  const quantityCell = ctx.document.querySelector('[data-field="quantity"]');
  editCell(quantityCell, '250');

  assert.equal(ctx.store.getItem('plate').quantity, 250);
  assert.equal(rowCells(rows(ctx.document)[0]).profit, '+1,350,000');
  assert.equal(text(ctx.document, '#rowCount'), '1 item · 250 casts');
});

test('edited values accept shorthand and re-render formatted', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  editCell(ctx.document.querySelector('[data-field="buyPrice"]'), '3.5k');

  assert.equal(ctx.store.getItem('plate').buyPrice, 3500);
  assert.equal(rowCells(rows(ctx.document)[0]).buyPrice, '3,500');
});

test('Escape restores the rendered value instead of committing it', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  const cell = ctx.document.querySelector('[data-field="buyPrice"]');
  cell.textContent = '999999';
  keydown(cell, 'Escape');

  assert.equal(ctx.store.getItem('plate').buyPrice, 4000, 'the edit was discarded');
  assert.equal(cell.textContent, '4,000');
});

test('Enter commits the edit', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  const cell = ctx.document.querySelector('[data-field="quantity"]');
  cell.focus();
  cell.textContent = '7';
  const event = keydown(cell, 'Enter');

  assert.equal(event.defaultPrevented, true, 'Enter must not insert a newline');
  assert.equal(ctx.store.getItem('plate').quantity, 7);
});

test('deleting a row removes it and offers an undo', (t) => {
  const ctx = mountWith([PLATEBODY, LONGBOW]);
  t.after(ctx.cleanup);

  const deleteButton = rows(ctx.document)[0].querySelector('[data-action="delete"]');
  click(deleteButton);

  assert.equal(rows(ctx.document).length, 1);
  assert.deepEqual(toastMessages(ctx.document), ['Removed Adamant platebody.']);

  click(ctx.document.querySelector('.toast__action'));

  assert.equal(rows(ctx.document).length, 2);
  assert.deepEqual(
    ctx.store.getState().items.map((item) => item.name),
    ['Adamant platebody', 'Yew longbow'],
    'undo restores the original position',
  );
});

test('the refresh button is disabled for manually added items', (t) => {
  const ctx = mountWith([
    { id: 'manual', name: 'Homemade item', buyPrice: 1, alchPrice: 2, quantity: 3 },
    PLATEBODY,
  ]);
  t.after(ctx.cleanup);

  const [manualRow, apiRow] = rows(ctx.document);
  assert.equal(manualRow.querySelector('[data-action="refresh"]').disabled, true);
  assert.equal(apiRow.querySelector('[data-action="refresh"]').disabled, false);
});

test('refreshing a row pulls new prices from the API', async (t) => {
  const ctx = mountWith([{ ...PLATEBODY, buyPrice: 1, alchPrice: 1 }]);
  t.after(ctx.cleanup);

  click(rows(ctx.document)[0].querySelector('[data-action="refresh"]'));
  await flush();

  const item = ctx.store.getItem('plate');
  assert.equal(item.buyPrice, 4200, 'instant-buy price from the fixture');
  assert.equal(item.alchPrice, 5760);
  assert.equal(item.icon, 'https://oldschool.runescape.wiki/images/Adamant_platebody.png');
  assert.ok(toastMessages(ctx.document).some((message) => message.includes('updated')));
});

test('rows are reused across renders so editing does not lose focus', (t) => {
  const ctx = mountWith([PLATEBODY, LONGBOW]);
  t.after(ctx.cleanup);

  const before = rows(ctx.document)[0];
  ctx.store.setRunePrice(500);
  const after = rows(ctx.document)[0];

  assert.equal(before, after, 'the same <tr> element is kept');
});

test('the cell being typed in is not overwritten by a re-render', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  const cell = ctx.document.querySelector('[data-field="buyPrice"]');
  cell.focus();
  cell.textContent = '12';

  ctx.store.setRunePrice(300); // triggers a full re-render

  assert.equal(cell.textContent, '12', 'the in-progress edit survives');
});

test('icons render with the item name as alt text', (t) => {
  const ctx = mountWith([{ ...PLATEBODY, icon: 'https://example.test/plate.png' }]);
  t.after(ctx.cleanup);

  const icon = ctx.document.querySelector('.cell-item__icon');
  assert.equal(icon.getAttribute('src'), 'https://example.test/plate.png');
  assert.equal(icon.alt, 'Adamant platebody icon');
});

test('editable cells are labelled for screen readers', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  assert.equal(
    ctx.document.querySelector('[data-field="buyPrice"]').getAttribute('aria-label'),
    'Buy price for Adamant platebody',
  );
});
