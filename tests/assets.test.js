/**
 * Static integrity checks.
 *
 * A broken image path or a typo'd CSS variable does not fail any behavioural
 * test — it just renders wrong. These tests catch that class of bug without a
 * browser: every referenced file must exist, and every custom property used
 * must be defined.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));

const STYLE_FILES = ['tokens.css', 'base.css', 'layout.css', 'components.css', 'table.css', 'main.css']
  .map((name) => `styles/${name}`);

/** Resolve a URL found inside a file, relative to that file's directory. */
function resolveReference(fromFile, reference) {
  const dir = path.dirname(path.join(ROOT, fromFile));
  return path.relative(ROOT, path.resolve(dir, reference)).replaceAll('\\', '/');
}

function collectUrls(css) {
  return [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((match) => match[1]);
}

/** Blank out comments while keeping line numbers intact. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

test('every asset referenced from CSS exists', () => {
  const missing = [];

  for (const file of STYLE_FILES) {
    for (const reference of collectUrls(read(file))) {
      if (reference.startsWith('http') || reference.startsWith('data:')) continue;
      const resolved = resolveReference(file, reference);
      if (!exists(resolved)) missing.push(`${file} -> ${reference}`);
    }
  }

  assert.deepEqual(missing, []);
});

test('every asset referenced from index.html exists', () => {
  const html = read('index.html');
  const references = [...html.matchAll(/(?:src|href)="(\.\/|assets\/|fonts\/|styles\/|src\/)([^"]+)"/g)]
    .map((match) => `${match[1]}${match[2]}`.replace(/^\.\//, ''));

  const missing = references.filter((reference) => !exists(reference));

  assert.deepEqual(missing, []);
  assert.ok(references.length > 5, 'expected the page to reference several files');
});

test('main.css imports resolve', () => {
  const imports = [...read('styles/main.css').matchAll(/@import\s+url\(['"]([^'"]+)['"]\)/g)]
    .map((match) => resolveReference('styles/main.css', match[1]));

  assert.equal(imports.length, 5);
  for (const file of imports) {
    assert.ok(exists(file), `missing stylesheet: ${file}`);
  }
});

test('every CSS custom property used is defined in tokens.css', () => {
  const defined = new Set(
    [...read('styles/tokens.css').matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((match) => match[1]),
  );

  const undefinedVars = new Set();
  for (const file of STYLE_FILES) {
    for (const match of read(file).matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!defined.has(match[1])) undefinedVars.add(`${file}: ${match[1]}`);
    }
  }

  assert.deepEqual([...undefinedVars], []);
  assert.ok(defined.size > 30, 'the token file should define a full palette');
});

test('no stray non-ASCII characters in CSS declarations', () => {
  // A stray character inside a hex colour silently kills the declaration and
  // nothing else in the suite would notice. Comments may say what they like.
  const printableAscii = /^[\t -~]*$/;
  const offenders = [];

  for (const file of STYLE_FILES) {
    stripComments(read(file)).split('\n').forEach((line, index) => {
      const content = line.replace(/\r$/, '');
      if (!printableAscii.test(content)) {
        offenders.push(`${file}:${index + 1}: ${content.trim()}`);
      }
    });
  }

  assert.deepEqual(offenders, []);
});

/**
 * Sprites with a baked-in border must never be tiled.
 *
 * In the OSRS cache only the sprites whose RuneLite constant starts with
 * `TEXTURE_` are seamless. Everything else is a self-contained widget with its
 * frame painted into the image, so repeating it stamps that frame across the
 * middle of the element. Those may only be 9-sliced with `border-image`.
 * See assets/ui/SPRITES.md.
 */
test('bordered sprites are never tiled', () => {
  const BORDERED = [
    '--tex-panel', '--tex-button', '--tex-button-active',
    '--tex-button-primary', '--tex-icon-button', '--tex-icon-button-hover',
    '--tex-slot', '--tex-scroll-h', '--tex-scroll-v',
    '--tex-chevron-up', '--tex-chevron-down',
  ];
  const offenders = [];

  for (const file of STYLE_FILES) {
    // Split into declaration blocks so a `repeat` in one rule cannot be
    // blamed on a sprite used in another.
    for (const block of stripComments(read(file)).split('}')) {
      const usesBorderedSprite = BORDERED.some((token) => block.includes(`var(${token})`));
      if (!usesBorderedSprite) continue;

      const repeat = /background-repeat:\s*(repeat|repeat-x|repeat-y)\s*;/.exec(block);
      if (repeat) {
        const selector = block.trim().split('\n')[0].trim();
        offenders.push(`${file}: "${selector}" uses ${repeat[1]}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test('only the seamless TEXTURE_ sprites are ever repeated', () => {
  // The inverse of the rule above, stated positively: any rule that repeats a
  // background must be using one of the two 128x128 seamless tiles.
  const SEAMLESS = ['--tex-page'];
  const offenders = [];

  for (const file of STYLE_FILES) {
    for (const block of stripComments(read(file)).split('}')) {
      if (!/background-repeat:\s*repeat/.test(block)) continue;

      const tokens = [...block.matchAll(/var\((--tex-[\w-]+)\)/g)].map((m) => m[1]);
      if (tokens.length === 0) continue;
      if (tokens.every((token) => SEAMLESS.includes(token))) continue;

      const selector = block.trim().split('\n')[0].trim();
      offenders.push(`${file}: "${selector}" repeats ${tokens.join(', ')}`);
    }
  }

  assert.deepEqual(offenders, []);
  // And the tiles really are used, so the rule is not vacuously true.
  const allCss = STYLE_FILES.map(read).join('\n');
  for (const token of SEAMLESS) {
    assert.ok(allCss.includes(`var(${token})`), `${token} is unused`);
  }
});

test('9-slice widths are declared as tokens next to their sprite', () => {
  // Values measured off the sprites themselves: see assets/ui/SPRITES.md.
  const tokens = read('styles/tokens.css');
  assert.match(tokens, /--slice-panel:\s*16;/);
  assert.match(tokens, /--slice-button-primary:\s*4;/);
  assert.match(tokens, /--slice-icon-button:\s*3;/);

  // Every border-image must use a slice token rather than a bare number, so
  // the value stays next to the sprite dimensions that justify it.
  for (const file of STYLE_FILES) {
    for (const match of stripComments(read(file)).matchAll(/border-image:\s*([^;]+);/g)) {
      const value = match[1].trim();
      if (value === 'none') continue;
      assert.match(value, /var\(--slice-[\w-]+\)/, `${file}: hard-coded slice in "${value}"`);
    }
  }
});

test('every stylesheet has balanced braces', () => {
  for (const file of STYLE_FILES) {
    const css = stripComments(read(file));
    const open = (css.match(/{/g) ?? []).length;
    const close = (css.match(/}/g) ?? []).length;
    assert.equal(open, close, `${file} has ${open} "{" and ${close} "}"`);
  }
});

test('index.html declares every element the app looks up', () => {
  const html = read('index.html');
  const required = [
    'addForm', 'itemName', 'buyPrice', 'alchPrice', 'quantity', 'itemSuggestions',
    'itemsTable', 'itemsBody', 'itemsFoot', 'itemRowTemplate', 'emptyState', 'rowCount',
    'totalProfit', 'totalProfitNote', 'totalXp', 'totalTime', 'totalCost', 'totalCasts',
    'runePrice', 'priceBasis', 'fetchRunePrice', 'refreshAll', 'clearAll', 'dataStatus',
    'toasts', 'protocolWarning',
  ];

  const missing = required.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test('every sortable header maps to a known sort field', async () => {
  const { SORT_ACCESSORS } = await import('../src/core/sorting.js');
  const fields = [...read('index.html').matchAll(/data-sort="([^"]+)"/g)].map((match) => match[1]);

  assert.ok(fields.length >= 6, 'most columns should be sortable');
  for (const field of fields) {
    assert.ok(Object.hasOwn(SORT_ACCESSORS, field), `no accessor for sortable column "${field}"`);
  }
});

test('the row template carries every cell the table view writes to', () => {
  const html = read('index.html');
  const template = html.slice(html.indexOf('<template id="itemRowTemplate">'));

  for (const field of ['name', 'buyPrice', 'quantity']) {
    assert.ok(template.includes(`data-field="${field}"`), `template is missing field ${field}`);
  }
  // High alch is read-only, so it is a plain cell rather than an editable one.
  assert.equal(template.includes('data-field="alchPrice"'), false);
  for (const cell of ['alchPrice', 'costItems', 'costRunes', 'profitPerCast', 'profit']) {
    assert.ok(template.includes(`data-cell="${cell}"`), `template is missing cell ${cell}`);
  }
  for (const action of ['refresh', 'delete']) {
    assert.ok(template.includes(`data-action="${action}"`), `template is missing action ${action}`);
  }
});

test('each panel title carries the icon that matches its job', () => {
  // Pinned because these were chosen deliberately and are easy to shuffle by
  // accident: search for adding, the alchemy spell for the list, a tool for
  // settings. See assets/ui/SPRITES.md.
  const html = read('index.html');
  const titleIcon = (heading) => {
    const start = html.indexOf(`id="${heading}"`);
    assert.notEqual(start, -1, `no heading ${heading}`);
    const slice = html.slice(start, start + 300);
    return /panel__title-icon" src="([^"]+)"/.exec(slice)?.[1];
  };

  assert.equal(titleIcon('addHeading'), 'assets/ui/search.png');
  assert.equal(titleIcon('tableHeading'), 'assets/ui/high_alchemy.png');
  assert.equal(titleIcon('settingsHeading'), 'assets/ui/settings_wrench.png');
});

test('the stat cards keep the original larger icons', () => {
  // Deliberately not the resource-pack equivalents: at 42px the pack's small
  // interface glyphs look thin next to these. See assets/ui/SPRITES.md.
  const icons = [...read('index.html').matchAll(/stat__icon" src="([^"]+)"/g)].map((m) => m[1]);

  assert.deepEqual(icons, [
    'assets/coins.png',
    'assets/xp.png',
    'assets/giant_stopwatch.png',
    // Total spend is the exception: the pack's money bag beats the rune here.
    'assets/ui/guide_prices.png',
  ]);
});

test('the row action buttons use the pack icons', () => {
  const html = read('index.html');
  const template = html.slice(html.indexOf('<template id="itemRowTemplate">'));

  assert.match(template, /data-action="refresh"[\s\S]{0,120}assets\/ui\/refresh\.png/);
  assert.match(template, /data-action="delete"[\s\S]{0,120}assets\/ui\/trash\.png/);
});

test('the icon buttons have a sprite body so they read on parchment', () => {
  // The row icons are pale; without a button behind them they vanish into the
  // parchment. Enforced here so the background cannot be dropped silently.
  const css = stripComments(read('styles/components.css'));
  const block = css.split('}').find((rule) => /^\s*\.icon-btn\s*\{/.test(rule));

  assert.ok(block, 'no .icon-btn rule found');
  assert.match(block, /border-image:\s*var\(--tex-icon-button\)/);
});

test('the settings actions sit in their own ruled row', () => {
  // They used to share a line with the fields, which left a dead gap in the
  // middle and put the destructive action next to two harmless ones.
  const html = read('index.html');
  const bar = html.slice(html.indexOf('class="action-bar"'));

  assert.ok(bar.includes('id="fetchRunePrice"'));
  assert.ok(bar.includes('id="refreshAll"'));
  assert.match(bar, /id="clearAll"[^>]*|class="[^"]*action-bar__end/);
  assert.ok(html.includes('btn--danger'), 'clear list stays marked destructive');
  assert.equal(html.includes('btn--ghost'), false, 'the odd-one-out ghost style is gone');
});

test('only flat outline icons get the ink filter', () => {
  // brightness(0) is a silhouette. It suits the refresh sprite, which is a thin
  // outline, and destroys the trash sprite, which is a shaded bin: it rendered
  // as a solid black blob. So the filter is opt-in per icon, never on .btn__icon.
  const html = read('index.html');
  const css = stripComments(read('styles/components.css'));

  const base = css.split('}').find((rule) => /^\s*\.btn__icon\s*\{/.test(rule));
  assert.ok(base, 'no .btn__icon rule found');
  assert.equal(/filter:/.test(base), false, '.btn__icon must not filter every icon');

  const ink = css.split('}').find((rule) => /\.btn__icon--ink\s*\{/.test(rule));
  assert.ok(ink && /brightness\(0\)/.test(ink), '.btn__icon--ink should ink the sprite');

  // The refresh outlines are inked; the shaded trash bin is left alone.
  const icons = [...html.matchAll(/<img class="(btn__icon[^"]*)" src="([^"]+)"/g)];
  assert.ok(icons.length >= 3, 'expected several button icons');
  for (const [, classes, src] of icons) {
    assert.equal(
      classes.includes('btn__icon--ink'),
      src.includes('refresh.png'),
      `${src}: ink filter applied incorrectly`,
    );
  }
});

test('the sorted column is marked with the green chevron', () => {
  const css = stripComments(read('styles/table.css'));
  const blocks = css.split('}');

  const sorted = blocks.find((rule) => /th\[aria-sort\]::after\s*\{/.test(rule));
  assert.ok(sorted, 'no rule for the sorted column indicator');
  assert.match(sorted, /var\(--tex-chevron-up\)/);
  assert.match(sorted, /background-repeat:\s*no-repeat/, 'the chevron must be drawn once');

  const descending = blocks.find((rule) => /th\[aria-sort='descending'\]::after\s*\{/.test(rule));
  assert.ok(descending, 'no rule for the descending indicator');
  assert.match(descending, /var\(--tex-chevron-down\)/);

  // Unsorted columns are left unmarked: only the column actually in use gets
  // an indicator, so nothing else in the header competes with it.
  const sortable = blocks.find((rule) => /th\[data-sort\]::after\s*\{/.test(rule));
  assert.equal(sortable, undefined, 'unsorted headers should carry no indicator');
});

test('the totals row covers the same derived columns as the body', () => {
  const html = read('index.html');
  for (const cell of ['costItems', 'costRunes', 'profitPerCast', 'profit']) {
    assert.ok(html.includes(`data-total="${cell}"`), `totals row is missing ${cell}`);
  }
});

test('the stylesheet does not reference the deleted v1 entry points', () => {
  // styles.css and script.js were replaced; nothing should still point at them.
  const html = read('index.html');
  assert.equal(html.includes('"./styles.css"'), false);
  assert.equal(html.includes('"./script.js"'), false);
});
