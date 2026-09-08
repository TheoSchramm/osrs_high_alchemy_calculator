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

/**
 * 360 is a common phone. It is only reachable through viewport emulation:
 * Chromium refuses to open a window narrower than about 492px, which hid a
 * real failure at phone sizes for a long time.
 */
const WIDTHS = [360, 500, 768, 1024, 1400];

/** Below this the table becomes stacked cards; see styles/table.css. */
const CARD_BREAKPOINT = 700;

let server;
let browser;

before(async () => {
  if (!findBrowser()) throw new Error('No Chromium-based browser found; skipping layout checks');
  server = await startServer();
  browser = await launchBrowser({ width: 1500, height: 1600 });
});

after(() => {
  browser?.close();
  server?.close();
});

/** One browser, with the viewport emulated per page. */
async function pageAt(width, url = '/tools/preview.html') {
  return browser.open(`${server.origin}${url}`, {
    viewportWidth: width,
    viewportHeight: 1600,
  });
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

test('the table fits without scrolling at every width', { timeout: 120_000 }, async () => {
  // The table has no visible scrollbar, so fitting is not cosmetic: anything
  // that overflows is simply unreachable on a desktop.
  for (const width of WIDTHS) {
    const page = await pageAt(width);
    const result = await page.evaluate(`{
      scroller: document.querySelector('.table-scroll').clientWidth,
      table: document.querySelector('.table-scroll').scrollWidth,
      columns: [...document.querySelectorAll('#itemsTable thead th')]
        .filter(th => getComputedStyle(th).display !== 'none').length,
      footCells: [...document.querySelectorAll('#itemsFoot td')]
        .filter(td => getComputedStyle(td).display !== 'none').length
    }`);

    assert.ok(
      result.table <= result.scroller + 1,
      `the table overflows at ${width}px (${result.table} > ${result.scroller})`,
    );
    // The totals row must drop columns in step with the header, or it stops
    // lining up with the figures above it. Cards stack every field with its own
    // label, so there are no columns to line up with.
    if (width > CARD_BREAKPOINT) {
      assert.equal(
        result.footCells,
        result.columns,
        `totals row has ${result.footCells} cells against ${result.columns} columns at ${width}px`,
      );
    }
    await page.close();
  }
});

test('phones get stacked cards with every field labelled', { timeout: 90_000 }, async () => {
  // No column shedding fits a phone: at 360px the grid still wanted 114px more
  // than it had, and with the scrollbar hidden those columns were unreachable.
  const page = await pageAt(360);
  const result = await page.evaluate(`{
    rowDisplay: getComputedStyle(document.querySelector('#itemsBody tr')).display,
    visibleCells: [...document.querySelectorAll('#itemsBody tr:first-child td')]
      .filter(td => getComputedStyle(td).display !== 'none').length,
    labelled: [...document.querySelectorAll('#itemsBody tr:first-child td[data-label]')]
      .every(td => getComputedStyle(td, '::before').content.includes(td.dataset.label)),
    headerTakesSpace: document.querySelector('#itemsTable thead').getBoundingClientRect().height > 2
  }`);

  assert.equal(result.rowDisplay, 'block', 'rows should stack rather than lay out as a table row');
  assert.equal(result.visibleCells, 10, 'stacking gives every column back');
  assert.equal(result.labelled, true, 'each stacked cell shows its own label');
  assert.equal(result.headerTakesSpace, false, 'the column header row is out of the way');
  await page.close();
});

test('the table scroller shows no scrollbar', { timeout: 90_000 }, async () => {
  const page = await pageAt(768);
  // The border is measured rather than assumed: it is a token, so its width can
  // change without this test being about it.
  const thickness = await page.evaluate(`(() => {
    const s = document.querySelector('.table-scroll');
    const style = getComputedStyle(s);
    const borders = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    return s.offsetHeight - s.clientHeight - borders;
  })()`);

  assert.ok(thickness <= 0, `a scrollbar is taking ${thickness}px of layout`);
  await page.close();
});

test('nothing carrying the hidden attribute is painted', { timeout: 90_000 }, async () => {
  // The UA rule for [hidden] is display:none at the lowest possible
  // specificity, so any component rule with a display silently beats it. That
  // is how the chain badge kept painting after being hidden, once it became a
  // button with display:inline-flex, and jsdom cannot see it: the hidden
  // property read back as true the whole time.
  const page = await pageAt(1400);
  const painted = await page.evaluate(`
    [...document.querySelectorAll('[hidden]')]
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
      })
      .slice(0, 8)
      .map(el => el.tagName + '.' + String(el.className).split(' ')[0])
  `);

  assert.deepEqual(painted, [], 'these are hidden but still take up space');
  await page.close();
});

test('clicking the chain removes it from the page', { timeout: 90_000 }, async () => {
  const page = await pageAt(1400);
  const result = await page.evaluate(`(() => {
    const row = [...document.querySelectorAll('#itemsBody tr')]
      .find(r => !r.querySelector('[data-pin="buyPrice"]').hidden);
    const pin = row.querySelector('[data-pin="buyPrice"]');
    const price = () => row.querySelector('[data-field="buyPrice"]').textContent;

    const before = { price: price(), painted: pin.getBoundingClientRect().width > 0 };
    pin.click();
    return {
      before,
      after: { price: price(), painted: pin.getBoundingClientRect().width > 0 },
    };
  })()`);

  assert.equal(result.before.painted, true, 'the fixture should start with a locked row');
  assert.equal(result.after.painted, false, 'the chain must actually leave the page');
  assert.notEqual(result.after.price, result.before.price, 'and the market price comes back');
  await page.close();
});

test('the sort chevron never wraps off the label line', { timeout: 90_000 }, async () => {
  // Header labels wrap on purpose - that is what keeps the table narrow enough
  // to need no scrollbar - and an in-flow chevron is an atomic inline, so the
  // browser was free to break it onto its own line under a long label.
  const page = await pageAt(1400);
  const result = await page.evaluate(`(() => {
    const rowHeight = () =>
      Math.round(document.querySelector('#itemsTable thead tr').getBoundingClientRect().height);

    const unsorted = rowHeight();
    const measurements = [];

    for (const th of document.querySelectorAll('#itemsTable th[data-sort]')) {
      th.click();
      const after = getComputedStyle(th, '::after');
      measurements.push({
        column: th.dataset.column,
        rowHeight: rowHeight(),
        position: after.position,
      });
    }

    return { unsorted, measurements };
  })()`);

  for (const measurement of result.measurements) {
    assert.equal(
      measurement.position,
      'absolute',
      `${measurement.column}: the chevron must be out of flow so it cannot wrap`,
    );
    assert.equal(
      measurement.rowHeight,
      result.unsorted,
      `${measurement.column}: sorting must not grow the header row`,
    );
  }
  await page.close();
});

test('every widget is painted and framed', { timeout: 90_000 }, async () => {
  // The frames are flat borders rather than 9-sliced sprites, so what there is
  // to check is that each surface actually has a face and an edge. A widget
  // that loses either falls back to the backdrop and stops reading as a widget.
  const page = await pageAt(1400);
  const result = await page.evaluate(`(() => {
    const face = (selector) => {
      const s = getComputedStyle(document.querySelector(selector));
      return { bg: s.backgroundColor, border: parseFloat(s.borderTopWidth), color: s.borderTopColor };
    };
    return {
      panel: face('.panel'),
      button: face('.btn:not(.btn--primary)'),
      primary: face('.btn--primary'),
      iconButton: face('.icon-btn'),
      well: face('.table-scroll'),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim(),
      brokenImages: [...document.images]
        .filter(img => img.src.startsWith(location.origin))
        .filter(img => img.complete && img.naturalWidth === 0)
        .map(img => img.src)
    };
  })()`);

  for (const [name, widget] of Object.entries(result)) {
    if (name === 'brokenImages' || name === 'accent') continue;
    assert.notEqual(widget.bg, 'rgba(0, 0, 0, 0)', `${name} has no painted face`);
    assert.ok(widget.border > 0, `${name} has no frame`);
  }

  // The one action the page exists for carries the accent on its frame, which
  // is what separates it from the buttons beside it.
  assert.notEqual(
    result.primary.color,
    result.button.color,
    'the primary button should not share the plain button frame',
  );

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
        // A gradient is seamless by construction; sprites are what this rule
        // is about.
        !s.backgroundImage.includes('gradient') &&
        s.backgroundRepeat.startsWith('repeat'))
      .slice(0, 6)
      .map(({ el, s }) => el.tagName + '.' + String(el.className).split(' ')[0] + ' -> ' + s.backgroundRepeat)
  `);

  assert.deepEqual(offenders, []);
  await page.close();
});

test('the widget face keeps text readable', { timeout: 90_000 }, async () => {
  const page = await pageAt(1400);
  const result = await page.evaluate(`{
    itemName: getComputedStyle(document.querySelector('.cell-item__name')).color,
    figure: getComputedStyle(document.querySelector('[data-cell="costItems"]')).color,
    panelBg: getComputedStyle(document.querySelector('.panel')).backgroundColor,
    profit: getComputedStyle(document.querySelector('.value-profit')).color
  }`);

  // Light text on a dark widget: everything written on the panel must be
  // substantially lighter than the panel it is written on.
  const luminance = (rgb) => {
    const [r, g, b] = rgb.match(/\d+/g).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };

  const panel = luminance(result.panelBg);
  assert.ok(panel < 0.5, `panel should be dark, got ${result.panelBg}`);

  for (const [name, color] of Object.entries(result)) {
    if (name === 'panelBg') continue;
    assert.ok(
      luminance(color) > panel + 0.15,
      `${name} does not stand off the panel: ${color} on ${result.panelBg}`,
    );
  }
  await page.close();
});

test('the totals row still distinguishes profit from loss', { timeout: 90_000 }, async () => {
  // The tfoot colour rule outranks the plain tone classes, so without
  // an explicit override every figure renders the same colour and a loss stops
  // reading as a loss.
  const page = await pageAt(1400);
  const result = await page.evaluate(`(() => {
    const foot = document.querySelector('#itemsFoot');
    const base = getComputedStyle(foot.querySelector('td')).color;
    const toned = [...foot.querySelectorAll('.value-profit, .value-loss')]
      .map(td => getComputedStyle(td).color);
    return { base, toned };
  })()`);

  assert.ok(result.toned.length > 0, 'the fixture should produce a toned total');
  for (const color of result.toned) {
    assert.notEqual(color, result.base, 'a toned total must not fall back to the row colour');
  }
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
