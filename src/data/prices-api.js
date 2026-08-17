/**
 * Client for the OSRS Wiki real-time prices API.
 *
 * https://prices.runescape.wiki/api/v1/osrs
 *
 * `fetch` and the cache are injected, so tests drive this with a stub and never
 * touch the network. The item mapping (~4,600 entries) is fetched once and then
 * cached, since it only changes on game updates.
 */

import { PRICE_BASIS } from './storage.js';

export const DEFAULT_BASE_URL = 'https://prices.runescape.wiki/api/v1/osrs';

const WIKI_IMAGE_BASE = 'https://oldschool.runescape.wiki/images';
const RUNELITE_ICON_BASE = 'https://static.runelite.net/cache/item/icon';

/** Above this many ids it is cheaper to pull the whole `/latest` payload. */
const BULK_FETCH_THRESHOLD = 4;

/**
 * @typedef {object} MappingEntry
 * @property {number} id
 * @property {string} name
 * @property {number} highAlch
 * @property {number} lowAlch
 * @property {number} value
 * @property {number} limit    GE buy limit per 4 hours
 * @property {boolean} members
 * @property {string} icon     absolute image URL
 */

/**
 * @typedef {object} ItemSnapshot
 * @property {number} itemId
 * @property {string} name
 * @property {number} highAlch
 * @property {number} lowAlch
 * @property {number} limit
 * @property {boolean} members
 * @property {string} icon
 * @property {number|null} instantBuy  most recent buy price (API `high`)
 * @property {number|null} instantSell most recent sell price (API `low`)
 * @property {number|null} buyPrice    whichever of the two the price basis selects
 */

export class PricesApiError extends Error {
  constructor(message, { status = null, url = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'PricesApiError';
    this.status = status;
    this.url = url;
  }
}

/** Build the wiki image URL for a mapping entry's icon filename. */
export function wikiIconUrl(iconFilename) {
  if (!iconFilename) return null;
  return `${WIKI_IMAGE_BASE}/${encodeURIComponent(String(iconFilename).replace(/ /g, '_'))}`;
}

/** Fallback icon served by RuneLite's cache, keyed by item id. */
export function runeliteIconUrl(itemId) {
  return Number.isFinite(Number(itemId))
    ? `${RUNELITE_ICON_BASE}/${Number(itemId)}.png`
    : null;
}

export class PricesApi {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch]
   * @param {string} [options.baseUrl]
   * @param {{get(key: string): unknown, set(key: string, value: unknown): unknown}} [options.cache]
   * @param {string} [options.cacheKey]
   */
  constructor(options = {}) {
    // `undefined` means "not supplied" and picks up the global; an explicit
    // null disables network access entirely (useful in tests).
    this.fetch = options.fetch === undefined ? globalThis.fetch?.bind(globalThis) : options.fetch;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.cache = options.cache ?? null;
    this.cacheKey = options.cacheKey ?? 'osrs-alch:mapping:v1';

    /** @type {MappingEntry[]|null} */
    this._mapping = null;
    /** @type {Map<string, MappingEntry>|null} */
    this._index = null;
    /** @type {Promise<MappingEntry[]>|null} in-flight request, shared by callers */
    this._mappingRequest = null;
  }

  async _getJson(path) {
    const url = `${this.baseUrl}${path}`;
    if (typeof this.fetch !== 'function') {
      throw new PricesApiError('No fetch implementation available', { url });
    }

    let response;
    try {
      response = await this.fetch(url, { headers: { Accept: 'application/json' } });
    } catch (cause) {
      throw new PricesApiError(`Network request failed: ${url}`, { url, cause });
    }

    if (!response?.ok) {
      throw new PricesApiError(`Request failed with status ${response?.status}`, {
        status: response?.status ?? null,
        url,
      });
    }

    try {
      return await response.json();
    } catch (cause) {
      throw new PricesApiError(`Malformed JSON from ${url}`, { url, cause });
    }
  }

  /**
   * The full item mapping. Cached in memory for the session and in the injected
   * cache across sessions; concurrent callers share one request.
   *
   * @returns {Promise<MappingEntry[]>}
   */
  async getMapping() {
    if (this._mapping) return this._mapping;

    const cached = this.cache?.get(this.cacheKey);
    if (Array.isArray(cached) && cached.length > 0) {
      return this._adoptMapping(cached);
    }

    this._mappingRequest ??= this._getJson('/mapping')
      .then((raw) => {
        const entries = normalizeMapping(raw);
        this.cache?.set(this.cacheKey, entries);
        return this._adoptMapping(entries);
      })
      .finally(() => {
        this._mappingRequest = null;
      });

    return this._mappingRequest;
  }

  _adoptMapping(entries) {
    this._mapping = entries;
    this._index = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
    return this._mapping;
  }

  /** Exact (case-insensitive) name lookup. @returns {Promise<MappingEntry|null>} */
  async findByName(name) {
    if (!name) return null;
    await this.getMapping();
    return this._index.get(String(name).trim().toLowerCase()) ?? null;
  }

  /** @returns {Promise<MappingEntry|null>} */
  async findById(itemId) {
    const id = Number(itemId);
    if (!Number.isFinite(id)) return null;
    const mapping = await this.getMapping();
    return mapping.find((entry) => entry.id === id) ?? null;
  }

  /**
   * Fuzzy name search for autocomplete. Exact match first, then prefix
   * matches, then substring matches; alphabetical within each tier.
   *
   * @param {string} query
   * @param {{ limit?: number, alchableOnly?: boolean }} [options]
   * @returns {Promise<MappingEntry[]>}
   */
  async search(query, options = {}) {
    const limit = options.limit ?? 12;
    const term = String(query ?? '').trim().toLowerCase();
    if (!term) return [];

    const mapping = await this.getMapping();
    return searchMapping(mapping, term, { limit, alchableOnly: options.alchableOnly });
  }

  /**
   * Latest instant-buy / instant-sell prices.
   *
   * @param {number[]} [itemIds] omit to fetch every item
   * @returns {Promise<Map<number, {high: number|null, low: number|null, highTime: number|null, lowTime: number|null}>>}
   */
  async getLatestPrices(itemIds) {
    const ids = (itemIds ?? []).map(Number).filter((id) => Number.isFinite(id));

    if (ids.length > 0 && ids.length < BULK_FETCH_THRESHOLD) {
      const results = await Promise.all(
        ids.map(async (id) => [id, await this._getJson(`/latest?id=${id}`)]),
      );
      const prices = new Map();
      for (const [id, payload] of results) {
        prices.set(id, normalizePriceEntry(payload?.data?.[id]));
      }
      return prices;
    }

    const payload = await this._getJson('/latest');
    const data = payload?.data ?? {};
    const wanted = ids.length > 0 ? new Set(ids) : null;
    const prices = new Map();

    for (const [key, entry] of Object.entries(data)) {
      const id = Number(key);
      if (wanted && !wanted.has(id)) continue;
      prices.set(id, normalizePriceEntry(entry));
    }
    return prices;
  }

  /**
   * Everything the app needs about one item, by name or by id.
   *
   * @param {string|number} nameOrId
   * @param {{ priceBasis?: string }} [options]
   * @returns {Promise<ItemSnapshot|null>} null when the item is unknown
   */
  async getSnapshot(nameOrId, options = {}) {
    const entry = typeof nameOrId === 'number'
      ? await this.findById(nameOrId)
      : await this.findByName(nameOrId);
    if (!entry) return null;

    const prices = await this.getLatestPrices([entry.id]);
    return buildSnapshot(entry, prices.get(entry.id), options.priceBasis);
  }

  /**
   * Snapshots for many items in one round trip.
   *
   * @param {number[]} itemIds
   * @param {{ priceBasis?: string }} [options]
   * @returns {Promise<Map<number, ItemSnapshot>>}
   */
  async getSnapshots(itemIds, options = {}) {
    const ids = [...new Set((itemIds ?? []).map(Number).filter(Number.isFinite))];
    if (ids.length === 0) return new Map();

    await this.getMapping();
    const prices = await this.getLatestPrices(ids);
    const snapshots = new Map();

    for (const id of ids) {
      const entry = this._mapping.find((candidate) => candidate.id === id);
      if (!entry) continue;
      snapshots.set(id, buildSnapshot(entry, prices.get(id), options.priceBasis));
    }
    return snapshots;
  }

  /** Discard cached mapping so the next call re-fetches. */
  invalidateMapping() {
    this._mapping = null;
    this._index = null;
    this.cache?.delete?.(this.cacheKey);
  }
}

/**
 * Trim the raw `/mapping` payload down to the fields the app uses and resolve
 * icon filenames to absolute URLs. `examine` text is dropped — it is roughly a
 * third of the payload and nothing renders it.
 *
 * @param {unknown} raw
 * @returns {MappingEntry[]}
 */
export function normalizeMapping(raw) {
  if (!Array.isArray(raw)) return [];

  const entries = [];
  for (const item of raw) {
    const id = Number(item?.id);
    const name = String(item?.name ?? '').trim();
    if (!Number.isFinite(id) || !name) continue;

    entries.push({
      id,
      name,
      highAlch: toInt(item.highalch),
      lowAlch: toInt(item.lowalch),
      value: toInt(item.value),
      limit: toInt(item.limit),
      members: Boolean(item.members),
      icon: wikiIconUrl(item.icon) ?? runeliteIconUrl(id),
    });
  }
  return entries;
}

/**
 * Rank mapping entries against a lowercase search term.
 * Exported separately so it can be tested without an API instance.
 *
 * @param {MappingEntry[]} mapping
 * @param {string} term already lowercased and trimmed
 * @param {{ limit?: number, alchableOnly?: boolean }} [options]
 */
export function searchMapping(mapping, term, options = {}) {
  const limit = options.limit ?? 12;
  const exact = [];
  const prefix = [];
  const substring = [];

  for (const entry of mapping) {
    if (options.alchableOnly && entry.highAlch <= 0) continue;

    const name = entry.name.toLowerCase();
    if (name === term) exact.push(entry);
    else if (name.startsWith(term)) prefix.push(entry);
    else if (name.includes(term)) substring.push(entry);
  }

  const byName = (a, b) => a.name.localeCompare(b.name);
  prefix.sort(byName);
  substring.sort(byName);

  return [...exact, ...prefix, ...substring].slice(0, limit);
}

/**
 * Combine a mapping entry with its latest prices.
 *
 * @param {MappingEntry} entry
 * @param {{high: number|null, low: number|null}} [price]
 * @param {string} [priceBasis]
 * @returns {ItemSnapshot}
 */
export function buildSnapshot(entry, price, priceBasis = PRICE_BASIS.INSTANT_BUY) {
  const instantBuy = price?.high ?? null;
  const instantSell = price?.low ?? null;

  const preferred = priceBasis === PRICE_BASIS.INSTANT_SELL ? instantSell : instantBuy;
  // If the preferred side has no recent trade, fall back to the other side and
  // finally to the shop value so a row never ends up with a 0 buy price.
  const buyPrice = preferred ?? (priceBasis === PRICE_BASIS.INSTANT_SELL ? instantBuy : instantSell)
    ?? (entry.value > 0 ? entry.value : null);

  return {
    itemId: entry.id,
    name: entry.name,
    highAlch: entry.highAlch,
    lowAlch: entry.lowAlch,
    limit: entry.limit,
    members: entry.members,
    icon: entry.icon,
    instantBuy,
    instantSell,
    buyPrice,
  };
}

function normalizePriceEntry(entry) {
  return {
    high: toNullableInt(entry?.high),
    low: toNullableInt(entry?.low),
    highTime: toNullableInt(entry?.highTime),
    lowTime: toNullableInt(entry?.lowTime),
  };
}

function toInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function toNullableInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}
