# Interface sprites

Two sources, both Jagex assets:

- **Chrome** extracted from the OSRS cache. Ids and names confirmed against
  RuneLite's [`SpriteID`](https://github.com/runelite/runelite/blob/master/runelite-api/src/main/java/net/runelite/api/SpriteID.java)
  constants.
- **Icons** from the vanilla OSRS resource pack, which ships already named.
  Every icon is cropped to its opaque bounding box on the way in, so layout is
  predictable and nothing carries invisible padding.

## Chrome

| File | Sprite id | RuneLite constant | Size | How it may be used |
|---|---|---|---|---|
| `panel_parchment.png` | 1017 | `CHATBOX` | 519x142 | **9-slice, inset 16.** Uniform bevel around flat parchment. |
| `button_primary.png` | — | resource pack `welcome_screen/button_click_here_to_play` | 229x90 | **9-slice, inset 4.** The one call to action. |
| `stone_wall.png` | 533 | `TEXTURE_ROOF_TILES_SLATE_GREY` | 128x128 | **Tileable.** Seamless, safe to `repeat`. |
| `icon_button.png` | — | resource pack `ge/button` | 35x25 | **9-slice, inset 3.** Body of the row icon buttons. |
| `icon_button_hovered.png` | — | resource pack `ge/button_hovered` | 35x25 | Hover state of the above. |
| `item_slot.png` | — | resource pack `ge/selected_item_box` | 40x36 | Drawn once behind each item icon. |
| `scroll_thumb_h.png` | — | composed from `scrollbar/horizontal_thumb_{left,middle,right}` | 15x16 | **9-slice, inset `0 5`.** |
| `scroll_thumb_v.png` | — | composed from `scrollbar/thumb_{top,middle,bottom}` | 16x15 | **9-slice, inset `5 0`.** |

## Icons

| File | Resource pack path | Used for |
|---|---|---|
| `high_alchemy.png` | `normal_spell/high_level_alchemy` | Favicon, site header, "Alching list" |
| `search.png` | `bank/search` | "Add an item" |
| `settings_wrench.png` | `tab/options` | "Settings" |
| `refresh.png` | `other/refresh_icon` | Refresh buttons |
| `trash.png` | `bank/send_to_trash` | Remove item |
| `guide_prices.png` | `button/equipment_guide_prices` | Total spend |

Three of the four **stat cards** deliberately keep the original icons from
`assets/` (`coins`, `xp`, `giant_stopwatch`) rather than pack equivalents: they
are larger and more detailed, which suits a 42px card icon better than the
pack's small interface glyphs. Pack versions of all four were tried and
reverted; they are in git history at `ea206f3`. Total spend is the exception and
uses the pack's money bag.

## Title bars and the table header are drawn in CSS

Both were tried as sprites and both were reverted. The marble plaque
(`welcome_screen/button_marble`) and the stone texture look right at their
native size, but a title bar stretches them to roughly five times their width
and a fraction of their height. Their mottling *is* the texture, so stretching
smears it into mud — the same mistake as tiling a bordered sprite, in the
opposite direction.

The rule that follows: a sprite survives stretching only when the stretched part
is uniform. `panel_parchment` works because its border is a plain bevel and its
field is near-flat. A mottled field does not.

So the panel titles, table header and totals row are flat parchment bands with a
bevel and a dark rule. Because the totals row sets its own colour, which
outranks `.value-profit` / `.value-loss`, `table.css` restates those for
`tfoot`; without it a loss stops reading as a loss, and
`tests/layout/layout.check.js` guards it.

## The rule

A sprite may only be tiled with `background-repeat` if it is **seamless**. In
the cache that means the `TEXTURE_*` constants; in the resource pack it means
the handful of explicit background textures. Everything else is a
self-contained widget with a baked-in border, and repeating it stamps that
border across the middle of the element.

Anything not seamless must be either:

- 9-sliced with `border-image`, so the frame stays at the edges at native size
  and only the middle stretches, or
- drawn once at its natural size.

Slice insets are measured off the sprite and live in `--slice-*` tokens next to
the sprite they describe. Both suites enforce this: `tests/assets.test.js` reads
the CSS source, `tests/layout/layout.check.js` checks what the browser computed.

Two older sprites are kept in `assets/` as cautionary examples, no longer used:

- `header_background.png` is sprite 499, `LOGIN_SCREEN_DIALOG_BACKGROUND` — a
  rounded plaque with transparent corners. Tiling it produced a row of slabs.
- `table_background.png` is sprite 1031, `FIXED_MODE_SIDE_PANEL_BACKGROUND` — a
  dark vignette down the left and right edges, so tiling it striped the panel
  and stretching it smeared the texture.

## Deliberately not used

- `ge/number_field_*` builds the dark Grand Exchange input field. Authentic, but
  a dark field fights the parchment panels and would flip every input to light
  text for no gain.
- `other/list_sorting_arrow_{ascending,descending}` are the real OSRS sort
  arrows, but they are fixed gold on a tan header band. The CSS triangles in
  `table.css` can be coloured for proper contrast, so legibility wins.

## Licence

RuneScape and Old School RuneScape are trademarks of Jagex Ltd. These sprites
are Jagex assets used here for a fan-made calculator; they are not covered by
this project's licence.
