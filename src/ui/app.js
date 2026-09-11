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
import { restrictToAmount, restrictAmountCells } from './numeric-input.js';
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
      onToggleOverride: (id, field, locked) => {
        const previous = store.getItem(id);
        if (!previous) return;

        store.setOverride(id, field, locked);

        // Ticking the box is silent: the tick is its own feedback and the price
        // does not move. Clearing it hands the row back to the market, which
        // does move the price, so that one is reported.
        //
        // Report the unlock itself, not a change of price. The two are not the
        // same: a row locked at the market price has nothing to restore, and
        // gating the message on the number moving meant the click looked like
        // it had done nothing.
        if (locked || !previous.overrides?.[field]) return;

        // The toast is the confirmation: the click lands at once and the way
        // back is a button on the message rather than a dialog in front of it.
        // Restoring both the price and the flag is what makes it a real undo -
        // putting the number back without the lock would leave the next
        // refresh free to overwrite it.
        toaster.info([{ name: previous.name }, ' unlocked.'], {
          actionLabel: 'Undo',
          onAction: () => store.updateItem(id, {
            [field]: previous[field],
            overrides: previous.overrides,
          }),
        });
      },
    },
  });

  const stats = new StatsView({
    totalProfit: qsOptional(root, '#totalProfit'),
    totalProfitNote: qsOptional(root, '#totalProfitNote'),
    totalXp: qsOptional(root, '#totalXp'),
    totalTime: qsOptional(root, '#totalTime'),
    totalCost: qsOptional(root, '#totalCost'),
    castRate: qsOptional(root, '#castRate'),
    totalSplit: qsOptional(root, '#totalSplit'),
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
      // `what` may carry an item name as its own segment.
      const prefix = Array.isArray(what) ? what : [what];
      toaster.error([...prefix, ` failed: ${describe(error)}`]);
      return { ok: false, value: null };
    }
  }

  function describe(error) {
    if (error?.status) return `the price API returned ${error.status}`;
    if (error?.name === 'PricesApiError') return 'could not reach the price API';
    return error?.message ?? 'unknown error';
  }

  /**
   * The nature rune's price from a snapshot, or null when nothing traded.
   *
   * `buildSnapshot` falls back to the shop value so an item row never shows a 0
   * buy price. That is right for an item and wrong for the rune: a nature rune
   * is worth 9 gp in a shop against a market price in the hundreds, and writing
   * that into the cost of every cast would treble the profit on screen.
   *
   * @param {import('../data/prices-api.js').ItemSnapshot|null|undefined} snapshot
   */
  function tradedRunePrice(snapshot) {
    const traded = snapshot?.instantBuy ?? snapshot?.instantSell ?? null;
    return traded === null ? null : (snapshot.buyPrice ?? null);
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
      toaster.info([{ name: item.name }, ' is not on the Grand Exchange.']);
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
    const lookup = await guard(['Refreshing ', { name: item.name }], () =>
      api.getSnapshot(item.itemId ?? item.name, { priceBasis: store.getState().priceBasis }));
    setRowBusy(id, false);

    if (!lookup.ok) return;

    const snapshot = lookup.value;
    if (!snapshot) {
      toaster.info(['No Grand Exchange data for ', { name: item.name }, '.']);
      return;
    }

    store.applySnapshot(id, snapshot);
    // Same bargain as a delete: it happens, and the message carries the way
    // back. `item` was read before the request, so it still holds the price and
    // the timestamp the row had before the market answered.
    toaster.success([
      { name: snapshot.name },
      ` updated (${formatNumber(snapshot.buyPrice ?? 0)} gp).`,
    ], {
      actionLabel: 'Undo',
      onAction: () => store.updateItem(id, item),
    });
  }

  async function refreshAll() {
    const ids = selectRefreshableIds(store.getState());

    settings.setBusy(true);
    // The nature rune goes in with the items rather than fetching separately.
    // It is half the cost of every cast, so an "update all prices" that left it
    // stale was reporting profit worked out against an old rune price.
    //
    // As one more id it costs nothing extra once the list is big enough for
    // PricesApi to pull the whole payload; below that threshold it is one more
    // small request - the same one the rune button makes on its own.
    const lookup = await guard('Refreshing prices', () =>
      api.getSnapshots([...ids, NATURE_RUNE_ITEM_ID], { priceBasis: store.getState().priceBasis }));
    settings.setBusy(false);

    if (!lookup.ok) return;
    const snapshots = lookup.value;

    let updated = 0;
    for (const item of store.getState().items) {
      const snapshot = item.itemId ? snapshots.get(item.itemId) : null;
      if (!snapshot) continue;
      store.applySnapshot(item.id, snapshot);
      updated += 1;
    }

    // A rune with no recent trades reports no price of its own; leave the one
    // already in Settings standing rather than writing a shop value over it.
    const runePrice = tradedRunePrice(snapshots.get(NATURE_RUNE_ITEM_ID));
    if (runePrice) store.setRunePrice(runePrice);

    const items = updated > 0
      ? `Refreshed ${updated} item${updated === 1 ? '' : 's'}`
      : 'No items with a Grand Exchange match to refresh';
    const report = runePrice
      ? `${items}. Nature rune ${formatNumber(runePrice)} gp.`
      : `${items}.`;

    if (updated > 0 || runePrice) toaster.success(report);
    else toaster.info(report);
  }

  async function fetchRunePrice() {
    settings.setBusy(true);
    const lookup = await guard('Nature rune lookup', () =>
      api.getSnapshot(NATURE_RUNE_ITEM_ID, { priceBasis: store.getState().priceBasis }));
    settings.setBusy(false);

    if (!lookup.ok) return;

    // Guarded rather than read straight off the snapshot: without this the
    // message below was unreachable, because a rune that had not traded still
    // reported its 9 gp shop value and that went into the cost of every cast.
    const runePrice = tradedRunePrice(lookup.value);
    if (!runePrice) {
      toaster.info('No recent nature rune trades to read a price from.');
      return;
    }

    store.setRunePrice(runePrice);
    toaster.success(`Nature rune price set to ${formatNumber(runePrice)} gp.`);
  }

  /** Delete immediately and offer an undo, rather than blocking on a confirm. */
  function deleteItem(id) {
    const item = store.getItem(id);
    if (!item) return;

    const index = store.indexOf(id);
    store.removeItem(id);

    toaster.show(['Removed ', { name: item.name }, '.'], {
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

  // Amount fields refuse anything that is not part of a number, in the form and
  // in the table's editable cells alike.
  const amountGuards = [
    ...['#buyPrice', '#alchPrice', '#quantity', '#runePrice']
      .map((selector) => qsOptional(root, selector))
      .filter(Boolean)
      .map((input) => restrictToAmount(input)),
    restrictAmountCells(qs(root, '#itemsBody'), ['buyPrice', 'quantity']),
  ];

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
      for (const removeGuard of amountGuards) removeGuard();
      refresher.stop();
      timers.clearInterval(ageTicker);
      doc.removeEventListener?.('visibilitychange', onVisibility);
      table.destroy();
      settings.destroy();
      addForm.destroy();
    },
  };
}
