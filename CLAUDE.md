# Working in this repo

Static ES-module web app. No build step, no framework, no runtime dependencies.
`jsdom` is the only dev dependency.

## Commands

```bash
npm test              # full offline suite (run this before every commit)
npm run test:watch
npm run test:live     # network; asserts the real price API still matches fixtures
npm run serve         # http://localhost:4173
```

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
- The visual language is the Old School RuneScape interface. Colours, spacing and
  fonts come from `styles/tokens.css`; do not hard-code a hex value in a
  component stylesheet.
