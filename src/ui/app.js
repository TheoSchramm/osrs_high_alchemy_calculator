/**
 * Composition root.
 *
 * Wires the store to the views and owns the asynchronous actions (everything
 * that talks to the price API). Views stay dumb; the store stays synchronous;
 * all the awaiting happens here.
 */

import { qs, qsOptional } from './dom.js';
import { ItemTableView } from './item-table.js';
import { StatsView } from './stats-panel.js';
import { SettingsView } from './settings-panel.js';
import { createAddItemForm } from './add-item-form.js';
import { createToaster } from './toasts.js';
import { parseAmount, formatNumber } from '../core/format.js';
import { NATURE_RUNE_ITEM_ID } from '../core/alchemy.js';
import { selectRefreshableIds } from '../state/selectors.js';
import { AutoRefresher } from '../state/auto-refresh.js';

/** How often the "Updated" labels are re-stamped. */
const AGE_TICK_MS = 15_000;

/**
 * @param {object} config
 * @param {Document|HTMLElement} config.root
 * @param {import('../state/store.js').AppStore} config.store
 * @param {import('../data/prices-api.js').PricesApi} config.api
 * @param {ReturnType<typeof createToaster>} [config.toaster]
 * @param {number} [config.searchDebounceMs]
 */
export function createApp(config) {
  const { root, store, api } = config;

  const toaster = config.toaster
    ?? createToaster(qs(root, '#toasts'), { timeoutMs: config.toastTimeoutMs });

  const timers = config.timers ?? globalThis;
  const doc = root.ownerDocument ?? root;

  /** @type {AutoRefresher} assigned below; the settings handler closes over it. */
  let refresher;
  /** Errors are reported once per outage, not once per poll. */
  let autoRefreshFailing = false;

  /* ---------------------------------------------------------------- views */

  const table = new ItemTableView({
    table: qs(root, '#itemsTable'),
    body: qs(root, '#itemsBody'),
    foot: qs(root, '#itemsFoot'),
    template: qs(root, '#itemRowTemplate'),
    emptyState: qsOptional(root, '#emptyState'),
    rowCount: qsOptional(root, '#rowCount'),
    now: config.now,
    handlers: {
      onSort: (field) => store.toggleSort(field),
      onEdit: (id, field, value) => store.editItemField(id, field, value),
      onRefresh: (id) => void refreshItem(id),
      onDelete: (id) => deleteItem(id),
    },
  });

  const stats = new StatsView({
    totalProfit: qsOptional(root, '#totalProfit'),
    totalProfitNote: qsOptional(root, '#totalProfitNote'),
    totalXp: qsOptional(root, '#totalXp'),
    totalTime: qsOptional(root, '#totalTime'),
    totalCost: qsOptional(root, '#totalCost'),
    totalCasts: qsOptional(root, '#totalCasts'),
  });

  const settings = new SettingsView({
    runePriceInput: qs(root, '#runePrice'),
    priceBasisSelect: qs(root, '#priceBasis'),
    autoRefreshSelect: qsOptional(root, '#autoRefresh'),
    fetchRuneButton: qsOptional(root, '#fetchRunePrice'),
    refreshAllButton: qsOptional(root, '#refreshAll'),
    clearAllButton: qsOptional(root, '#clearAll'),
    status: qsOptional(root, '#dataStatus'),
    handlers: {
      onRunePriceChange: (value) => store.setRunePrice(value),
      onPriceBasisChange: (basis) => store.setPriceBasis(basis),
      onAutoRefreshChange: (value) => {
        store.setAutoRefreshMs(value);
        refresher.reschedule();
      },
      onFetchRunePrice: () => void fetchRunePrice(),
      onRefreshAll: () => void refreshAll(),
      onClearAll: () => clearAll(),
    },
  });

  refresher = new AutoRefresher({
    store,
    api,
    timers,
    // A hidden tab should not poll a public API in the background.
    isVisible: config.isVisible ?? (() => doc.visibilityState !== 'hidden'),
    onEvent: (event) => {
      if (event.type === 'success') {
        autoRefreshFailing = false;
        settings.setStatus(
          `Prices updated ${new Date().toLocaleTimeString()} - ${event.count} item${event.count === 1 ? '' : 's'}.`,
        );
        render();
      } else if (event.type === 'error') {
        // Quiet after the first failure: a broken connection should not stack
        // up a toast every interval.
        if (!autoRefreshFailing) {
          autoRefreshFailing = true;
          toaster.error(`Auto-refresh failed: ${describe(event.error)}. Retrying.`);
        }
        settings.setStatus('Auto-refresh could not reach the price API.');
      }
    },
  });

  const addForm = createAddItemForm(root, {
    debounceMs: config.searchDebounceMs,
    search: (query) => api.search(query, { limit: 10 }),
    onSubmit: (draft) => void addItem(draft),
  });

  /* -------------------------------------------------------------- helpers */

  /**
   * Run an async action, turning any failure into a toast.
   * Returns `{ ok, value }` so callers can tell "it failed" (already reported)
   * apart from "it succeeded and found nothing" (worth its own message).
   */
  async function guard(what, action) {
    try {
      return { ok: true, value: await action() };
    } catch (error) {
      toaster.error(`${what} failed: ${describe(error)}`);
      return { ok: false, value: null };
    }
  }

  function describe(error) {
    if (error?.status) return `the price API returned ${error.status}`;
    if (error?.name === 'PricesApiError') return 'could not reach the price API';
    return error?.message ?? 'unknown error';
  }

  function setRowBusy(id, isBusy) {
    const button = table.rows.get(id)?.querySelector('[data-action="refresh"]');
    button?.classList.toggle('is-busy', isBusy);
  }

  /* -------------------------------------------------------------- actions */

  /**
   * Add a row, then fill in whatever the user left blank from the API.
   * Values the user typed always win over API values.
   */
  async function addItem(draft) {
    const typedBuy = draft.buyPrice !== '';
    const typedAlch = draft.alchPrice !== '';
    const entry = draft.entry;

    const item = store.addItem({
      name: entry?.name ?? draft.name,
      itemId: entry?.id ?? null,
      icon: entry?.icon ?? null,
      buyPrice: parseAmount(draft.buyPrice),
      alchPrice: typedAlch ? parseAmount(draft.alchPrice) : (entry?.highAlch ?? 0),
      quantity: parseAmount(draft.quantity) || 1,
    });

    if (typedBuy && typedAlch && entry) return item;

    const lookup = await guard('Price lookup', () =>
      api.getSnapshot(entry?.id ?? draft.name, { priceBasis: store.getState().priceBasis }));
    if (!lookup.ok) return item;

    const snapshot = lookup.value;
    if (!snapshot) {
      toaster.info(`"${item.name}" is not on the Grand Exchange — using the values you entered.`);
      return item;
    }

    store.updateItem(item.id, {
      itemId: snapshot.itemId,
      name: snapshot.name,
      icon: snapshot.icon,
      buyPrice: typedBuy ? item.buyPrice : (snapshot.buyPrice ?? item.buyPrice),
      alchPrice: typedAlch ? item.alchPrice : (snapshot.highAlch || item.alchPrice),
      updatedAt: Date.now(),
    });

    return store.getItem(item.id);
  }

  async function refreshItem(id) {
    const item = store.getItem(id);
    if (!item) return;

    setRowBusy(id, true);
    const lookup = await guard(`Refreshing ${item.name}`, () =>
      api.getSnapshot(item.itemId ?? item.name, { priceBasis: store.getState().priceBasis }));
    setRowBusy(id, false);

    if (!lookup.ok) return;

    const snapshot = lookup.value;
    if (!snapshot) {
      toaster.info(`No Grand Exchange data for "${item.name}".`);
      return;
    }

    // Explicit refresh: the user asked for market data, so it replaces edits.
    store.applySnapshot(id, snapshot, { force: true });
    toaster.success(`${snapshot.name} updated — buy ${formatNumber(snapshot.buyPrice ?? 0)} gp.`);
  }

  async function refreshAll() {
    const ids = selectRefreshableIds(store.getState());
    if (ids.length === 0) {
      toaster.info('No items with a Grand Exchange match to refresh.');
      return;
    }

    settings.setBusy(true);
    const lookup = await guard('Refreshing prices', () =>
      api.getSnapshots(ids, { priceBasis: store.getState().priceBasis }));
    settings.setBusy(false);

    if (!lookup.ok) return;
    const snapshots = lookup.value;

    let updated = 0;
    for (const item of store.getState().items) {
      const snapshot = item.itemId ? snapshots.get(item.itemId) : null;
      if (!snapshot) continue;
      store.applySnapshot(item.id, snapshot, { force: true });
      updated += 1;
    }

    toaster.success(`Refreshed ${updated} item${updated === 1 ? '' : 's'}.`);
  }

  async function fetchRunePrice() {
    settings.setBusy(true);
    const lookup = await guard('Nature rune lookup', () =>
      api.getSnapshot(NATURE_RUNE_ITEM_ID, { priceBasis: store.getState().priceBasis }));
    settings.setBusy(false);

    if (!lookup.ok) return;

    const snapshot = lookup.value;
    if (!snapshot?.buyPrice) {
      toaster.info('No recent nature rune trades to read a price from.');
      return;
    }

    store.setRunePrice(snapshot.buyPrice);
    toaster.success(`Nature rune price set to ${formatNumber(snapshot.buyPrice)} gp.`);
  }

  /** Delete immediately and offer an undo, rather than blocking on a confirm. */
  function deleteItem(id) {
    const item = store.getItem(id);
    if (!item) return;

    const index = store.indexOf(id);
    store.removeItem(id);

    toaster.show(`Removed ${item.name}.`, {
      actionLabel: 'Undo',
      onAction: () => store.insertItem(item, index),
    });
  }

  function clearAll() {
    const previous = store.getState().items;
    if (previous.length === 0) return;

    store.clearItems();
    toaster.show(`Cleared ${previous.length} item${previous.length === 1 ? '' : 's'}.`, {
      actionLabel: 'Undo',
      onAction: () => store.setItems(previous),
    });
  }

  /* ------------------------------------------------------------ rendering */

  function render(state = store.getState()) {
    table.render(state);
    stats.render(state);
    settings.render(state);
  }

  const unsubscribe = store.subscribe(render);
  render();

  // Relative times go stale on their own, so re-stamp them on a timer. This
  // touches only those cells, never the rest of the table.
  const ageTicker = timers.setInterval(() => table.renderAges(), config.ageTickMs ?? AGE_TICK_MS);

  const onVisibility = () => refresher.handleVisibilityChange();
  doc.addEventListener?.('visibilitychange', onVisibility);
  refresher.start();

  return {
    render,
    toaster,
    views: { table, stats, settings, addForm },
    refresher,
    actions: { addItem, refreshItem, refreshAll, fetchRunePrice, deleteItem, clearAll },
    destroy() {
      unsubscribe();
      refresher.stop();
      timers.clearInterval(ageTicker);
      doc.removeEventListener?.('visibilitychange', onVisibility);
      table.destroy();
      settings.destroy();
      addForm.destroy();
    },
  };
}
