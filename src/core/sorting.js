/**
 * Table sorting.
 *
 * Sorting reads from the same derived figures the table renders, so a new
 * sortable column is one entry in {@link SORT_ACCESSORS} plus a `data-sort`
 * attribute in the markup — no comparator branching anywhere else.
 */

import { computeItem } from './alchemy.js';

export const SORT_DIRECTIONS = Object.freeze({ ASC: 1, DESC: -1 });

/**
 * Field name -> value used for comparison. Numeric accessors return a number,
 * text accessors return a string; the comparator picks the right ordering.
 */
export const SORT_ACCESSORS = Object.freeze({
  name: (item) => item.name ?? '',
  buyPrice: (item) => item.buyPrice ?? 0,
  alchPrice: (item) => item.alchPrice ?? 0,
  quantity: (item) => item.quantity ?? 0,
  costItems: (item, derived) => derived.costItems,
  costRunes: (item, derived) => derived.costRunes,
  profit: (item, derived) => derived.profit,
  profitPerCast: (item, derived) => derived.profitPerCast,
  roi: (item, derived) => derived.roi,
  // Never refreshed sorts as oldest, not newest.
  updatedAt: (item) => item.updatedAt ?? 0,
});

/** @returns {boolean} whether `field` can be sorted on. */
export function isSortableField(field) {
  return Object.hasOwn(SORT_ACCESSORS, field);
}

/**
 * Next sort state for a header click: first click sorts ascending, clicking the
 * active column flips direction.
 *
 * @param {{field: string|null, direction: number}|null} current
 * @param {string} field
 */
export function nextSortState(current, field) {
  if (!isSortableField(field)) return current ?? { field: null, direction: SORT_DIRECTIONS.ASC };

  if (current?.field === field) {
    return { field, direction: -current.direction };
  }
  return { field, direction: SORT_DIRECTIONS.ASC };
}

/**
 * Return a sorted copy of `items`. The input array is never mutated, so the
 * stored insertion order survives a sort.
 *
 * @param {import('./alchemy.js').AlchItem[]} items
 * @param {{field: string|null, direction: number}|null} sort
 * @param {{ runePrice?: number }} [context]
 */
export function sortItems(items, sort, context = {}) {
  const list = [...(items ?? [])];
  if (!sort?.field || !isSortableField(sort.field)) return list;

  const accessor = SORT_ACCESSORS[sort.field];
  const direction = sort.direction === SORT_DIRECTIONS.DESC ? -1 : 1;

  // Derive once per item rather than once per comparison.
  const keyed = list.map((item, index) => ({
    item,
    index,
    key: accessor(item, computeItem(item, context)),
  }));

  keyed.sort((a, b) => {
    const result = compareValues(a.key, b.key);
    // Fall back to original position so equal rows never shuffle.
    return result !== 0 ? result * direction : a.index - b.index;
  });

  return keyed.map((entry) => entry.item);
}

function compareValues(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}
