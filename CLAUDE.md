# Working in this repo

Static ES-module web app. No build step, no framework, no runtime dependencies.
`jsdom` is the only dev dependency.

## Commands

```bash
npm test              # full offline suite (run this before every commit)
npm run test:watch
npm run test:live     # network; asserts the real price API still matches fixtures
npm run test:layout   # real headless browser; catches layout and sprite bugs
npm run serve         # http://localhost:4173

# Poke at the running page (jsdom cannot answer layout questions):
node tools/inspect.js http://localhost:4173/ "innerWidth"
```

`tools/preview.html` loads the app with sample rows for eyeballing and
screenshots. Screenshots: `msedge --headless=new --screenshot=out.png
--window-size=1400,1450 http://localhost:4173/tools/preview.html`. Chromium
clamps its window to about 492px wide, so a narrower shot crops rather than
reflows — use `tools/inspect.js` to measure, do not trust a narrow screenshot.

## Architecture rules

Dependencies flow one way: `ui` → `state` → `data` → `core`.

- **`src/core/`** is pure. No DOM, no `window`, no `fetch`, no `localStorage`,
  no `Date.now()` without an injectable override. If you need a global here,
  the code belongs in another layer.
- **`src/data/`** owns I/O boundaries. `PricesApi` takes `fetch` and its cache as
  constructor arguments; storage functions take a Web Storage object. Never
  reach for a global directly.
- **`src/state/`** is the single source of truth. Views read state and call store
  methods; they never mutate state and never talk to each other.
- **Never overwrite something the user typed.** The buy price carries an
  `overrides.buyPrice` flag set by an inline edit, and `mergeSnapshot` skips
  it for good: no refresh, manual or automatic, replaces it. Changing it is a
  separate deliberate act — `setOverride`, wired to the Custom price column's
  toggle, which both reports the state and sets it either way.
  `releaseOverride` is the clearing half of that, and restores the last market
  price.
- **Know which fields are market data.** Only `buyPrice` moves with the market.
  `alchPrice` is a fixed game property: it is not in `EDITABLE_FIELDS`, its
  cell is plain rather than `contenteditable`, and `mergeSnapshot` fills it
  only when a row has none and never rewrites it.
- **`src/ui/`** renders and reports intent through handler callbacks. Async work
  belongs in `src/ui/app.js`, not in a view.
- **`src/main.js`** is the only file allowed to touch `document`,
  `localStorage` and the global `fetch`.

Views build DOM from the `<template>` in `index.html` or `document.createElement`.
Do not build markup from strings.

## Testing rules

- Tests never hit the network. Use `createFakeFetch` from
  `tests/helpers/fake-api.js`.
- DOM tests mount the real `index.html` via `tests/helpers/mount.js`. That is
  deliberate: it catches renamed ids and broken selectors.
- `tests/live/api.live.js` is excluded from `npm test` on purpose. When a live
  test fails but the offline suite passes, the API changed — update the fixtures.
- When behaviour is ambiguous, pin it with a test rather than leaving it implicit.

## Style

- Two-space indent, single quotes, semicolons, trailing commas in multi-line
  literals.
- JSDoc on exported functions and classes; skip it on obvious internals.
- Comments explain *why*, not *what*. Several existing comments record v1 bugs
  (`Number(null)` is `0`, `parseFloat(null) ?? 200` is `NaN`) — keep that kind.
- The visual language is the Old School RuneScape *interface*: a flat dark
  backdrop, brown widget panels with a hard two-tone frame, and game text
  carrying the client's 1px black drop shadow. Figures are the loud element.
  Colours, spacing and fonts come from `styles/tokens.css`; do not hard-code a
  hex value in a component stylesheet — `tests/assets.test.js` fails the build
  over a stray `#rrggbb` or `rgb(...)` outside the token file.
- Text colours are the classic chat palette (`--c-yellow`, `--c-gold`,
  `--c-green`, `--c-red`, `--c-blue`, `--c-cyan`). Semantics are named on top of
  them — `--c-profit` is chat green, `--c-item-name` is chat blue — so a rule
  says what it means rather than repeating a hex. Notifications carry their tone
  in the text colour, like a line of chat, never as a coloured edge.
  See `docs/DEVELOPING.md` for the rest of the design notes.

## Sprites

**A sprite may only be `background-repeat`ed if it is seamless.** In the OSRS
cache that means the ones whose RuneLite `SpriteID` constant starts with
`TEXTURE_`. Everything else is a self-contained widget with its frame painted
into the image, and repeating it stamps that frame across the middle of the
element. Non-seamless sprites must be 9-sliced with `border-image` or drawn once.

Nothing in the current stylesheet tiles or 9-slices anything: frames are flat
two-tone borders, the backdrop is a flat colour, and the only sprites left in CSS
are the sort chevrons, drawn once. The rule still holds the moment one comes
back. Slice insets are measured off the sprite and stored as `--slice-*` tokens
next to the sprite they describe. `assets/ui/SPRITES.md` records every sprite's
id, RuneLite constant and permitted use, and why the structural ones were
dropped. Both test suites enforce the rule: `tests/assets.test.js` reads the CSS
source, `tests/layout/layout.check.js` checks what the browser actually
computed.
