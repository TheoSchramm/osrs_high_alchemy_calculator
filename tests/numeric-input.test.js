/**
 * Amount fields refuse anything that is not part of a number.
 *
 * "Number" here means a number as this app writes them, which includes the
 * shorthand the interface advertises under the add form: 10k, 1.5m, 1,234.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { isAmountText } from '../src/ui/numeric-input.js';
import { mountApp, rows } from './helpers/mount.js';

const PLATEBODY = {
  id: 'plate',
  itemId: 1123,
  name: 'Adamant platebody',
  buyPrice: 4000,
  alchPrice: 9600,
  quantity: 100,
};

/** Ask an element to insert `text`, the way typing or pasting would. */
function tryInsert(element, text, inputType = 'insertText') {
  const event = new element.ownerDocument.defaultView.InputEvent('beforeinput', {
    data: text,
    inputType,
    bubbles: true,
    cancelable: true,
  });
  element.dispatchEvent(event);
  return !event.defaultPrevented;
}

test('isAmountText accepts what the parser understands', () => {
  for (const text of ['1', '1234', '1,234', '1.5', '10k', '1.5m', '2B', '', '12,345,678']) {
    assert.equal(isAmountText(text), true, `${text} should be allowed`);
  }
});

test('isAmountText rejects anything else', () => {
  for (const text of ['a', 'abc', '10 k', '1-2', '<', '10$', 'e5', '1e3', '#', '½']) {
    assert.equal(isAmountText(text), false, `${text} should be refused`);
  }
});

test('the amount inputs refuse letters', (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  for (const id of ['buyPrice', 'alchPrice', 'quantity', 'runePrice']) {
    const input = ctx.document.querySelector(`#${id}`);
    assert.ok(input, `#${id} should exist`);
    assert.equal(tryInsert(input, 'a'), false, `#${id} should refuse a letter`);
    assert.equal(tryInsert(input, '7'), true, `#${id} should accept a digit`);
  }
});

test('the amount inputs keep the shorthand the form promises', (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const input = ctx.document.querySelector('#buyPrice');
  for (const text of ['1', '0', 'k', 'm', 'b', ',', '.']) {
    assert.equal(tryInsert(input, text), true, `${text} is part of an amount`);
  }
});

test('a pasted value is checked too', (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const input = ctx.document.querySelector('#runePrice');
  assert.equal(tryInsert(input, '1,234', 'insertFromPaste'), true);
  assert.equal(tryInsert(input, 'about 200gp', 'insertFromPaste'), false);
});

test('deleting is never blocked', (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const input = ctx.document.querySelector('#quantity');
  const event = new ctx.window.InputEvent('beforeinput', {
    inputType: 'deleteContentBackward',
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(event);

  assert.equal(event.defaultPrevented, false);
});

test('the editable table cells are guarded as well', (t) => {
  const ctx = mountApp({ initialState: { items: [PLATEBODY], runePrice: 200 } });
  t.after(ctx.cleanup);

  const row = rows(ctx.document)[0];

  for (const field of ['buyPrice', 'quantity']) {
    const cell = row.querySelector(`[data-field="${field}"]`);
    assert.equal(tryInsert(cell, 'x'), false, `${field} should refuse a letter`);
    assert.equal(tryInsert(cell, '5'), true, `${field} should accept a digit`);
  }
});

test('the item name cell still takes letters', (t) => {
  const ctx = mountApp({ initialState: { items: [PLATEBODY], runePrice: 200 } });
  t.after(ctx.cleanup);

  const name = rows(ctx.document)[0].querySelector('[data-field="name"]');
  assert.equal(tryInsert(name, 'Rune platebody'), true, 'names are not amounts');
});

test('the search box still takes letters', (t) => {
  const ctx = mountApp();
  t.after(ctx.cleanup);

  const search = ctx.document.querySelector('#itemName');
  assert.equal(tryInsert(search, 'Adamant'), true);
});
