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
  const BORDERED = ['--tex-chevron-up', '--tex-chevron-down'];
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

test('no sprite is tiled at all', () => {
  // The inverse of the rule above, stated positively. No sprite in this design
  // is seamless: the backdrop is a flat colour and every frame is a flat border,
  // so the only sprites left are icons, which are drawn once.
  const offenders = [];

  for (const file of STYLE_FILES) {
    for (const block of stripComments(read(file)).split('}')) {
      if (!/background-repeat:\s*repeat/.test(block)) continue;

      const tokens = [...block.matchAll(/var\((--tex-[\w-]+)\)/g)].map((m) => m[1]);
      if (tokens.length === 0) continue;

      const selector = block.trim().split('\n')[0].trim();
      offenders.push(`${file}: "${selector}" repeats ${tokens.join(', ')}`);
    }
  }

  assert.deepEqual(offenders, []);
});

test('frames are flat borders built from tokens', () => {
  // The widget frames in the cache are ~35px images. Stretched across a panel
  // several hundred pixels wide they smear, so they are drawn as two-tone flat
  // borders instead. That leaves no 9-slice anywhere: if one comes back it must
  // carry a measured slice token rather than a bare number.
  const tokens = read('styles/tokens.css');
  assert.match(tokens, /--bd-panel:\s*[^;]+;/);
  assert.match(tokens, /--bd-control:\s*[^;]+;/);

  for (const file of STYLE_FILES) {
    for (const match of stripComments(read(file)).matchAll(/border-image:\s*([^;]+);/g)) {
      const value = match[1].trim();
      if (value === 'none') continue;
      assert.match(value, /var\(--slice-[\w-]+\)/, `${file}: hard-coded slice in "${value}"`);
    }
  }
});

/**
 * The scimitar cursor, and the two ways it fails silently.
 *
 * A cursor image over 32px square is ignored by Firefox, and a hotspot outside
 * the image voids the declaration entirely. Neither throws: the arrow just
 * comes back. See assets/ui/SPRITES.md.
 */
test('the cursor image stays inside the limits that make it draw at all', () => {
  const declaration = /--cursor-blade:\s*([^;]+);/.exec(read('styles/tokens.css'));
  assert.ok(declaration, 'no --cursor-blade token');

  const value = declaration[1].trim();
  const parsed = /^url\(['"]([^'"]+)['"]\)\s+(\d+)\s+(\d+)\s*,\s*(\w+)$/.exec(value);
  assert.ok(parsed, `--cursor-blade must be url(...) <x> <y>, <keyword>, got "${value}"`);

  const [, reference, x, y, fallback] = parsed;
  assert.ok(
    ['auto', 'default', 'pointer', 'crosshair'].includes(fallback),
    'the keyword after the comma is the required fallback',
  );

  // Straight out of the PNG header: bytes 16-24 of an IHDR are width and height.
  const file = fs.readFileSync(path.join(ROOT, resolveReference('styles/tokens.css', reference)));
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);

  assert.ok(width <= 32 && height <= 32, `a ${width}x${height} cursor is dropped by Firefox`);
  assert.ok(Number(x) < width && Number(y) < height, `hotspot ${x} ${y} is outside the image`);
});

test('the cursor is set once, on the backdrop', () => {
  // It inherits. Setting it anywhere else means two rules racing for the same
  // pointer, and the controls that want a different one already say so.
  const users = [];

  for (const file of STYLE_FILES) {
    for (const block of stripComments(read(file)).split('}')) {
      if (!block.includes('var(--cursor-blade)')) continue;
      users.push(`${file}: ${block.trim().split(/[\r\n]+/)[0].trim()}`);
    }
  }

  assert.deepEqual(users, ['styles/base.css: body {']);
  // And nothing bypasses the token with a raw image of its own.
  for (const file of STYLE_FILES.filter((name) => !name.endsWith('tokens.css'))) {
    assert.equal(/cursor:\s*url\(/.test(stripComments(read(file))), false, `${file} inlines a cursor image`);
  }
});

test('no control swaps the blade for a hand', () => {
  // The client has one cursor for the whole interface and the hover state is
  // what says a control is live, so cursor: pointer was taken off the buttons,
  // the headers, the select, the suggestions and the toggle. The two values
  // still allowed say something the blade cannot, and neither is about
  // clicking: a caret over what you can type into, not-allowed over what you
  // cannot use at all.
  // `inherit` is how a form control gets the blade at all: the UA stylesheet
  // gives every one of them a `default` that inheritance alone never overrides.
  const allowed = new Set(['var(--cursor-blade)', 'inherit', 'text', 'not-allowed']);
  const offenders = [];

  for (const file of STYLE_FILES) {
    for (const match of stripComments(read(file)).matchAll(/cursor:\s*([^;]+);/g)) {
      const value = match[1].trim();
      if (!allowed.has(value)) offenders.push(`${file}: cursor: ${value}`);
    }
  }

  assert.deepEqual(offenders, []);
});

test('every colour is declared in tokens.css', () => {
  // The palette is the design. A hex dropped into a component stylesheet is a
  // colour nothing else can follow, which is how a theme drifts apart.
  const offenders = [];

  for (const file of STYLE_FILES.filter((name) => !name.endsWith('tokens.css'))) {
    stripComments(read(file)).split('\n').forEach((line, index) => {
      if (/#[0-9a-fA-F]{3,8}\b/.test(line) || /\brgba?\(/.test(line)) {
        offenders.push(`${file}:${index + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(offenders, []);
});

test('the freshness colours key off values freshnessOf can return', async () => {
  // The stylesheet had a rule for [data-freshness='old'], which nothing ever
  // sets, while 'ageing' went unpainted. Neither fails anything at runtime: the
  // cell just renders the same colour at every age.
  const { freshnessOf } = await import('../src/core/format.js');

  const now = Date.UTC(2024, 0, 1, 12);
  const produced = new Set([
    freshnessOf(now - 1000, now),
    freshnessOf(now - 20 * 60 * 1000, now),
    freshnessOf(now - 90 * 60 * 1000, now),
    freshnessOf(null, now),
    // The table view stamps this itself for a row with no Grand Exchange match.
    'none',
  ]);

  const styled = [...stripComments(read('styles/table.css'))
    .matchAll(/\[data-freshness='([^']+)'\]/g)].map((match) => match[1]);

  assert.ok(styled.length > 0, 'the Updated column should be colour banded');
  for (const value of styled) {
    assert.ok(produced.has(value), `nothing ever sets data-freshness="${value}"`);
  }
});

test('index.html has balanced container tags', () => {
  // A stray </div> does not throw: browsers and jsdom both silently re-parent
  // the rest of the block, so the only symptom was a control quietly escaping
  // its flex row. Counting is enough to catch it.
  const html = read('index.html');

  for (const tag of ['div', 'section', 'form', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'template']) {
    // Substring counting rather than a regex: '<div' cannot appear inside
    // '</div>', so the two counts are directly comparable.
    const open = html.split('<' + tag).length - 1;
    const close = html.split('</' + tag + '>').length - 1;
    assert.equal(open, close, `<${tag}> opened ${open} times but closed ${close}`);
  }
});

test('every settings control shares one row', () => {
  // The auto-refresh select had escaped the toolbar and was stretching across
  // the whole panel at wide viewports.
  const html = read('index.html');
  const body = html.slice(html.indexOf('id="settingsHeading"'));
  const toolbar = body.slice(body.indexOf('<div class="toolbar">'), body.indexOf('<div class="action-bar">'));

  for (const id of ['runePrice', 'priceBasis', 'autoRefresh']) {
    assert.ok(toolbar.includes(`id="${id}"`), `${id} should sit in the settings toolbar`);
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
    'totalProfit', 'totalProfitNote', 'totalXp', 'totalTime', 'totalCost', 'castRate',
    'totalSplit',
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

test('notifications are built like panels, and carry tone in the text', () => {
  // Toasts and the protocol notice were cards with a coloured left edge: a web
  // convention, and the only thing on the page not drawn as a game widget. They
  // use the panel's own frame and shadow now, and say which kind of message
  // they are the way the client does - by colouring the line.
  const css = stripComments(read('styles/components.css'));
  const blockFor = (selector) =>
    css.split('}').find((rule) => new RegExp(`^\\s*\\${selector}\\s*\\{`).test(rule));

  for (const selector of ['.toast', '.notice']) {
    const block = blockFor(selector);
    assert.ok(block, `no ${selector} rule found`);
    assert.match(block, /border:\s*var\(--bd-panel\)/, `${selector} should wear the panel frame`);
    assert.match(block, /box-shadow:[^;]*var\(--shadow-panel\)/, `${selector} needs the panel shadow`);
  }

  assert.equal(
    /border-left/.test(css),
    false,
    'tone belongs in the text colour, not in a coloured edge',
  );
  assert.match(css, /\.toast--error\s+\.toast__message\s*\{[^}]*var\(--c-red\)/);
  assert.match(css, /\.toast--success\s+\.toast__message\s*\{[^}]*var\(--c-green\)/);
});

test('the toast action is the same control as every other button', () => {
  // It used to restate the button's face, frame and hover for itself, which is
  // how two controls that should look identical drift apart.
  const css = stripComments(read('styles/components.css'));
  const shared = css.split('}').find((rule) => /\.btn,\s*\n\s*\.toast__action\s*\{/.test(rule));

  assert.ok(shared, '.toast__action should share the .btn declaration');

  const own = css.split('}').find((rule) => /^\s*\.toast__action\s*\{/.test(rule));
  assert.ok(own, 'no .toast__action rule found');
  assert.equal(/border:/.test(own), false, 'the frame comes from the shared rule');
});

test('the icon buttons have a body of their own so they read as controls', () => {
  // The row icons are pale outlines. Without a painted face and a frame behind
  // them they float on the panel and stop looking clickable. Enforced here so
  // the background cannot be dropped silently.
  const css = stripComments(read('styles/components.css'));
  const block = css.split('}').find((rule) => /^\s*\.icon-btn\s*\{/.test(rule));

  assert.ok(block, 'no .icon-btn rule found');
  assert.match(block, /background:\s*var\(--c-[\w-]+\)/);
  assert.match(block, /border:\s*[^;]+var\(--c-[\w-]+\)/);
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

test('button icons are never inked to a silhouette', () => {
  // brightness(0) turns a sprite into a black silhouette. That was how these
  // icons were made to read on parchment; on the dark widget face it makes them
  // disappear instead, so the filter and its opt-in class are both gone.
  const html = read('index.html');
  const css = stripComments(read('styles/components.css'));

  const base = css.split('}').find((rule) => /^\s*\.btn__icon\s*\{/.test(rule));
  assert.ok(base, 'no .btn__icon rule found');
  assert.equal(/filter:/.test(base), false, '.btn__icon must not filter every icon');
  assert.equal(/brightness\(0\)/.test(css), false, 'a silhouette is invisible on the widget face');
  assert.equal(html.includes('btn__icon--ink'), false, 'the ink modifier is gone');

  // The icons themselves stay: they are what tells the two update buttons apart
  // from the destructive one at a glance.
  const icons = [...html.matchAll(/<img class="(btn__icon[^"]*)" src="([^"]+)"/g)];
  assert.ok(icons.length >= 3, 'expected several button icons');
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
