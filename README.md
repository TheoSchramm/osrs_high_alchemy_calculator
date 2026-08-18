# OSRS High Alchemy Calculator

Work out High Level Alchemy profit, experience and time using live Grand Exchange
prices from the [OSRS Wiki real-time prices API](https://prices.runescape.wiki/osrs/).

No build step, no framework, no runtime dependencies — plain ES modules and CSS.

## Running it

ES modules and `fetch` are both blocked on `file://`, so the page must be served
over HTTP. Opening `index.html` by double-clicking will show a warning banner.

```bash
npm install      # only needed for the tests (jsdom)
npm run serve    # http://localhost:4173
```

## Publishing

The site is static with no build step, so GitHub Pages can serve the repository
as-is. `.github/workflows/pages.yml` runs the offline test suite and then
deploys on every push to `main`.

To set it up once:

```bash
gh repo create <name> --public --source=. --remote=origin --push
```

Then in the repository, **Settings > Pages > Build and deployment**, set the
source to **GitHub Actions**. The next push publishes to
`https://<user>.github.io/<name>/`.

Two things that were checked rather than assumed:

- **Every path is relative**, so the app works from a project subpath rather
  than only at a domain root. Verified by serving it from `/high-alchemy/`.
- **The price API sends `Access-Control-Allow-Origin: *`**, so fetching it
  from a `github.io` origin is fine.

`.nojekyll` stops GitHub running the published files through Jekyll.

### Before making the repository public

`assets/` and `fonts/` contain Jagex artwork and the RuneScape font, taken
from the game cache and the vanilla resource pack. Publishing the repository
redistributes them. Fan sites do this routinely and `assets/ui/SPRITES.md`
records the provenance, but it is a deliberate choice rather than a detail:
Jagex owns those files, not this project.

## Testing

```bash
npm test            # the full offline suite — no network, safe to run anywhere
npm run test:watch
npm run test:live   # hits the real price API; run when you suspect API drift
npm run test:layout # real headless browser; catches layout and sprite bugs
```

`npm test` is the regression suite. It covers the maths, the storage format
(including migration from the old save file), the API client against recorded
fixtures, and the rendered DOM driven through the real `index.html` in jsdom.

Two suites are deliberately kept out of it:

- `npm run test:live` asserts that the live API still matches the shape the
  fixtures assume. If it fails but `npm test` passes, the API changed and
  `tests/helpers/fake-api.js` needs updating.
- `npm run test:layout` drives a real headless browser over the DevTools
  Protocol. jsdom has no layout engine, so it cannot see an element overflowing
  the viewport, a control being clipped, or a 9-sliced sprite failing to apply.
  Needs Edge or Chrome installed, and takes a few minutes.

To poke at the running page yourself:

```bash
npm run serve
node tools/inspect.js http://localhost:4173/ "document.title"
WIDTH=500 node tools/inspect.js http://localhost:4173/ "innerWidth"

# Chromium will not open a window under about 492px, so phone widths need
# viewport emulation:
VIEWPORT=360 node tools/inspect.js http://localhost:4173/ "innerWidth"
```

`tools/preview.html` loads the app with a few sample rows already in it, which
is handy for eyeballing the layout and taking screenshots.

## Layout

```
index.html            markup + the row <template> the table clones
src/
  core/               pure logic, no DOM and no globals
    format.js         parsing typed amounts, formatting output
    alchemy.js        profit / xp / time maths
    items.js          the item record: creation, normalisation, migration
    sorting.js        column accessors and the comparator
  data/
    prices-api.js     OSRS Wiki price client (fetch and cache injected)
    storage.js        persistence, v1 migration, TTL cache
  state/
    store.js          the single observable store
    selectors.js      derived views over state
  ui/
    dom.js            small DOM helpers
    item-table.js     the table
    stats-panel.js    the summary cards
    add-item-form.js  the form and its type-ahead
    settings-panel.js rune price, price basis, bulk actions
    toasts.js         notifications and undo
    app.js            composition root: wires store to views, owns async work
  main.js             the only file that touches document/localStorage/fetch
styles/               tokens.css defines the palette; the rest consume it
tests/                mirrors src/, plus tests/live for the API contract
tools/serve.js        zero-dependency static server
```

The dependency direction is one-way: `ui` → `state` → `data` → `core`. Nothing in
`core` knows the DOM exists, which is why it is the easiest layer to test and
extend.

## How to add things

**A new column.** Add an accessor to `SORT_ACCESSORS` in `src/core/sorting.js` if
it should be sortable, a field to the return value of `computeItem` in
`src/core/alchemy.js` if it is derived, a `<th data-sort="...">` and a
`<td data-cell="...">` in `index.html`, and an entry in `DERIVED_CELLS` in
`src/ui/item-table.js`. `tests/assets.test.js` will fail if you miss one.

**A new setting.** Add it to `createDefaultState` and `hydrate` in
`src/data/storage.js`, a setter on `AppStore`, and a control in
`SettingsView`. Persistence and reload come for free.

**A new API call.** Add a method to `PricesApi`. Tests stub `fetch` through
`tests/helpers/fake-api.js`, so no test ever hits the network.

## Behaviour worth knowing

- **Amount parsing** accepts `10k`, `1.5m`, `2b`, `1,234` and `1.234`
  (dot-grouped thousands). Anything unparseable becomes `0` rather than `NaN`.
- **Buy price basis** defaults to the Grand Exchange *instant-buy* price, which
  is what you actually pay. The old version used the instant-sell price, which
  understated cost. Switch it back in Settings if you prefer the optimistic view.
- **Deletes are undoable.** The old `confirm()` dialogs are gone; removing a row
  or clearing the list shows an Undo toast instead.
- **Old saves are migrated automatically.** v1 stored `alchItems` / `runePrice`
  with `vendor` and `alch` fields; those are read once and rewritten in the v2
  format under `osrs-alch:state:v2`.
- **The item mapping is cached for 24 hours** in localStorage. v1 refetched
  ~860 KB on every page load.
- **Prices refresh on their own** every 5 minutes by default, configurable in
  Settings (off, 1, 5 or 15 minutes). The bulk price endpoint is ~340 KB, so
  only those four intervals are accepted, even in a hand-edited save file.
  Polling pauses while the tab is hidden and catches up when you return, never
  overlaps requests, and does nothing when no item in the list is on the Grand
  Exchange.
- **The Updated column** shows how long ago each price was fetched, colour
  banded from fresh to stale. Items added by hand show a dash: they have no
  Grand Exchange price to age.
- **High alch is read-only.** It is a constant the game assigns to the item, so
  there is no different correct value to type and the cell cannot be edited.
  Nothing rewrites it once the row has one either; it is filled in only when a
  row has no value yet, which is how a hand-added item picks one up after it is
  matched to the Grand Exchange. Editable fields are name, buy price and
  quantity.
- **Typing a buy price pins it.** Auto-refresh will not touch it again: a timer
  no refresh replaces it, manual or automatic. A chain icon next to the value
  marks it as yours; click the chain to hand the row back to the market. The
  market price is still fetched and recorded while the row ignores it, which is
  what the chain offers back and what its tooltip shows.
- **The table never scrolls sideways.** Between 560px and 1150px it sheds
  columns, in order of how easily the number is recovered from the others.
  Below 560px it stops being a table: each row becomes a card with every field
  stacked and labelled, which brings back the columns narrow screens had lost.
  No width sheds enough to fit a phone otherwise.

## Attribution

Price data from the OSRS Wiki real-time prices API. Not affiliated with Jagex Ltd.
RuneScape is a trademark of Jagex Ltd.
