/**
 * Read-only views over {@link import('./store.js').AppState}.
 *
 * Views call these instead of doing their own maths, so the table, the totals
 * panel and any future chart all agree on the numbers.
 */

import { computeItem, computeTotals } from '../core/alchemy.js';
import { sortItems } from '../core/sorting.js';

/** The calculation context derived from state. */
export function selectContext(state) {
  return { runePrice: state.runePrice };
}

/**
 * Items in display order, each paired with its derived figures.
 *
 * @param {import('./store.js').AppState} state
 * @returns {{item: import('../core/alchemy.js').AlchItem, derived: import('../core/alchemy.js').AlchTotals}[]}
 */
export function selectRows(state) {
  const context = selectContext(state);
  return sortItems(state.items, state.sort, context).map((item) => ({
    item,
    derived: computeItem(item, context),
  }));
}

/** @returns {import('../core/alchemy.js').AlchTotals} */
export function selectTotals(state) {
  return computeTotals(state.items, selectContext(state));
}

/** Item ids known to the price API, for a bulk refresh. */
export function selectRefreshableIds(state) {
  return state.items.map((item) => item.itemId).filter((id) => Number.isFinite(id));
}

/** The most profitable row, or null when the table is empty. */
export function selectBestRow(state) {
  const rows = selectRows(state);
  if (rows.length === 0) return null;
  return rows.reduce((best, row) => (row.derived.profit > best.derived.profit ? row : best));
}
