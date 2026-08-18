/**
 * Application state.
 *
 * One observable store owns the whole app state. Views subscribe and re-render;
 * they never mutate state directly. Adding a feature means adding a method here
 * plus a view that reads the new field — no cross-talk between views.
 */

import { normalizeItem, applyFieldEdit, mergeSnapshot, createId } from '../core/items.js';
import { nextSortState } from '../core/sorting.js';
import { toNonNegativeInt } from '../core/format.js';
import {
  createDefaultState,
  loadState,
  saveState,
  clearState,
  PRICE_BASIS,
  AUTO_REFRESH_OPTIONS,
} from '../data/storage.js';

/**
 * @typedef {object} AppState
 * @property {import('../core/alchemy.js').AlchItem[]} items
 * @property {number} runePrice
 * @property {string} priceBasis one of {@link PRICE_BASIS}
 * @property {{field: string|null, direction: number}} sort
 */

export class AppStore {
  /**
   * @param {object} [options]
   * @param {Storage} [options.storage]  omit to run without persistence
   * @param {AppState} [options.initialState]
   */
  constructor(options = {}) {
    this.storage = options.storage ?? null;
    this.listeners = new Set();

    this.state = options.initialState
      ? { ...createDefaultState(), ...options.initialState }
      : this.storage
        ? loadState(this.storage)
        : createDefaultState();
  }

  /** @returns {AppState} the current state (treat as immutable) */
  getState() {
    return this.state;
  }

  /**
   * @param {(state: AppState) => void} listener called on every change
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Replace state with `patch` merged in, then persist and notify.
   * The single write path — every mutation below funnels through it.
   *
   * @param {Partial<AppState>} patch
   */
  commit(patch) {
    this.state = { ...this.state, ...patch };
    if (this.storage) saveState(this.storage, this.state);
    for (const listener of this.listeners) listener(this.state);
    return this.state;
  }

  /** @returns {import('../core/alchemy.js').AlchItem|undefined} */
  getItem(id) {
    return this.state.items.find((item) => item.id === id);
  }

  /**
   * @param {Partial<import('../core/alchemy.js').AlchItem>} partial
   * @returns {import('../core/alchemy.js').AlchItem} the stored item
   */
  addItem(partial) {
    const item = normalizeItem({ id: createId(), ...partial });
    this.commit({ items: [...this.state.items, item] });
    return item;
  }

  /**
   * Put an item back at a specific position. Used to undo a delete.
   *
   * @param {import('../core/alchemy.js').AlchItem} item
   * @param {number} [index] appended when out of range
   */
  insertItem(item, index) {
    const normalized = normalizeItem(item);
    const items = [...this.state.items];
    const at = Number.isInteger(index) && index >= 0 && index <= items.length
      ? index
      : items.length;

    items.splice(at, 0, normalized);
    this.commit({ items });
    return normalized;
  }

  /** Position of an item in the stored list, or -1. */
  indexOf(id) {
    return this.state.items.findIndex((item) => item.id === id);
  }

  /**
   * Shallow-merge a patch into one item.
   * @param {string} id
   * @param {Partial<import('../core/alchemy.js').AlchItem>} patch
   */
  updateItem(id, patch) {
    return this._replaceItem(id, (item) => normalizeItem({ ...item, ...patch }));
  }

  /**
   * Apply an inline table edit, parsing the raw typed value.
   * @param {string} id
   * @param {string} field
   * @param {unknown} value
   */
  editItemField(id, field, value) {
    return this._replaceItem(id, (item) => applyFieldEdit(item, field, value));
  }

  /**
   * Fold an API snapshot into an item.
   * @param {string} id
   * @param {import('../data/prices-api.js').ItemSnapshot|null} snapshot
   */
  applySnapshot(id, snapshot) {
    if (!snapshot) return null;
    return this._replaceItem(id, (item) => mergeSnapshot(item, snapshot));
  }

  removeItem(id) {
    const items = this.state.items.filter((item) => item.id !== id);
    if (items.length === this.state.items.length) return false;
    this.commit({ items });
    return true;
  }

  clearItems() {
    this.commit({ items: [] });
  }

  /** Replace the whole list, e.g. after an import. */
  setItems(items) {
    this.commit({ items: (items ?? []).map((item) => normalizeItem(item)) });
  }

  setRunePrice(value) {
    this.commit({ runePrice: toNonNegativeInt(value) });
  }

  setPriceBasis(basis) {
    if (!Object.values(PRICE_BASIS).includes(basis)) return;
    this.commit({ priceBasis: basis });
  }

  /**
   * How often prices refresh on their own. 0 turns it off.
   * Only the offered intervals are accepted.
   * @param {number|string} value
   */
  setAutoRefreshMs(value) {
    const ms = Number(value);
    if (!AUTO_REFRESH_OPTIONS.includes(ms)) return;
    this.commit({ autoRefreshMs: ms });
  }

  /** Header click: sort by `field`, flipping direction if already active. */
  toggleSort(field) {
    this.commit({ sort: nextSortState(this.state.sort, field) });
  }

  /** Wipe persisted data and return to defaults. */
  reset() {
    if (this.storage) clearState(this.storage);
    this.state = createDefaultState();
    if (this.storage) saveState(this.storage, this.state);
    for (const listener of this.listeners) listener(this.state);
  }

  _replaceItem(id, transform) {
    const index = this.state.items.findIndex((item) => item.id === id);
    if (index === -1) return null;

    const updated = transform(this.state.items[index]);
    const items = [...this.state.items];
    items[index] = updated;
    this.commit({ items });
    return updated;
  }
}
