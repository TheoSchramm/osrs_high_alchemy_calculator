# Developing

Notes on how the calculator is put together. The front page is [../README.md](../README.md).

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
redistributes them. Fan sites do this routinely and `../assets/ui/SPRITES.md`
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
  the viewport, a control being clipped, or a widget losing its face and
  vanishing into the backdrop.
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

## Look and feel

The interface is the Old School RuneScape *client* rather than the wiki: a flat
dark backdrop, brown widget panels with a hard two-tone frame, and the classic
chat colours for text. Figures are the loud element on the page.

Every colour is a token in `styles/tokens.css` — the chat palette under its own
names (`--c-yellow`, `--c-gold`, `--c-green`, `--c-red`, `--c-blue`,
`--c-cyan`), and the semantics named on top of them, so a rule reads as "profit
is chat green" rather than as a hex. `tests/assets.test.js` fails the build on a
`#rrggbb` or `rgb()` written anywhere but the token file, which is what stops
the palette leaking into a component stylesheet a value at a time.

Panels, controls and the table well are all drawn from the same three ideas: a
painted face, a two-tone frame, and a shadow that says whether the surface is
raised or recessed. Three consequences of that, each with a test behind it:

- **Everything pressable shares one declaration.** `.btn` and the toast's Undo
  button are the same rule, so two controls that should be identical cannot
  drift apart.
- **Notifications are widgets.** Toasts and the `file://` notice are built on
  the panel's own frame and shadow, and say which kind of message they are by
  colouring the line, the way the client colours chat — not with a coloured edge
  down one side, which is a web convention and was the only thing on the page
  not drawn as a game widget.
- **Frames are flat borders, not sprites.** The cache's widget frames are ~35px
  images that smear when stretched across a panel several hundred pixels wide.
  `../assets/ui/SPRITES.md` records what every sprite is, which ones are still
  used (the icons and the sort chevrons, each drawn once) and why the structural
  ones were dropped.

The layout suite guards what the source cannot show: that each widget still has
a face and a frame, that text stands off the panel it sits on, and that no
sprite is tiled.

## Behaviour worth knowing

- **Amount parsing** accepts `10k`, `1.5m`, `2b`, `1,234` and `1.234`
  (dot-grouped thousands). Anything unparseable becomes `0` rather than `NaN`.
- **Buy price basis** defaults to the Grand Exchange *instant-buy* price, which
  is what you actually pay. The old version used the instant-sell price, which
  understated cost. Switch it back in Settings if you prefer the optimistic view.
- **Row actions are undoable rather than confirmed.** The old `confirm()`
  dialogs are gone. Removing a row, clearing the list, unlocking a price and
  refreshing one all take effect at once and put an Undo on the toast that
  reports them: faster to use than a dialog in front of the click, and testable,
  because jsdom has no working `confirm`. Undoing an unlock restores the lock as
  well as the number — giving the price back without it would leave the next
  refresh free to overwrite it.
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
- **A held buy price is never overwritten.** The Custom price column holds one
  toggle per row: ticked, the price is yours and no refresh replaces it,
  manual or automatic. Typing a price ticks it for you; clearing the box hands
  the row back to the market and reports it with an Undo. The market price is
  still fetched and recorded while the row ignores it, which is what clearing
  the box gives back and what the tooltip shows. Rows the API does not know are
  never refreshed, so their toggle is disabled — holding a price there would
  hold off nothing. It replaced a chain badge that could only ever be *cleared*:
  nothing on screen said a row could be held in the first place. The toggle is
  drawn in CSS rather than being a tinted browser checkbox; see
  `../assets/ui/SPRITES.md`.
- **The table never scrolls sideways.** Between 700px and 1150px it sheds
  columns, in order of how easily the number is recovered from the others.
  Below 700px it stops being a table: each row becomes a card with every field
  stacked and labelled, which brings back the columns narrow screens had lost.
  No width sheds enough to fit a phone otherwise.

## Attribution

Price data from the OSRS Wiki real-time prices API. Not affiliated with Jagex Ltd.
RuneScape is a trademark of Jagex Ltd.
