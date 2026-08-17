/**
 * Persistence.
 *
 * Nothing here touches `localStorage` directly — a Web Storage compatible
 * object is always passed in. That keeps the module testable in Node and lets
 * the app degrade gracefully when storage is unavailable (private browsing).
 */

import { normalizeItems } from '../core/items.js';
import { DEFAULT_RUNE_PRICE } from '../core/alchemy.js';
import { toNonNegativeInt } from '../core/format.js';
import { isSortableField, SORT_DIRECTIONS } from '../core/sorting.js';

export const STATE_KEY = 'osrs-alch:state:v2';
export const MAPPING_CACHE_KEY = 'osrs-alch:mapping:v1';

/** Keys written by version 1 of the app, read once and then migrated. */
export const LEGACY_ITEMS_KEY = 'alchItems';
export const LEGACY_RUNE_PRICE_KEY = 'runePrice';

/** Which Grand Exchange price is treated as the cost to buy an item. */
export const PRICE_BASIS = Object.freeze({
  /** Instant-buy: what you pay to get the item now. The realistic cost. */
  INSTANT_BUY: 'high',
  /** Instant-sell: what sellers are dumping at. Optimistic, needs an offer. */
  INSTANT_SELL: 'low',
});

/** @returns {import('../state/store.js').AppState} */
export function createDefaultState() {
  return {
    items: [],
    runePrice: DEFAULT_RUNE_PRICE,
    priceBasis: PRICE_BASIS.INSTANT_BUY,
    sort: { field: null, direction: SORT_DIRECTIONS.ASC },
  };
}

/**
 * An in-memory stand-in for `localStorage`, used by tests and as a fallback
 * when the real thing throws (Safari private mode, disabled storage).
 *
 * @param {Record<string, string>} [seed]
 */
export function createMemoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => void map.clear(),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

/**
 * Return `window.localStorage` if it actually works, otherwise a memory store.
 * Probing with a real write is the only reliable check.
 */
export function resolveStorage(candidate = globalThis.localStorage) {
  try {
    const probe = '__osrs_alch_probe__';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return candidate;
  } catch {
    return createMemoryStorage();
  }
}

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded or storage disabled: the app keeps working in memory.
    return false;
  }
}

/**
 * Load persisted state, migrating a v1 save if that is all we find.
 *
 * @param {Storage} storage
 * @returns {import('../state/store.js').AppState}
 */
export function loadState(storage) {
  const defaults = createDefaultState();
  const saved = readJson(storage, STATE_KEY);

  if (saved && typeof saved === 'object') {
    return hydrate(saved, defaults);
  }

  const legacy = readLegacyState(storage);
  return legacy ? hydrate(legacy, defaults) : defaults;
}

/** Read the v1 `alchItems` / `runePrice` keys, if present. */
function readLegacyState(storage) {
  const legacyItems = readJson(storage, LEGACY_ITEMS_KEY);
  const legacyRune = storage.getItem?.(LEGACY_RUNE_PRICE_KEY);

  if (!Array.isArray(legacyItems) && legacyRune === null) return null;

  return {
    items: Array.isArray(legacyItems) ? legacyItems : [],
    runePrice: legacyRune,
  };
}

function hydrate(saved, defaults) {
  // `Number(null)` and `Number('')` are 0, not NaN — reject those explicitly so
  // a missing value falls back to the default instead of silently becoming free.
  const rawRunePrice = saved.runePrice;
  const runePrice = rawRunePrice === null || rawRunePrice === undefined || rawRunePrice === ''
    ? Number.NaN
    : Number(rawRunePrice);

  const sortField = saved.sort?.field;
  const sort = isSortableField(sortField)
    ? {
        field: sortField,
        direction: saved.sort.direction === SORT_DIRECTIONS.DESC
          ? SORT_DIRECTIONS.DESC
          : SORT_DIRECTIONS.ASC,
      }
    : defaults.sort;

  const priceBasis = Object.values(PRICE_BASIS).includes(saved.priceBasis)
    ? saved.priceBasis
    : defaults.priceBasis;

  return {
    items: normalizeItems(saved.items),
    // `parseFloat(null)` is NaN, and NaN is not caught by `??` — check finiteness.
    runePrice: Number.isFinite(runePrice) && runePrice >= 0
      ? Math.round(runePrice)
      : defaults.runePrice,
    priceBasis,
    sort,
  };
}

/**
 * Persist state. Returns false when the write was rejected.
 *
 * @param {Storage} storage
 * @param {import('../state/store.js').AppState} state
 */
export function saveState(storage, state) {
  return writeJson(storage, STATE_KEY, {
    version: 2,
    items: state.items,
    runePrice: toNonNegativeInt(state.runePrice),
    priceBasis: state.priceBasis,
    sort: state.sort,
  });
}

/** Remove every key this app owns, including the v1 ones. */
export function clearState(storage) {
  for (const key of [STATE_KEY, MAPPING_CACHE_KEY, LEGACY_ITEMS_KEY, LEGACY_RUNE_PRICE_KEY]) {
    try {
      storage.removeItem(key);
    } catch {
      /* nothing useful to do */
    }
  }
}

/**
 * A tiny TTL cache backed by any Web Storage object.
 *
 * @param {Storage} storage
 * @param {{ ttlMs?: number, now?: () => number }} [options]
 */
export function createJsonCache(storage, options = {}) {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const now = options.now ?? (() => Date.now());

  return {
    get(key) {
      const entry = readJson(storage, key);
      if (!entry || typeof entry !== 'object') return null;
      if (!Number.isFinite(entry.savedAt) || now() - entry.savedAt > ttlMs) return null;
      return entry.value ?? null;
    },
    set(key, value) {
      return writeJson(storage, key, { savedAt: now(), value });
    },
    delete(key) {
      try {
        storage.removeItem(key);
      } catch {
        /* nothing useful to do */
      }
    },
  };
}
