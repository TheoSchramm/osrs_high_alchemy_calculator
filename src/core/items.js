/**
 * The item record: creation, normalisation and legacy migration.
 *
 * `normalizeItem` is the single funnel every item passes through — whether it
 * came from the API, a user edit, or a save file written by an older version.
 * Anything downstream can therefore assume the shape is complete and numeric.
 */

import { parseAmount, toNonNegativeInt } from './format.js';

/** Fields the user may edit inline in the table. */
export const EDITABLE_FIELDS = Object.freeze(['name', 'buyPrice', 'alchPrice', 'quantity']);

/**
 * Fields a refresh can overwrite, and which therefore need pinning when the
 * user types over them.
 *
 * Only the buy price. High alch is a fixed property of the item rather than a
 * market price, so a refresh never changes it and it needs no pin. Quantity
 * and name have no market value to conflict with either.
 */
export const OVERRIDABLE_FIELDS = Object.freeze(['buyPrice']);

/** @returns {{buyPrice: boolean}} */
function normalizeOverrides(raw) {
  return { buyPrice: Boolean((raw ?? {}).buyPrice) };
}

let idCounter = 0;

/** Stable unique row id, with a fallback for environments without `crypto`. */
export function createId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  idCounter += 1;
  return `item-${Date.now().toString(36)}-${idCounter}`;
}

/**
 * Coerce arbitrary input into a complete {@link import('./alchemy.js').AlchItem}.
 *
 * Understands the v1 save format (`vendor` / `alch`) so old localStorage data
 * keeps working after an upgrade.
 *
 * @param {Record<string, unknown>} raw
 * @returns {import('./alchemy.js').AlchItem}
 */
export function normalizeItem(raw = {}) {
  const source = raw ?? {};

  // v1 saves used `vendor` and `alch`; v2 uses `buyPrice` and `alchPrice`.
  const buySource = source.buyPrice ?? source.vendor ?? 0;
  const alchSource = source.alchPrice ?? source.alch ?? source.highalch ?? 0;

  const itemId = Number(source.itemId ?? source.gameId ?? source.osrsId);

  return {
    id: typeof source.id === 'string' && source.id ? source.id : createId(),
    itemId: Number.isFinite(itemId) && itemId > 0 ? itemId : null,
    name: String(source.name ?? '').trim(),
    buyPrice: toNonNegativeInt(buySource),
    alchPrice: toNonNegativeInt(alchSource),
    quantity: toNonNegativeInt(source.quantity ?? 1),
    icon: typeof source.icon === 'string' && source.icon ? source.icon : null,
    updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : null,
    // Which fields the user has typed over, so a background refresh does not
    // silently discard them.
    overrides: normalizeOverrides(source.overrides),
    // The last price the Grand Exchange reported, kept even while overridden so
    // the UI can show what the market says and offer it back.
    marketBuyPrice: Number.isFinite(Number(source.marketBuyPrice))
      ? Number(source.marketBuyPrice)
      : null,
  };
}

/**
 * Normalise a saved list, dropping unusable entries and de-duplicating ids.
 *
 * @param {unknown} rawList
 * @returns {import('./alchemy.js').AlchItem[]}
 */
export function normalizeItems(rawList) {
  if (!Array.isArray(rawList)) return [];

  const seen = new Set();
  const items = [];

  for (const raw of rawList) {
    if (!raw || typeof raw !== 'object') continue;
    const item = normalizeItem(raw);
    if (!item.name) continue;
    if (seen.has(item.id)) item.id = createId();
    seen.add(item.id);
    items.push(item);
  }

  return items;
}

/**
 * Apply a single field edit, parsing the raw string the user typed.
 *
 * @param {import('./alchemy.js').AlchItem} item
 * @param {string} field one of {@link EDITABLE_FIELDS}
 * @param {unknown} value
 * @returns {import('./alchemy.js').AlchItem} a new item; the input is untouched
 */
export function applyFieldEdit(item, field, value) {
  if (!EDITABLE_FIELDS.includes(field)) return item;

  if (field === 'name') {
    const name = String(value ?? '').trim();
    return name ? { ...item, name } : item;
  }

  const next = { ...item, [field]: Math.max(0, parseAmount(value)) };

  // Typing a price pins it: from here on only an explicit refresh may replace it.
  if (OVERRIDABLE_FIELDS.includes(field)) {
    next.overrides = { ...normalizeOverrides(item.overrides), [field]: true };
  }

  return next;
}

/**
 * Merge an API snapshot into an item without clobbering data the API lacks.
 *
 * The buy price the user has typed is left alone unless `force` is set. That is
 * the difference between a background poll, which must never discard someone's
 * work, and an explicit Refresh, which was asked for and should win.
 *
 * The high alch value is never changed either way; see below.
 *
 * @param {import('./alchemy.js').AlchItem} item
 * @param {import('../data/prices-api.js').ItemSnapshot|null} snapshot
 * @param {{ now?: number, force?: boolean }} [options]
 */
export function mergeSnapshot(item, snapshot, options = {}) {
  if (!snapshot) return item;

  const now = options.now ?? Date.now();
  const force = Boolean(options.force);
  const overrides = normalizeOverrides(item.overrides);

  const marketBuy = Number.isFinite(snapshot.buyPrice) && snapshot.buyPrice > 0
    ? snapshot.buyPrice
    : item.marketBuyPrice;

  // High alch is set by the game, not by the market: it is the same number
  // every time we ask. Fill it only when the row does not have one yet, so a
  // refresh can complete a hand-added item without ever rewriting a value that
  // is already correct.
  const alchPrice = item.alchPrice > 0
    ? item.alchPrice
    : (Number.isFinite(snapshot.highAlch) ? Math.max(0, snapshot.highAlch) : 0);

  const keepBuy = overrides.buyPrice && !force;

  return {
    ...item,
    itemId: snapshot.itemId ?? item.itemId,
    name: snapshot.name || item.name,
    icon: snapshot.icon || item.icon,
    alchPrice,
    buyPrice: keepBuy ? item.buyPrice : (marketBuy ?? item.buyPrice),
    marketBuyPrice: marketBuy ?? null,
    // An explicit refresh hands the row back to the market.
    overrides: force ? normalizeOverrides(null) : overrides,
    updatedAt: now,
  };
}
