# Interface sprites

Two sources, both Jagex assets:

- **Chrome** extracted from the OSRS cache. Ids and names confirmed against
  RuneLite's [`SpriteID`](https://github.com/runelite/runelite/blob/master/runelite-api/src/main/java/net/runelite/api/SpriteID.java)
  constants.
- **Icons** from the vanilla OSRS resource pack, which ships already named.
  Every icon is cropped to its opaque bounding box on the way in, so layout is
  predictable and nothing carries invisible padding.

The interface is drawn in CSS: a flat backdrop, brown widget faces, and
two-tone flat frames. Sprites are icons and the sort chevrons — nothing
structural. The chrome below is kept because it is measured and documented, and
because the rule at the bottom is what makes a future use of it safe.

## Icons — in use

| File | Resource pack path | Used for |
|---|---|---|
| `high_alchemy.png` | `normal_spell/high_level_alchemy` | Favicon, site header, "Alching list" |
| `search.png` | `bank/search` | "Add an item" |
| `settings_wrench.png` | `tab/options` | "Settings" |
| `refresh.png` | `other/refresh_icon` | Refresh buttons |
| `trash.png` | `bank/send_to_trash` | Remove item |
| `guide_prices.png` | `button/equipment_guide_prices` | Total spend |
| `chevron_up.png` | `chevron/green_up_single` | Sorted ascending |
| `chevron_down.png` | `chevron/green_down_single` | Sorted descending |
| `pinned.png` | `bank/placeholders_lock` | A buy price you typed |

Three of the four **stat cards** deliberately keep the original icons from
`assets/` (`coins`, `xp`, `giant_stopwatch`) rather than pack equivalents: they
are larger and more detailed, which suits a 42px card icon better than the
pack's small interface glyphs. Pack versions of all four were tried and
reverted; they are in git history at `ea206f3`. Total spend is the exception and
uses the pack's money bag.

## Chrome — measured, currently unused

| File | Sprite id | RuneLite constant | Size | If it is ever used again |
|---|---|---|---|---|
| `panel_parchment.png` | 1017 | `CHATBOX` | 519x142 | **9-slice, inset 16.** Uniform bevel around flat parchment. |
| `button_primary.png` | — | resource pack `welcome_screen/button_click_here_to_play` | 229x90 | **9-slice, inset 4.** |
| `stone_wall.png` | 533 | `TEXTURE_ROOF_TILES_SLATE_GREY` | 128x128 | **Tileable.** Seamless, safe to `repeat`. |
| `icon_button.png` | — | resource pack `ge/button` | 35x25 | **9-slice, inset 3.** |
| `icon_button_hovered.png` | — | resource pack `ge/button_hovered` | 35x25 | Hover state of the above. |
| `item_slot.png` | — | resource pack `ge/selected_item_box` | 40x36 | Drawn once behind each item icon. |
| `scroll_thumb_h.png` | — | composed from `scrollbar/horizontal_thumb_{left,middle,right}` | 15x16 | **9-slice, inset `0 5`.** |
| `scroll_thumb_v.png` | — | composed from `scrollbar/thumb_{top,middle,bottom}` | 16x15 | **9-slice, inset `5 0`.** |

Their slice insets are recorded here rather than in `tokens.css`: a token for a
sprite nothing uses is a token that goes stale unnoticed. Anything reinstated
brings its `--slice-*` token back with it, which `tests/assets.test.js`
enforces.

## Why the frames are CSS and not sprites

Every structural sprite was tried and every one was reverted, for the same
reason in two directions.

Stretching: the marble plaque (`welcome_screen/button_marble`), the stone
texture and the brown button (`assets/button.png`, 35x35) look right at native
size, but a panel or a title bar is several times their width and a fraction of
their height. Their mottling *is* the texture, so stretching smears it into mud,
and the button lost its rounding and read as a plain dark box.

Tiling: a sprite with a baked-in border stamps that border across the middle of
whatever it repeats into.

The rule that follows: a sprite survives stretching only when the stretched part
is uniform, and survives tiling only when it is seamless. Flat borders in two
tones of brown reproduce the same bevel, hold their shape at any width, and cost
no request.

Because the totals row sets its own colour, which outranks `.value-profit` /
`.value-loss`, `table.css` restates those for `tfoot`; without it a loss stops
reading as a loss, and `tests/layout/layout.check.js` guards it.

## The rule

A sprite may only be tiled with `background-repeat` if it is **seamless**. In
the cache that means the `TEXTURE_*` constants; in the resource pack it means
the handful of explicit background textures. Everything else is a
self-contained widget with a baked-in border.

Anything not seamless must be either:

- 9-sliced with `border-image`, so the frame stays at the edges at native size
  and only the middle stretches, or
- drawn once at its natural size.

Nothing in the current stylesheet tiles or 9-slices anything: the chevrons are
drawn once and the icons are `<img>` elements. Both suites still enforce the
rule, so it holds the moment a sprite comes back —
`tests/assets.test.js` reads the CSS source, `tests/layout/layout.check.js`
checks what the browser computed.

Two older sprites are kept in `assets/` as cautionary examples:

- `header_background.png` is sprite 499, `LOGIN_SCREEN_DIALOG_BACKGROUND` — a
  rounded plaque with transparent corners. Tiling it produced a row of slabs.
- `table_background.png` is sprite 1031, `FIXED_MODE_SIDE_PANEL_BACKGROUND` — a
  dark vignette down the left and right edges, so tiling it striped the panel
  and stretching it smeared the texture.

## Deliberately not used

- `ge/number_field_*` builds the dark Grand Exchange input field. The inputs are
  now dark anyway, but as a CSS recess: the sprite is a fixed-width field and
  every input here is fluid.
- `other/list_sorting_arrow_{ascending,descending}` are the real OSRS sort
  arrows, but they are fixed gold and would barely read against the header
  band's own colour. The green chevrons carry a black outline, which is what
  lets them sit on any band, so they are used instead.

## Sort indicators

Only the column actually in use is marked. Unsorted headers carry nothing: the
pointer cursor and the hover highlight already say they are clickable, and an
indicator on all eight columns competed with the one that mattered. Dropping it
also gives the width back to a table that has to fit without a scrollbar.

The chevron is positioned absolutely against the header cell rather than sitting
in the text flow. In flow it is an atomic inline, so the browser may break it
onto its own line once a header label wraps — and these labels do wrap, on
purpose.

The chain badge in the buy-price cell gets the opposite treatment: it is inline,
nudged up 2px, because `vertical-align: middle` centres a box on the x-height
and this font's x-height sits below the optical centre of its caps, so the badge
otherwise reads low against the figure beside it.

## Licence

RuneScape and Old School RuneScape are trademarks of Jagex Ltd. These sprites
are Jagex assets used here for a fan-made calculator; they are not covered by
this project's licence.
