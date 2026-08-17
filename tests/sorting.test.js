import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sortItems,
  nextSortState,
  isSortableField,
  SORT_ACCESSORS,
  SORT_DIRECTIONS,
} from '../src/core/sorting.js';

const context = { runePrice: 200 };

const items = [
  { id: '1', name: 'Yew longbow', buyPrice: 300, alchPrice: 768, quantity: 50 },
  { id: '2', name: 'adamant platebody', buyPrice: 4000, alchPrice: 9600, quantity: 100 },
  { id: '3', name: 'Rune axe', buyPrice: 14_000, alchPrice: 12_480, quantity: 10 },
];

const names = (list) => list.map((item) => item.name);
const ids = (list) => list.map((item) => item.id);

test('sortItems returns a new array and leaves the input alone', () => {
  const input = [...items];
  const sorted = sortItems(input, { field: 'name', direction: SORT_DIRECTIONS.ASC }, context);

  assert.notEqual(sorted, input);
  assert.deepEqual(ids(input), ['1', '2', '3'], 'the source order is preserved');
});

test('sortItems by name is case-insensitive', () => {
  const sorted = sortItems(items, { field: 'name', direction: SORT_DIRECTIONS.ASC }, context);
  assert.deepEqual(names(sorted), ['adamant platebody', 'Rune axe', 'Yew longbow']);
});

test('sortItems by a derived column (profit)', () => {
  // profits: yew (268*50)=13,400 | plate (5400*100)=540,000 | rune axe (-1720*10)=-17,200
  const asc = sortItems(items, { field: 'profit', direction: SORT_DIRECTIONS.ASC }, context);
  assert.deepEqual(ids(asc), ['3', '1', '2']);

  const desc = sortItems(items, { field: 'profit', direction: SORT_DIRECTIONS.DESC }, context);
  assert.deepEqual(ids(desc), ['2', '1', '3']);
});

test('sortItems by profit respects the current rune price', () => {
  const cheap = sortItems(items, { field: 'profit', direction: SORT_DIRECTIONS.DESC }, { runePrice: 0 });
  const pricey = sortItems(items, { field: 'profit', direction: SORT_DIRECTIONS.DESC }, { runePrice: 5000 });
  assert.notDeepEqual(ids(cheap), ids(pricey));
});

test('sortItems by spend columns', () => {
  const byItems = sortItems(items, { field: 'costItems', direction: SORT_DIRECTIONS.DESC }, context);
  assert.deepEqual(ids(byItems), ['2', '3', '1']); // 400k, 140k, 15k

  const byRunes = sortItems(items, { field: 'costRunes', direction: SORT_DIRECTIONS.DESC }, context);
  assert.deepEqual(ids(byRunes), ['2', '1', '3']); // scales with quantity
});

test('sortItems is stable for equal keys', () => {
  const tied = [
    { id: 'a', name: 'A', buyPrice: 0, alchPrice: 100, quantity: 1 },
    { id: 'b', name: 'B', buyPrice: 0, alchPrice: 100, quantity: 1 },
    { id: 'c', name: 'C', buyPrice: 0, alchPrice: 100, quantity: 1 },
  ];
  const sorted = sortItems(tied, { field: 'profit', direction: SORT_DIRECTIONS.ASC }, context);
  assert.deepEqual(ids(sorted), ['a', 'b', 'c']);
});

test('sortItems without a sort field keeps insertion order', () => {
  assert.deepEqual(ids(sortItems(items, null, context)), ['1', '2', '3']);
  assert.deepEqual(ids(sortItems(items, { field: null, direction: 1 }, context)), ['1', '2', '3']);
});

test('sortItems ignores unknown fields', () => {
  assert.deepEqual(ids(sortItems(items, { field: 'nope', direction: 1 }, context)), ['1', '2', '3']);
});

test('sortItems handles empty and missing input', () => {
  assert.deepEqual(sortItems([], { field: 'profit', direction: 1 }, context), []);
  assert.deepEqual(sortItems(null, { field: 'profit', direction: 1 }, context), []);
});

test('nextSortState: first click ascending, second flips', () => {
  const first = nextSortState(null, 'profit');
  assert.deepEqual(first, { field: 'profit', direction: SORT_DIRECTIONS.ASC });

  const second = nextSortState(first, 'profit');
  assert.deepEqual(second, { field: 'profit', direction: SORT_DIRECTIONS.DESC });

  const third = nextSortState(second, 'profit');
  assert.deepEqual(third, { field: 'profit', direction: SORT_DIRECTIONS.ASC });
});

test('nextSortState: a new column restarts ascending', () => {
  const state = { field: 'profit', direction: SORT_DIRECTIONS.DESC };
  assert.deepEqual(nextSortState(state, 'name'), { field: 'name', direction: SORT_DIRECTIONS.ASC });
});

test('nextSortState: unknown fields leave the state alone', () => {
  const state = { field: 'profit', direction: SORT_DIRECTIONS.ASC };
  assert.equal(nextSortState(state, 'bogus'), state);
});

test('every sortable field has an accessor and vice versa', () => {
  for (const field of Object.keys(SORT_ACCESSORS)) {
    assert.ok(isSortableField(field), `${field} should be sortable`);
  }
  assert.equal(isSortableField('somethingElse'), false);
  assert.equal(isSortableField(undefined), false);
});
