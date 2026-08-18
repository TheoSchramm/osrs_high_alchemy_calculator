/** Rune price, price basis, and the bulk actions. */

import { on, setText } from './dom.js';

export class SettingsView {
  /**
   * @param {object} config
   * @param {HTMLInputElement} config.runePriceInput
   * @param {HTMLSelectElement} config.priceBasisSelect
   * @param {HTMLButtonElement} [config.fetchRuneButton]
   * @param {HTMLButtonElement} [config.refreshAllButton]
   * @param {HTMLButtonElement} [config.clearAllButton]
   * @param {HTMLElement} [config.status]
   * @param {object} config.handlers
   * @param {(value: string) => void} config.handlers.onRunePriceChange
   * @param {(basis: string) => void} config.handlers.onPriceBasisChange
   * @param {() => void} [config.handlers.onFetchRunePrice]
   * @param {() => void} [config.handlers.onRefreshAll]
   * @param {() => void} [config.handlers.onClearAll]
   */
  constructor(config) {
    this.runePriceInput = config.runePriceInput;
    this.priceBasisSelect = config.priceBasisSelect;
    this.autoRefreshSelect = config.autoRefreshSelect ?? null;
    this.fetchRuneButton = config.fetchRuneButton ?? null;
    this.refreshAllButton = config.refreshAllButton ?? null;
    this.clearAllButton = config.clearAllButton ?? null;
    this.status = config.status ?? null;
    this.handlers = config.handlers ?? {};
    this.teardown = [];

    this._bind();
  }

  _bind() {
    const { handlers } = this;

    this.teardown.push(on(this.runePriceInput, 'input', () => {
      handlers.onRunePriceChange?.(this.runePriceInput.value);
    }));

    this.teardown.push(on(this.priceBasisSelect, 'change', () => {
      handlers.onPriceBasisChange?.(this.priceBasisSelect.value);
    }));

    if (this.autoRefreshSelect) {
      this.teardown.push(on(this.autoRefreshSelect, 'change', () => {
        handlers.onAutoRefreshChange?.(this.autoRefreshSelect.value);
      }));
    }

    if (this.fetchRuneButton) {
      this.teardown.push(on(this.fetchRuneButton, 'click', () => handlers.onFetchRunePrice?.()));
    }
    if (this.refreshAllButton) {
      this.teardown.push(on(this.refreshAllButton, 'click', () => handlers.onRefreshAll?.()));
    }
    if (this.clearAllButton) {
      this.teardown.push(on(this.clearAllButton, 'click', () => handlers.onClearAll?.()));
    }
  }

  /** @param {import('../state/store.js').AppState} state */
  render(state) {
    const doc = this.runePriceInput.ownerDocument;

    // Do not fight the user while they are typing in the field.
    if (doc.activeElement !== this.runePriceInput) {
      const value = String(state.runePrice);
      if (this.runePriceInput.value !== value) this.runePriceInput.value = value;
    }

    if (this.priceBasisSelect.value !== state.priceBasis) {
      this.priceBasisSelect.value = state.priceBasis;
    }

    if (this.autoRefreshSelect) {
      const interval = String(state.autoRefreshMs);
      if (this.autoRefreshSelect.value !== interval) this.autoRefreshSelect.value = interval;
    }

    if (this.refreshAllButton) {
      this.refreshAllButton.disabled = state.items.length === 0;
    }
    if (this.clearAllButton) {
      this.clearAllButton.disabled = state.items.length === 0;
    }
  }

  /** Replace the footer status line. */
  setStatus(message) {
    if (this.status) setText(this.status, message);
  }

  /** Disable the bulk buttons while a network action is in flight. */
  setBusy(isBusy) {
    for (const button of [this.fetchRuneButton, this.refreshAllButton]) {
      if (button) button.disabled = Boolean(isBusy);
    }
  }

  destroy() {
    for (const off of this.teardown) off();
    this.teardown = [];
  }
}
