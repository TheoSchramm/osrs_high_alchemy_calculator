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
  toggle,
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

test('refreshing a row pulls a new buy price but leaves alch alone', async (t) => {
  const ctx = mountWith([{ ...PLATEBODY, buyPrice: 1, alchPrice: 9600 }]);
  t.after(ctx.cleanup);

  click(rows(ctx.document)[0].querySelector('[data-action="refresh"]'));
  await flush();

  const item = ctx.store.getItem('plate');
  assert.equal(item.buyPrice, 4200, 'instant-buy price from the fixture');
  assert.equal(item.alchPrice, 9600, 'high alch is fixed by the game, not the market');
  assert.equal(item.icon, 'https://oldschool.runescape.wiki/images/Adamant_platebody.png');
  assert.ok(toastMessages(ctx.document).some((message) => message.includes('updated')));
});

test('a refresh can be undone from its toast', async (t) => {
  const ctx = mountWith([{ ...PLATEBODY, buyPrice: 1, alchPrice: 9600 }]);
  t.after(ctx.cleanup);

  click(rows(ctx.document)[0].querySelector('[data-action="refresh"]'));
  await flush();
  assert.equal(ctx.store.getItem('plate').buyPrice, 4200, 'the market price landed');

  click(ctx.document.querySelector('.toast__action'));

  assert.equal(ctx.store.getItem('plate').buyPrice, 1, 'the price the row had before is back');
});

test('unlocking a price can be undone from its toast', (t) => {
  const ctx = mountWith([{
    ...PLATEBODY,
    buyPrice: 3000,
    overrides: { buyPrice: true },
    marketBuyPrice: 4200,
  }]);
  t.after(ctx.cleanup);

  toggle(rows(ctx.document)[0].querySelector('[data-override="buyPrice"]'), false);

  assert.equal(ctx.store.getItem('plate').buyPrice, 4200, 'the market price comes back');
  assert.equal(ctx.store.getItem('plate').overrides.buyPrice, false, 'and the row follows it again');

  click(ctx.document.querySelector('.toast__action'));

  const item = ctx.store.getItem('plate');
  assert.equal(item.buyPrice, 3000, 'the price you typed is back');
  // Restoring the number without the lock would leave the next refresh free to
  // overwrite it, which is not what "undo" promised.
  assert.equal(item.overrides.buyPrice, true, 'and it is locked again');
});

test('refreshing fills in an alch value the row never had', async (t) => {
  const ctx = mountWith([{ ...PLATEBODY, buyPrice: 1, alchPrice: 0 }]);
  t.after(ctx.cleanup);

  click(rows(ctx.document)[0].querySelector('[data-action="refresh"]'));
  await flush();

  assert.equal(ctx.store.getItem('plate').alchPrice, 5760);
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

test('an item with no icon has no src attribute at all', (t) => {
  // An empty src resolves to the page URL, so the browser would re-request the
  // whole document for every icon-less row.
  const ctx = mountWith([{ id: 'manual', name: 'Hand-entered', buyPrice: 1, alchPrice: 2, quantity: 3 }]);
  t.after(ctx.cleanup);

  const icon = ctx.document.querySelector('.cell-item__icon');
  assert.equal(icon.hasAttribute('src'), false);
  assert.equal(icon.alt, '');
});

test('gaining and losing an icon toggles the src attribute', (t) => {
  const ctx = mountWith([{ id: 'x', name: 'Thing', buyPrice: 1, alchPrice: 2, quantity: 1 }]);
  t.after(ctx.cleanup);

  const icon = () => ctx.document.querySelector('.cell-item__icon');
  assert.equal(icon().hasAttribute('src'), false);

  ctx.store.updateItem('x', { icon: 'https://example.test/i.png' });
  assert.equal(icon().getAttribute('src'), 'https://example.test/i.png');

  ctx.store.updateItem('x', { icon: null });
  assert.equal(icon().hasAttribute('src'), false, 'the stale src must be removed');
});

test('editable cells are labelled for screen readers', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  assert.equal(
    ctx.document.querySelector('[data-field="buyPrice"]').getAttribute('aria-label'),
    'Buy price for Adamant platebody',
  );
});

/* ---------------------------------- Updated column ---------------------- */

test('the Updated column shows how long since the last price fetch', (t) => {
  const now = Date.now();
  const ctx = mountWith([
    { ...PLATEBODY, id: 'fresh', updatedAt: now - 5000 },
    { ...LONGBOW, id: 'old', updatedAt: now - 3 * 60 * 60 * 1000 },
  ]);
  t.after(ctx.cleanup);

  const ages = [...ctx.document.querySelectorAll('[data-cell="updatedAt"]')];
  assert.equal(ages[0].textContent, 'just now');
  assert.equal(ages[1].textContent, '3h ago');
});

test('the Updated column is colour-banded by staleness', (t) => {
  const now = Date.now();
  const ctx = mountWith([
    { ...PLATEBODY, id: 'fresh', updatedAt: now - 1000 },
    { ...LONGBOW, id: 'stale', updatedAt: now - 6 * 60 * 60 * 1000 },
  ]);
  t.after(ctx.cleanup);

  const ages = [...ctx.document.querySelectorAll('[data-cell="updatedAt"]')];
  assert.equal(ages[0].dataset.freshness, 'fresh');
  assert.equal(ages[1].dataset.freshness, 'stale');
});

test('a hand-entered item has no age to show', (t) => {
  const ctx = mountWith([{ id: 'm', name: 'Hand-entered', buyPrice: 1, alchPrice: 2, quantity: 3 }]);
  t.after(ctx.cleanup);

  const age = ctx.document.querySelector('[data-cell="updatedAt"]');
  assert.equal(age.textContent, '-');
  assert.equal(age.dataset.freshness, 'none');
  assert.match(age.title, /Never fetched/);
});

test('an item that has never been refreshed reads as never', (t) => {
  const ctx = mountWith([{ ...PLATEBODY, updatedAt: null }]);
  t.after(ctx.cleanup);

  assert.equal(ctx.document.querySelector('[data-cell="updatedAt"]').textContent, 'never');
});

test('renderAges re-stamps the labels without a full render', (t) => {
  let now = 1_000_000_000;
  const ctx = mountApp({
    initialState: { items: [{ ...PLATEBODY, updatedAt: now - 5000 }], runePrice: 200 },
    now: () => now,
  });
  t.after(ctx.cleanup);

  const age = () => ctx.document.querySelector('[data-cell="updatedAt"]').textContent;
  assert.equal(age(), 'just now');

  now += 5 * 60 * 1000;
  ctx.app.views.table.renderAges();

  assert.equal(age(), '5m ago', 'the label ages without the store changing');
});

test('the Updated column is sortable', (t) => {
  const now = Date.now();
  const ctx = mountWith([
    { ...PLATEBODY, id: 'old', updatedAt: now - 60 * 60 * 1000 },
    { ...LONGBOW, id: 'new', updatedAt: now - 1000 },
  ]);
  t.after(ctx.cleanup);

  const header = ctx.document.querySelector('th[data-sort="updatedAt"]');
  assert.ok(header, 'the Updated header should be sortable');

  click(header);
  assert.deepEqual(rows(ctx.document).map((tr) => tr.dataset.id), ['old', 'new']);

  click(header);
  assert.deepEqual(rows(ctx.document).map((tr) => tr.dataset.id), ['new', 'old']);
});

/* ------------------------------------------ hand-typed prices vs polling -- */

test('a hand-typed buy price survives a background poll', async (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  editCell(ctx.document.querySelector('[data-field="buyPrice"]'), '3,000');
  assert.equal(ctx.store.getItem('plate').buyPrice, 3000);

  // The timer fires without the user asking for anything.
  await ctx.app.refresher.poll();

  assert.equal(ctx.store.getItem('plate').buyPrice, 3000, 'the typed price is still there');
  assert.equal(rowCells(rows(ctx.document)[0]).buyPrice, '3,000');
});

test('an explicit row refresh keeps a hand-typed price', async (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  editCell(ctx.document.querySelector('[data-field="buyPrice"]'), '3,000');
  click(rows(ctx.document)[0].querySelector('[data-action="refresh"]'));
  await flush();

  const item = ctx.store.getItem('plate');
  assert.equal(item.buyPrice, 3000, 'your price stands');
  assert.equal(item.overrides.buyPrice, true, 'and stays pinned');
  assert.equal(item.marketBuyPrice, 4200, 'while the market price is noted for later');
});

test('clearing the lock gives the row back to the market', async (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  editCell(ctx.document.querySelector('[data-field="buyPrice"]'), '3,000');
  click(rows(ctx.document)[0].querySelector('[data-action="refresh"]'));
  await flush();

  toggle(rows(ctx.document)[0].querySelector('[data-override="buyPrice"]'), false);

  const item = ctx.store.getItem('plate');
  assert.equal(item.buyPrice, 4200, 'the market price returns');
  assert.equal(item.overrides.buyPrice, false);
  assert.equal(rows(ctx.document)[0].querySelector('[data-override="buyPrice"]').checked, false);
});

test('a pinned cell is marked and explains itself', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  const cell = () => ctx.document.querySelector('[data-field="buyPrice"]');
  assert.equal(cell().dataset.overridden, 'false');

  editCell(cell(), '3,000');

  assert.equal(cell().dataset.overridden, 'true');
  assert.match(cell().title, /Custom price enabled/);
});

test('the refresh tooltip names the item', (t) => {
  const ctx = mountWith([PLATEBODY, { id: 'manual', name: 'Hand-entered', buyPrice: 1, alchPrice: 2, quantity: 3 }]);
  t.after(ctx.cleanup);

  const titleOf = (index) =>
    rows(ctx.document)[index].querySelector('[data-action="refresh"]').title;

  assert.match(titleOf(0), /Update prices for "Adamant platebody"/);
  assert.match(titleOf(1), /Added manually/, 'a row with no Grand Exchange match says so');
});

test('editing quantity does not pin the price', async (t) => {
  const ctx = mountWith([{ ...PLATEBODY, buyPrice: 1 }]);
  t.after(ctx.cleanup);

  editCell(ctx.document.querySelector('[data-field="quantity"]'), '250');
  await ctx.app.refresher.poll();

  assert.equal(ctx.store.getItem('plate').buyPrice, 4200, 'the price still tracks the market');
  assert.equal(ctx.store.getItem('plate').quantity, 250, 'and the quantity is untouched');
});

test('the high alch cell is not editable', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  // Scoped to the body: the header shares the same data-column.
  const cell = ctx.document.querySelector('#itemsBody [data-column="alchPrice"]');
  assert.equal(cell.textContent.trim(), '9,600', 'it still shows the value');
  // jsdom does not implement isContentEditable, so check the attribute itself.
  assert.equal(cell.hasAttribute('contenteditable'), false);
  assert.equal(cell.querySelector('[contenteditable]'), null, 'and holds no editable child');
  assert.equal(ctx.document.querySelector('[data-field="alchPrice"]'), null);
});

test('a stray edit event cannot change the alch value', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  // Even if something forged the event the table listens for, the store refuses.
  ctx.store.editItemField('plate', 'alchPrice', '999999');

  assert.equal(ctx.store.getItem('plate').alchPrice, 9600);
});

test('the alch cell still updates when the value is filled in', async (t) => {
  const ctx = mountWith([{ ...PLATEBODY, alchPrice: 0 }]);
  t.after(ctx.cleanup);

  assert.equal(rowCells(rows(ctx.document)[0]).alchPrice, '0');

  click(rows(ctx.document)[0].querySelector('[data-action="refresh"]'));
  await flush();

  assert.equal(rowCells(rows(ctx.document)[0]).alchPrice, '5,760');
});

test('the lock box reports whether the price is held', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  const box = () => rows(ctx.document)[0].querySelector('[data-override="buyPrice"]');
  assert.ok(box(), 'every row carries the box, not just the held ones');
  assert.equal(box().checked, false, 'clear while the row tracks the market');
  assert.match(box().getAttribute('aria-label'), /Adamant platebody/);

  editCell(ctx.document.querySelector('[data-field="buyPrice"]'), '3,000');

  assert.equal(box().checked, true, 'typing a price ticks it');
  assert.match(box().title, /Custom price enabled/);
});

test('ticking the box holds a price that was never typed', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  // The badge could only ever be cleared: a price had to be typed before there
  // was anything to release. A box can be set as well.
  toggle(rows(ctx.document)[0].querySelector('[data-override="buyPrice"]'), true);

  const item = ctx.store.getItem('plate');
  assert.equal(item.overrides.buyPrice, true);
  assert.equal(item.buyPrice, 4000, 'and it holds the price the row already had');
  assert.deepEqual(toastMessages(ctx.document), [], 'locking is quiet: the tick says it');
});

test('a row the API does not know cannot be locked', (t) => {
  const ctx = mountWith([{ ...PLATEBODY, itemId: null }]);
  t.after(ctx.cleanup);

  const box = rows(ctx.document)[0].querySelector('[data-override="buyPrice"]');
  assert.equal(box.disabled, true, 'nothing refreshes it, so a lock holds off nothing');
  assert.match(box.title, /Added manually/);
});

test('the lock survives an explicit refresh, like the price it marks', async (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  editCell(ctx.document.querySelector('[data-field="buyPrice"]'), '3,000');
  click(rows(ctx.document)[0].querySelector('[data-action="refresh"]'));
  await flush();

  assert.equal(rows(ctx.document)[0].querySelector('[data-override="buyPrice"]').checked, true);
});

test('the lock survives a background poll, like the price it marks', async (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  editCell(ctx.document.querySelector('[data-field="buyPrice"]'), '3,000');
  await ctx.app.refresher.poll();

  assert.equal(rows(ctx.document)[0].querySelector('[data-override="buyPrice"]').checked, true);
});

/* ------------------------------------------------ item names in toasts --- */

test('a toast picks out the item name in its own element', async (t) => {
  const ctx = mountWith([{ ...PLATEBODY, buyPrice: 1 }]);
  t.after(ctx.cleanup);

  click(rows(ctx.document)[0].querySelector('[data-action="refresh"]'));
  await flush();

  const name = ctx.document.querySelector('.toast__name');
  assert.ok(name, 'the name should be its own element, not part of the sentence');
  assert.equal(name.textContent, 'Adamant platebody');
  assert.match(ctx.document.querySelector('.toast__message').textContent, /updated/);
});

test('every toast that names an item marks it', async (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  // Delete names the item.
  click(rows(ctx.document)[0].querySelector('[data-action="delete"]'));
  assert.equal(ctx.document.querySelector('.toast__name').textContent, 'Adamant platebody');
  click(ctx.document.querySelector('.toast__action'));
  ctx.app.toaster.clear();

  // So does releasing a custom price.
  editCell(ctx.document.querySelector('[data-field="buyPrice"]'), '3,000');
  click(rows(ctx.document)[0].querySelector('[data-action="refresh"]'));
  await flush();
  ctx.app.toaster.clear();

  toggle(rows(ctx.document)[0].querySelector('[data-override="buyPrice"]'), false);
  assert.equal(ctx.document.querySelector('.toast__name').textContent, 'Adamant platebody');
});

test('an item name is never parsed as markup', async (t) => {
  const ctx = mountWith([{ ...PLATEBODY, itemId: null, name: '<img src=x onerror=alert(1)>' }]);
  t.after(ctx.cleanup);

  click(rows(ctx.document)[0].querySelector('[data-action="delete"]'));

  const name = ctx.document.querySelector('.toast__name');
  assert.equal(name.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(name.querySelector('img'), null, 'the name is text, never markup');
});

test('a plain string message still works', (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  ctx.app.toaster.info('Nothing to report.');

  assert.equal(ctx.document.querySelector('.toast__message').textContent, 'Nothing to report.');
  assert.equal(ctx.document.querySelector('.toast__name'), null);
});

test('clicking into a price cell and out does not lock it', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  const cell = ctx.document.querySelector('[data-field="buyPrice"]');
  const box = () => rows(ctx.document)[0].querySelector('[data-override="buyPrice"]');

  // Focus and blur without typing, exactly as a stray click does.
  cell.focus();
  cell.dispatchEvent(new ctx.window.FocusEvent('focusout', { bubbles: true }));

  assert.equal(ctx.store.getItem('plate').overrides.buyPrice, false);
  assert.equal(box().checked, false, 'no lock for a click that changed nothing');
});

test('unlocking always says so, even when the price does not move', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  // Lock at a price, with no market price on record to restore.
  editCell(ctx.document.querySelector('[data-field="buyPrice"]'), '3,000');
  ctx.app.toaster.clear();

  toggle(rows(ctx.document)[0].querySelector('[data-override="buyPrice"]'), false);

  assert.equal(ctx.store.getItem('plate').overrides.buyPrice, false);
  assert.match(toastMessages(ctx.document).join(' '), /unlocked/);
});

test('clearing the box on an unlocked row reports nothing', (t) => {
  const ctx = mountWith([PLATEBODY]);
  t.after(ctx.cleanup);

  ctx.app.views.table.handlers.onToggleOverride('plate', 'buyPrice', false);

  assert.deepEqual(toastMessages(ctx.document), [], 'there was nothing to unlock');
});
