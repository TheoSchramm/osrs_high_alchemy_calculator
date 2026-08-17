/**
 * Layout regression tests, run in a real browser.
 *
 * Not part of `npm test`: these need a Chromium install and are much slower.
 * Run with `npm run test:layout`.
 *
 * They exist because jsdom has no layout engine, so the main suite cannot see
 * a panel overflowing the viewport, a control being clipped, or a 9-sliced
 * border failing to load. Every assertion here is geometric or computed-style.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import { launchBrowser, startServer, findBrowser } from '../../tools/browser.js';

const WIDTHS = [500, 768, 1024, 1400];

let server;
const browsers = new Map();

before(async () => {
  if (!findBrowser()) throw new Error('No Chromium-based browser found; skipping layout checks');
  server = await startServer();
});

after(() => {
  for (const browser of browsers.values()) browser.close();
  server?.close();
});

/** One browser per viewport width, reused across tests. */
async function pageAt(width, url = '/tools/preview.html') {
  if (!browsers.has(width)) {
    browsers.set(width, await launchBrowser({ width, height: 1600 }));
  }
  return browsers.get(width).open(`${server.origin}${url}`);
}

for (const width of WIDTHS) {
  test(`no horizontal overflow at ${width}px`, { timeout: 90_000 }, async () => {
    const page = await pageAt(width);
    const result = await page.evaluate(`{
      viewport: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll('body *')]
        .filter(el => {
          const r = el.getBoundingClientRect();
          // A table inside its own scroller is allowed to be wider.
          if (el.closest('.table-scroll') || el.closest('.toast-stack')) return false;
          return r.width > 0 && r.right > innerWidth + 1;
        })
        .slice(0, 6)
        .map(el => el.tagName + '.' + String(el.className).split(' ')[0])
    }`);

    assert.deepEqual(result.offenders, [], `elements overflow the viewport at ${width}px`);
    assert.ok(
      result.scrollWidth <= result.viewport + 1,
      `document scrolls horizontally at ${width}px (${result.scrollWidth} > ${result.viewport})`,
    );
    await page.close();
  });
}

test('the wide table stays inside its own scroller', { timeout: 90_000 }, async () => {
  const page = await pageAt(500);
  const result = await page.evaluate(`{
    tableWidth: document.querySelector('.osrs-table').getBoundingClientRect().width,
    scrollerWidth: document.querySelector('.table-scroll').getBoundingClientRect().width,
    scrollerOverflowX: getComputedStyle(document.querySelector('.table-scroll')).overflowX
  }`);

  assert.equal(result.scrollerOverflowX, 'auto');
  assert.ok(
    result.tableWidth > result.scrollerWidth,
    'the fixture should be wide enough to actually exercise the scroller',
  );
  await page.close();
});

test('the 9-sliced sprites load and are applied', { timeout: 90_000 }, async () => {
  const page = await pageAt(1400);
  const result = await page.evaluate(`{
    panel: getComputedStyle(document.querySelector('.panel')).borderImageSource,
    banner: getComputedStyle(document.querySelector('.panel__title')).borderImageSource,
    button: getComputedStyle(document.querySelector('.btn')).borderImageSource,
    brokenImages: [...document.images]
      .filter(img => img.src.startsWith(location.origin))
      .filter(img => img.complete && img.naturalWidth === 0)
      .map(img => img.src)
  }`);

  assert.match(result.panel, /panel_parchment\.png/);
  assert.match(result.banner, /banner_scroll\.png/);
  assert.match(result.button, /button\.png/);
  // Only local images: whether the wiki's CDN is reachable is not our bug.
  assert.deepEqual(result.brokenImages, [], 'some local images failed to load');
  await page.close();
});

test('no sprite with a baked-in border is tiled', { timeout: 90_000 }, async () => {
  // The static test checks the source; this checks what the browser resolved,
  // which also catches a token being overridden somewhere unexpected.
  const page = await pageAt(1400);
  const offenders = await page.evaluate(`
    [...document.querySelectorAll('body *')]
      .map(el => ({ el, s: getComputedStyle(el) }))
      .filter(({ s }) =>
        s.backgroundImage !== 'none' &&
        !s.backgroundImage.includes('stone_wall') &&
        !s.backgroundImage.includes('gradient') &&
        s.backgroundRepeat.startsWith('repeat'))
      .slice(0, 6)
      .map(({ el, s }) => el.tagName + '.' + String(el.className).split(' ')[0] + ' -> ' + s.backgroundRepeat)
  `);

  assert.deepEqual(offenders, []);
  await page.close();
});

test('the parchment keeps text readable', { timeout: 90_000 }, async () => {
  const page = await pageAt(1400);
  const result = await page.evaluate(`{
    bodyText: getComputedStyle(document.querySelector('.cell-item__name')).color,
    panelBg: getComputedStyle(document.querySelector('.panel')).backgroundColor,
    profit: getComputedStyle(document.querySelector('.value-profit')).color
  }`);

  // Dark ink on light parchment: the ink must be substantially darker.
  const luminance = (rgb) => {
    const [r, g, b] = rgb.match(/\d+/g).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };

  assert.ok(luminance(result.panelBg) > 0.5, `panel should be light, got ${result.panelBg}`);
  assert.ok(luminance(result.bodyText) < 0.3, `text should be dark, got ${result.bodyText}`);
  assert.ok(luminance(result.profit) < 0.5, `profit green must be dark enough on parchment, got ${result.profit}`);
  await page.close();
});

test('every control is large enough to hit', { timeout: 90_000 }, async () => {
  const page = await pageAt(1400);
  const tooSmall = await page.evaluate(`
    [...document.querySelectorAll('button, input, select')]
      .filter(el => el.offsetParent !== null)
      .map(el => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height < 28 || r.width < 28)
      .map(({ el, r }) => (el.id || el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))
  `);

  assert.deepEqual(tooSmall, []);
  await page.close();
});

test('the app actually rendered the fixture rows', { timeout: 90_000 }, async () => {
  const page = await pageAt(1400);
  const result = await page.evaluate(`{
    rows: document.querySelectorAll('#itemsBody tr').length,
    totalProfit: document.querySelector('#totalProfit').textContent,
    emptyHidden: document.querySelector('#emptyState').hidden
  }`);

  assert.equal(result.rows, 4);
  assert.equal(result.emptyHidden, true);
  assert.match(result.totalProfit, /gp$/);
  await page.close();
});
