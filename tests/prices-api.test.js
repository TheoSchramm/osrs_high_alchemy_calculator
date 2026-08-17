import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PricesApi,
  PricesApiError,
  normalizeMapping,
  searchMapping,
  buildSnapshot,
  wikiIconUrl,
  runeliteIconUrl,
} from '../src/data/prices-api.js';
import { PRICE_BASIS, createJsonCache, createMemoryStorage } from '../src/data/storage.js';
import { createFakeFetch, MAPPING_FIXTURE, LATEST_FIXTURE } from './helpers/fake-api.js';

function makeApi(overrides = {}) {
  const fetchImpl = overrides.fetch ?? createFakeFetch();
  return { api: new PricesApi({ fetch: fetchImpl, ...overrides }), fetchImpl };
}

test('normalizeMapping keeps the useful fields and drops examine text', () => {
  const entries = normalizeMapping(MAPPING_FIXTURE);

  assert.equal(entries.length, MAPPING_FIXTURE.length);
  const plate = entries.find((e) => e.id === 1123);
  assert.deepEqual(plate, {
    id: 1123,
    name: 'Adamant platebody',
    highAlch: 5760,
    lowAlch: 3840,
    value: 9600,
    limit: 125,
    members: false,
    icon: 'https://oldschool.runescape.wiki/images/Adamant_platebody.png',
  });
  assert.equal('examine' in plate, false, 'examine text is not carried around');
});

test('normalizeMapping skips malformed entries', () => {
  const entries = normalizeMapping([
    { id: 1, name: 'Good' },
    { id: 'not a number', name: 'Bad id' },
    { id: 2, name: '' },
    null,
  ]);
  assert.deepEqual(entries.map((e) => e.name), ['Good']);
  assert.deepEqual(normalizeMapping('nope'), []);
});

test('icon URL helpers', () => {
  assert.equal(wikiIconUrl('Rune axe.png'), 'https://oldschool.runescape.wiki/images/Rune_axe.png');
  assert.equal(wikiIconUrl(''), null);
  assert.equal(runeliteIconUrl(1123), 'https://static.runelite.net/cache/item/icon/1123.png');
  assert.equal(runeliteIconUrl('nope'), null);
});

test('getMapping fetches once and reuses the result', async () => {
  const { api, fetchImpl } = makeApi();

  await api.getMapping();
  await api.getMapping();
  await api.findByName('Rune axe');

  assert.equal(fetchImpl.callsMatching('/mapping').length, 1);
});

test('concurrent getMapping calls share a single request', async () => {
  const { api, fetchImpl } = makeApi();
  await Promise.all([api.getMapping(), api.getMapping(), api.getMapping()]);
  assert.equal(fetchImpl.callsMatching('/mapping').length, 1);
});

test('the mapping cache survives a new API instance', async () => {
  const storage = createMemoryStorage();
  const cache = createJsonCache(storage, { ttlMs: 60_000 });

  const first = createFakeFetch();
  await new PricesApi({ fetch: first, cache }).getMapping();
  assert.equal(first.callsMatching('/mapping').length, 1);

  const second = createFakeFetch();
  const entries = await new PricesApi({ fetch: second, cache }).getMapping();
  assert.equal(second.callsMatching('/mapping').length, 0, 'served from cache');
  assert.equal(entries.length, MAPPING_FIXTURE.length);
});

test('invalidateMapping forces a refetch', async () => {
  const cache = createJsonCache(createMemoryStorage());
  const fetchImpl = createFakeFetch();
  const api = new PricesApi({ fetch: fetchImpl, cache });

  await api.getMapping();
  api.invalidateMapping();
  await api.getMapping();

  assert.equal(fetchImpl.callsMatching('/mapping').length, 2);
});

test('findByName is case- and whitespace-insensitive', async () => {
  const { api } = makeApi();

  assert.equal((await api.findByName('adamant platebody')).id, 1123);
  assert.equal((await api.findByName('  RUNE AXE  ')).id, 1359);
  assert.equal(await api.findByName('Dragon claws'), null);
  assert.equal(await api.findByName(''), null);
});

test('findById', async () => {
  const { api } = makeApi();
  assert.equal((await api.findById(855)).name, 'Yew longbow');
  assert.equal((await api.findById('855')).name, 'Yew longbow');
  assert.equal(await api.findById(999_999), null);
  assert.equal(await api.findById('nope'), null);
});

test('search ranks exact, then prefix, then substring', () => {
  const mapping = normalizeMapping([
    { id: 1, name: 'Axe', highalch: 10 },
    { id: 2, name: 'Rune axe', highalch: 10 },
    { id: 3, name: 'Axe handle', highalch: 10 },
    { id: 4, name: 'Adamant axe', highalch: 10 },
  ]);

  const results = searchMapping(mapping, 'axe').map((e) => e.name);
  assert.deepEqual(results, ['Axe', 'Axe handle', 'Adamant axe', 'Rune axe']);
});

test('search honours limit and the alchable filter', async () => {
  const { api } = makeApi();

  const all = await api.search('a', { limit: 2 });
  assert.equal(all.length, 2);

  const alchable = await api.search('coins', { alchableOnly: true });
  assert.deepEqual(alchable, [], 'Coins have no high alch value');

  assert.deepEqual(await api.search('   '), []);
});

test('getLatestPrices: few ids use per-id requests', async () => {
  const { api, fetchImpl } = makeApi();
  const prices = await api.getLatestPrices([1123, 855]);

  assert.equal(prices.get(1123).high, 4200);
  assert.equal(prices.get(855).low, 300);
  assert.equal(fetchImpl.callsMatching('/latest?id=').length, 2);
});

test('getLatestPrices: many ids use one bulk request', async () => {
  const { api, fetchImpl } = makeApi();
  const prices = await api.getLatestPrices([1123, 855, 1359, 561]);

  assert.equal(prices.size, 4);
  assert.equal(fetchImpl.callsMatching('/latest?id=').length, 0);
  assert.equal(fetchImpl.callsMatching('/latest').length, 1);
});

test('getLatestPrices: no ids fetches everything', async () => {
  const { api } = makeApi();
  const prices = await api.getLatestPrices();
  assert.equal(prices.size, Object.keys(LATEST_FIXTURE).length);
});

test('getSnapshot combines mapping data with live prices', async () => {
  const { api } = makeApi();
  const snapshot = await api.getSnapshot('Adamant platebody');

  assert.equal(snapshot.itemId, 1123);
  assert.equal(snapshot.highAlch, 5760);
  assert.equal(snapshot.limit, 125);
  assert.equal(snapshot.instantBuy, 4200);
  assert.equal(snapshot.instantSell, 4100);
  assert.equal(snapshot.icon, 'https://oldschool.runescape.wiki/images/Adamant_platebody.png');
});

test('getSnapshot returns null for unknown items', async () => {
  const { api } = makeApi();
  assert.equal(await api.getSnapshot('Definitely not an item'), null);
});

test('price basis selects which side becomes the buy price', async () => {
  const { api } = makeApi();

  const buySide = await api.getSnapshot('Adamant platebody', { priceBasis: PRICE_BASIS.INSTANT_BUY });
  assert.equal(buySide.buyPrice, 4200, 'instant-buy is what you actually pay');

  const sellSide = await api.getSnapshot('Adamant platebody', { priceBasis: PRICE_BASIS.INSTANT_SELL });
  assert.equal(sellSide.buyPrice, 4100);
});

test('buildSnapshot falls back when a price side is missing', () => {
  const [entry] = normalizeMapping([MAPPING_FIXTURE[0]]);

  const onlyLow = buildSnapshot(entry, { high: null, low: 4100 }, PRICE_BASIS.INSTANT_BUY);
  assert.equal(onlyLow.buyPrice, 4100, 'falls back to the other side');

  const untraded = buildSnapshot(entry, { high: null, low: null }, PRICE_BASIS.INSTANT_BUY);
  assert.equal(untraded.buyPrice, entry.value, 'finally falls back to shop value');

  const noValue = buildSnapshot({ ...entry, value: 0 }, undefined, PRICE_BASIS.INSTANT_BUY);
  assert.equal(noValue.buyPrice, null);
});

test('getSnapshots batches many items into one price request', async () => {
  const { api, fetchImpl } = makeApi();
  const snapshots = await api.getSnapshots([1123, 855, 1359, 561]);

  assert.equal(snapshots.size, 4);
  assert.equal(snapshots.get(1359).name, 'Rune axe');
  assert.equal(fetchImpl.callsMatching('/latest').length, 1);
});

test('getSnapshots: empty input and unknown ids', async () => {
  const { api } = makeApi();
  assert.equal((await api.getSnapshots([])).size, 0);
  assert.equal((await api.getSnapshots([424_242])).size, 0);
});

test('HTTP errors surface as PricesApiError with a status', async () => {
  const fetchImpl = createFakeFetch({ override: () => ({ status: 503, body: {} }) });
  const api = new PricesApi({ fetch: fetchImpl });

  await assert.rejects(() => api.getMapping(), (error) => {
    assert.ok(error instanceof PricesApiError);
    assert.equal(error.status, 503);
    return true;
  });
});

test('network failures surface as PricesApiError with a cause', async () => {
  const boom = new Error('offline');
  const fetchImpl = createFakeFetch({ override: () => ({ throws: boom }) });
  const api = new PricesApi({ fetch: fetchImpl });

  await assert.rejects(() => api.getMapping(), (error) => {
    assert.ok(error instanceof PricesApiError);
    assert.equal(error.cause, boom);
    return true;
  });
});

test('a failed mapping request does not poison later attempts', async () => {
  let shouldFail = true;
  const fetchImpl = createFakeFetch({
    override: (url) => (shouldFail && url.includes('/mapping') ? { status: 500 } : null),
  });
  const api = new PricesApi({ fetch: fetchImpl });

  await assert.rejects(() => api.getMapping());

  shouldFail = false;
  const entries = await api.getMapping();
  assert.equal(entries.length, MAPPING_FIXTURE.length);
});

test('malformed JSON is reported clearly', async () => {
  const api = new PricesApi({
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    }),
  });

  await assert.rejects(() => api.getMapping(), /Malformed JSON/);
});

test('an API with no fetch implementation fails loudly', async () => {
  const api = new PricesApi({ fetch: null });
  await assert.rejects(() => api.getMapping(), /No fetch implementation/);
});
