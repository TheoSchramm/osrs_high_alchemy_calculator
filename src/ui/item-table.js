/**
 * The items table view.
 *
 * Renders state into the table and reports user intent back through handlers.
 * It never mutates state itself, and never builds HTML from strings — rows are
 * cloned from the `<template>` in index.html.
 */

import { qs, qsa, on, setText, setHidden, setValueTone, cloneTemplate } from './dom.js';
import { formatNumber, formatSigned } from '../core/format.js';
import { selectRows, selectTotals } from '../state/selectors.js';
import { EDITABLE_FIELDS } from '../core/items.js';

/** Cells rendered from derived figures, and how each is formatted. */
const DERIVED_CELLS = {
  costItems: { format: formatNumber, tone: false },
  costRunes: { format: formatNumber, tone: false },
  profitPerCast: { format: formatSigned, tone: true },
  profit: { format: formatSigned, tone: true },
};

const FIELD_LABELS = {
  name: 'Name',
  buyPrice: 'Buy price',
  alchPrice: 'High alch value',
  quantity: 'Quantity',
};

export class ItemTableView {
  /**
   * @param {object} config
   * @param {HTMLTableElement} config.table
   * @param {HTMLElement} config.body
   * @param {HTMLElement} config.foot
   * @param {HTMLTemplateElement} config.template
   * @param {HTMLElement} [config.emptyState]
   * @param {HTMLElement} [config.rowCount]
   * @param {object} config.handlers
   * @param {(field: string) => void} config.handlers.onSort
   * @param {(id: string, field: string, value: string) => void} config.handlers.onEdit
   * @param {(id: string) => void} config.handlers.onRefresh
   * @param {(id: string) => void} config.handlers.onDelete
   */
  constructor(config) {
    this.table = config.table;
    this.body = config.body;
    this.foot = config.foot;
    this.template = config.template;
    this.emptyState = config.emptyState ?? null;
    this.rowCount = config.rowCount ?? null;
    this.handlers = config.handlers ?? {};

    /** @type {Map<string, HTMLTableRowElement>} row id -> element */
    this.rows = new Map();
    this.teardown = [];

    this._bindHeader();
    this._bindBody();
  }

  _bindHeader() {
    const head = qs(this.table, 'thead');

    this.teardown.push(on(head, 'click', (event) => {
      const th = event.target.closest('th[data-sort]');
      if (th) this.handlers.onSort?.(th.dataset.sort);
    }));

    // Headers are clickable, so they must also be operable from the keyboard.
    for (const th of qsa(head, 'th[data-sort]')) {
      th.tabIndex = 0;
      this.teardown.push(on(th, 'keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.handlers.onSort?.(th.dataset.sort);
        }
      }));
    }
  }

  _bindBody() {
    // One listener per event type for the whole table, rather than per row.
    this.teardown.push(on(this.body, 'click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;

      const id = button.closest('tr')?.dataset.id;
      if (!id) return;

      if (button.dataset.action === 'refresh') this.handlers.onRefresh?.(id);
      if (button.dataset.action === 'delete') this.handlers.onDelete?.(id);
    }));

    // `blur` does not bubble; `focusout` does.
    this.teardown.push(on(this.body, 'focusout', (event) => {
      const cell = event.target.closest?.('[data-field]');
      if (!cell) return;

      const id = cell.closest('tr')?.dataset.id;
      const field = cell.dataset.field;
      if (id && EDITABLE_FIELDS.includes(field)) {
        this.handlers.onEdit?.(id, field, cell.textContent.trim());
      }
    }));

    this.teardown.push(on(this.body, 'keydown', (event) => {
      const cell = event.target.closest?.('[data-field]');
      if (!cell) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        cell.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        // Restore the rendered value, then commit it (a no-op) on blur.
        setText(cell, cell.dataset.rendered ?? '');
        cell.blur();
      }
    }));
  }

  /** @param {import('../state/store.js').AppState} state */
  render(state) {
    const rows = selectRows(state);
    const totals = selectTotals(state);

    this._renderSortIndicators(state.sort);
    this._renderRows(rows);
    this._renderTotals(totals, rows.length);
  }

  _renderSortIndicators(sort) {
    for (const th of qsa(this.table, 'thead th[data-sort]')) {
      if (th.dataset.sort === sort?.field) {
        th.setAttribute('aria-sort', sort.direction === -1 ? 'descending' : 'ascending');
      } else {
        th.removeAttribute('aria-sort');
      }
    }
  }

  _renderRows(rows) {
    const seen = new Set();

    for (const { item, derived } of rows) {
      seen.add(item.id);
      const tr = this.rows.get(item.id) ?? this._createRow(item.id);
      this._updateRow(tr, item, derived);
      // Re-appending an existing node moves it: this applies the sort order.
      this.body.append(tr);
    }

    for (const [id, tr] of this.rows) {
      if (!seen.has(id)) {
        tr.remove();
        this.rows.delete(id);
      }
    }
  }

  _createRow(id) {
    const tr = cloneTemplate(this.template, 'tr');
    tr.dataset.id = id;
    this.rows.set(id, tr);
    return tr;
  }

  _updateRow(tr, item, derived) {
    const icon = qs(tr, '.cell-item__icon');
    const iconSrc = item.icon ?? '';
    if (icon.getAttribute('src') !== iconSrc) icon.setAttribute('src', iconSrc);
    icon.alt = item.icon ? `${item.name} icon` : '';

    this._updateEditableCell(tr, 'name', item.name, item.name);
    this._updateEditableCell(tr, 'buyPrice', formatNumber(item.buyPrice), item.name);
    this._updateEditableCell(tr, 'alchPrice', formatNumber(item.alchPrice), item.name);
    this._updateEditableCell(tr, 'quantity', formatNumber(item.quantity), item.name);

    for (const [key, { format, tone }] of Object.entries(DERIVED_CELLS)) {
      const cell = qs(tr, `[data-cell="${key}"]`);
      setText(cell, format(derived[key]));
      if (tone) setValueTone(cell, derived[key]);
    }

    const refreshButton = qs(tr, '[data-action="refresh"]');
    // Only items the API recognises can be refreshed.
    refreshButton.disabled = !item.itemId;
    refreshButton.title = item.itemId
      ? `Refresh prices for ${item.name}`
      : 'Added manually — no Grand Exchange match to refresh';
  }

  _updateEditableCell(tr, field, value, itemName) {
    const cell = qs(tr, `[data-field="${field}"]`);
    cell.dataset.rendered = value;
    cell.setAttribute('aria-label', `${FIELD_LABELS[field]} for ${itemName}`);

    // Never overwrite the cell the user is currently typing in.
    if (cell.ownerDocument.activeElement === cell) return;
    setText(cell, value);
  }

  _renderTotals(totals, rowCount) {
    setHidden(this.foot, rowCount === 0);
    setHidden(this.emptyState, rowCount > 0);

    if (this.rowCount) {
      setText(
        this.rowCount,
        rowCount === 0
          ? ''
          : `${rowCount} item${rowCount === 1 ? '' : 's'} · ${formatNumber(totals.casts)} casts`,
      );
    }

    for (const [key, { format, tone }] of Object.entries(DERIVED_CELLS)) {
      const cell = this.foot.querySelector(`[data-total="${key}"]`);
      if (!cell) continue;
      setText(cell, format(totals[key]));
      if (tone) setValueTone(cell, totals[key]);
    }
  }

  /** Detach every listener. Useful in tests and for future hot-swapping. */
  destroy() {
    for (const off of this.teardown) off();
    this.teardown = [];
  }
}
