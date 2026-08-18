import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createId,
  normalizeItem,
  normalizeItems,
  applyFieldEdit,
  mergeSnapshot,
  EDITABLE_FIELDS,
} from '../src/core/items.js';

test('createId returns unique strings', () => {
  const ids = new Set(Array.from({ length: 200 }, () => createId()));
  assert.equal(ids.size, 200);
});

test('normalizeItem fills in every field', () => {
  const item = normalizeItem({ name: 'Yew longbow' });

  assert.ok(item.id);
  assert.equal(item.name, 'Yew longbow');
  assert.equal(item.buyPrice, 0);
  assert.equal(item.alchPrice, 0);
  assert.equal(item.quantity, 1, 'quantity defaults to 1');
  assert.equal(item.icon, null);
  assert.equal(item.itemId, null);
  assert.equal(item.updatedAt, null);
});

test('normalizeItem migrates the v1 field names', () => {
  const item = normalizeItem({
    id: 'legacy-1',
    name: 'Adamant platebody',
    vendor: 4000,
    alch: 9600,
    quantity: 25,
    icon: 'https://example.test/icon.png',
  });

  assert.equal(item.id, 'legacy-1', 'existing ids are preserved');
  assert.equal(item.buyPrice, 4000);
  assert.equal(item.alchPrice, 9600);
  assert.equal(item.quantity, 25);
  assert.equal(item.icon, 'https://example.test/icon.png');
});

test('normalizeItem prefers v2 fields when both are present', () => {
  const item = normalizeItem({ name: 'x', vendor: 1, buyPrice: 2, alch: 3, alchPrice: 4 });
  assert.equal(item.buyPrice, 2);
  assert.equal(item.alchPrice, 4);
});

test('normalizeItem coerces junk into safe numbers', () => {
  const item = normalizeItem({
    name: '  Rune axe  ',
    buyPrice: 'abc',
    alchPrice: NaN,
    quantity: -10,
  });

  assert.equal(item.name, 'Rune axe', 'names are trimmed');
  assert.equal(item.buyPrice, 0);
  assert.equal(item.alchPrice, 0);
  assert.equal(item.quantity, 0, 'negative quantities clamp to zero');
});

test('normalizeItem accepts typed amounts as strings', () => {
  const item = normalizeItem({ name: 'x', buyPrice: '1,234', alchPrice: '10k', quantity: '2' });
  assert.equal(item.buyPrice, 1234);
  assert.equal(item.alchPrice, 10_000);
  assert.equal(item.quantity, 2);
});

test('normalizeItems drops unusable entries', () => {
  const items = normalizeItems([
    { name: 'Keep me' },
    { name: '   ' }, // blank name
    null,
    'not an object',
    { vendor: 100 }, // no name
  ]);

  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Keep me');
});

test('normalizeItems de-duplicates ids', () => {
  const items = normalizeItems([
    { id: 'dup', name: 'A' },
    { id: 'dup', name: 'B' },
  ]);
  assert.notEqual(items[0].id, items[1].id);
});

test('normalizeItems on non-arrays yields an empty list', () => {
  assert.deepEqual(normalizeItems(null), []);
  assert.deepEqual(normalizeItems({}), []);
  assert.deepEqual(normalizeItems(undefined), []);
});

test('applyFieldEdit parses numeric fields and does not mutate', () => {
  const original = normalizeItem({ name: 'Rune axe', buyPrice: 100 });
  const edited = applyFieldEdit(original, 'buyPrice', '12,500');

  assert.equal(edited.buyPrice, 12_500);
  assert.equal(original.buyPrice, 100, 'the original item is untouched');
});

test('applyFieldEdit clamps negatives to zero', () => {
  const item = normalizeItem({ name: 'x', quantity: 5 });
  assert.equal(applyFieldEdit(item, 'quantity', '-3').quantity, 0);
});

test('applyFieldEdit ignores unknown fields and blank names', () => {
  const item = normalizeItem({ name: 'Rune axe' });
  assert.equal(applyFieldEdit(item, 'profit', 999), item, 'derived fields are not editable');
  assert.equal(applyFieldEdit(item, 'name', '   ').name, 'Rune axe', 'a blank name is rejected');
});

test('EDITABLE_FIELDS is the documented set', () => {
  assert.deepEqual([...EDITABLE_FIELDS], ['name', 'buyPrice', 'alchPrice', 'quantity']);
});

test('mergeSnapshot overwrites prices but keeps the quantity', () => {
  const item = normalizeItem({ name: 'Adamant platebody', quantity: 40, buyPrice: 1, alchPrice: 1 });
  const merged = mergeSnapshot(
    item,
    {
      itemId: 1123,
      name: 'Adamant platebody',
      highAlch: 9600,
      buyPrice: 4200,
      icon: 'https://example.test/plate.png',
    },
    { now: 1000 },
  );

  assert.equal(merged.itemId, 1123);
  assert.equal(merged.alchPrice, 9600);
  assert.equal(merged.buyPrice, 4200);
  assert.equal(merged.quantity, 40, 'user-entered quantity survives a refresh');
  assert.equal(merged.updatedAt, 1000);
});

test('mergeSnapshot keeps existing values when the API has none', () => {
  const item = normalizeItem({ name: 'x', buyPrice: 500, alchPrice: 900 });
  const merged = mergeSnapshot(item, { itemId: 5, name: 'x', highAlch: 0, buyPrice: null });

  assert.equal(merged.buyPrice, 500);
  assert.equal(merged.alchPrice, 900);
});

test('mergeSnapshot with no snapshot is a no-op', () => {
  const item = normalizeItem({ name: 'x' });
  assert.equal(mergeSnapshot(item, null), item);
});

/* ------------------------------------------------- hand-typed overrides --- */

test('a new item pins nothing', () => {
  const item = normalizeItem({ name: 'Rune axe', buyPrice: 100 });
  assert.deepEqual(item.overrides, { buyPrice: false, alchPrice: false });
  assert.equal(item.marketBuyPrice, null);
});

test('editing a price pins that field only', () => {
  const item = normalizeItem({ name: 'Rune axe', buyPrice: 100, alchPrice: 200 });

  const edited = applyFieldEdit(item, 'buyPrice', '3000');
  assert.deepEqual(edited.overrides, { buyPrice: true, alchPrice: false });

  const both = applyFieldEdit(edited, 'alchPrice', '9000');
  assert.deepEqual(both.overrides, { buyPrice: true, alchPrice: true });
});

test('editing quantity or name pins nothing', () => {
  const item = normalizeItem({ name: 'Rune axe', quantity: 1 });

  assert.equal(applyFieldEdit(item, 'quantity', '50').overrides.buyPrice, false);
  assert.equal(applyFieldEdit(item, 'name', 'Rune scimitar').overrides.buyPrice, false);
});

test('a background merge leaves a pinned price alone', () => {
  const item = applyFieldEdit(
    normalizeItem({ name: 'Adamant platebody', buyPrice: 4200, alchPrice: 5760 }),
    'buyPrice',
    '3000',
  );

  const merged = mergeSnapshot(item, {
    itemId: 1123,
    name: 'Adamant platebody',
    highAlch: 5760,
    buyPrice: 4200,
  });

  assert.equal(merged.buyPrice, 3000, 'the typed value survives');
  assert.equal(merged.marketBuyPrice, 4200, 'the market price is still recorded');
  assert.equal(merged.overrides.buyPrice, true, 'and it stays pinned');
  assert.ok(merged.updatedAt > 0, 'the row still counts as refreshed');
});

test('a forced merge replaces a pinned price and unpins it', () => {
  const item = applyFieldEdit(
    normalizeItem({ name: 'Adamant platebody', buyPrice: 4200 }),
    'buyPrice',
    '3000',
  );

  const merged = mergeSnapshot(
    item,
    { itemId: 1123, name: 'Adamant platebody', highAlch: 5760, buyPrice: 4200 },
    { force: true },
  );

  assert.equal(merged.buyPrice, 4200);
  assert.equal(merged.overrides.buyPrice, false, 'the row tracks the market again');
});

test('a pinned alch value is independent of a pinned buy price', () => {
  const item = applyFieldEdit(
    normalizeItem({ name: 'x', buyPrice: 100, alchPrice: 200 }),
    'alchPrice',
    '9999',
  );

  const merged = mergeSnapshot(item, { itemId: 1, name: 'x', highAlch: 5760, buyPrice: 4200 });

  assert.equal(merged.alchPrice, 9999, 'the typed alch value survives');
  assert.equal(merged.buyPrice, 4200, 'the un-pinned buy price still updates');
});

test('overrides survive being saved and reloaded', () => {
  const edited = applyFieldEdit(normalizeItem({ name: 'x', buyPrice: 1 }), 'buyPrice', '500');
  const reloaded = normalizeItems(JSON.parse(JSON.stringify([edited])));

  assert.equal(reloaded[0].overrides.buyPrice, true);
  assert.equal(reloaded[0].buyPrice, 500);
});
