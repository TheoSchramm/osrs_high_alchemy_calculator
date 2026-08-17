/**
 * Test doubles for the prices API.
 *
 * The fixture mirrors the real payload shape returned by
 * https://prices.runescape.wiki/api/v1/osrs — see tests/live/api.live.js, which
 * asserts that the real service still matches this shape.
 */

/** Raw `/mapping` entries, exactly as the API serialises them. */
export const MAPPING_FIXTURE = [
  {
    examine: 'A series of connected metal rings.',
    id: 1123,
    members: false,
    lowalch: 3840,
    limit: 125,
    value: 9600,
    highalch: 5760,
    icon: 'Adamant platebody.png',
    name: 'Adamant platebody',
  },
  {
    examine: "A powerful bow.",
    id: 855,
    members: false,
    lowalch: 512,
    limit: 1000,
    value: 1280,
    highalch: 768,
    icon: 'Yew longbow.png',
    name: 'Yew longbow',
  },
  {
    examine: 'A woodcutters axe.',
    id: 1359,
    members: false,
    lowalch: 8320,
    limit: 40,
    value: 20_800,
    highalch: 12_480,
    icon: 'Rune axe.png',
    name: 'Rune axe',
  },
  {
    examine: 'Used for High Level Alchemy.',
    id: 561,
    members: false,
    lowalch: 3,
    limit: 18_000,
    value: 9,
    highalch: 5,
    icon: 'Nature rune.png',
    name: 'Nature rune',
  },
  {
    examine: 'An unalchemisable curiosity.',
    id: 995,
    members: false,
    lowalch: 0,
    limit: 0,
    value: 1,
    highalch: 0,
    icon: 'Coins 1000.png',
    name: 'Coins',
  },
];

/** Raw `/latest` prices keyed by item id. */
export const LATEST_FIXTURE = {
  1123: { high: 4200, highTime: 1_700_000_100, low: 4100, lowTime: 1_700_000_050 },
  855: { high: 320, highTime: 1_700_000_200, low: 300, lowTime: 1_700_000_150 },
  1359: { high: 14_000, highTime: 1_700_000_300, low: 13_500, lowTime: 1_700_000_250 },
  561: { high: 212, highTime: 1_700_000_400, low: 208, lowTime: 1_700_000_350 },
  // 995 deliberately absent: an item with no recent trades.
};

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/**
 * A `fetch` stub that serves the fixtures and records every call.
 *
 * @param {object} [options]
 * @param {typeof MAPPING_FIXTURE} [options.mapping]
 * @param {typeof LATEST_FIXTURE} [options.latest]
 * @param {(url: string) => ({status?: number, body?: unknown, throws?: Error})|null} [options.override]
 */
export function createFakeFetch(options = {}) {
  const mapping = options.mapping ?? MAPPING_FIXTURE;
  const latest = options.latest ?? LATEST_FIXTURE;
  const calls = [];

  const fetchImpl = async (url) => {
    calls.push(String(url));

    const override = options.override?.(String(url));
    if (override) {
      if (override.throws) throw override.throws;
      return jsonResponse(override.body ?? {}, { status: override.status ?? 200 });
    }

    if (url.includes('/mapping')) {
      return jsonResponse(mapping);
    }

    if (url.includes('/latest')) {
      const match = /[?&]id=(\d+)/.exec(url);
      if (match) {
        const id = Number(match[1]);
        return jsonResponse({ data: latest[id] ? { [id]: latest[id] } : {} });
      }
      return jsonResponse({ data: latest });
    }

    return jsonResponse({ error: 'not found' }, { status: 404 });
  };

  fetchImpl.calls = calls;
  /** Requests whose URL contains `fragment`. */
  fetchImpl.callsMatching = (fragment) => calls.filter((url) => url.includes(fragment));
  return fetchImpl;
}
