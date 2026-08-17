# Interface sprites

Extracted from the Old School RuneScape cache. Names and ids confirmed against
RuneLite's [`SpriteID`](https://github.com/runelite/runelite/blob/master/runelite-api/src/main/java/net/runelite/api/SpriteID.java)
constants.

| File | Sprite id | RuneLite constant | Size | How it may be used |
|---|---|---|---|---|
| `panel_parchment.png` | 1017 | `CHATBOX` | 519x142 | **9-slice, inset 16.** Uniform bevel frame around flat parchment. |
| `banner_scroll.png` | 436 | `WELCOME_SCREEN_SCROLL_MESSAGE_OF_THE_WEEK` | 503x47 | **9-slice, inset 2 16.** Rolled ends at 16px, black rule top and bottom. |
| `stone_wall.png` | 533 | `TEXTURE_ROOF_TILES_SLATE_GREY` | 128x128 | **Tileable.** Seamless, safe to `repeat`. |
| `tab_strip.png` | 1032 | `FIXED_MODE_TABS_ROW_BOTTOM` | 246x37 | 9-slice only. Currently unused. |

## The rule

A sprite may only be tiled with `background-repeat` if it is **seamless**. In
this cache the `TEXTURE_*` constants are the seamless ones; everything else is a
self-contained widget with a baked-in border, and repeating it stamps that
border across the middle of the element.

Anything not seamless must be either:

- 9-sliced with `border-image`, so the frame stays at the edges at native size
  and only the middle stretches, or
- drawn once at its natural size.

`tests/assets.test.js` enforces this. Two sprites already in `assets/` are worth
knowing about because they caused visible bugs:

- `header_background.png` is sprite 499, `LOGIN_SCREEN_DIALOG_BACKGROUND` — a
  rounded plaque with transparent corners. Tiling it produced a row of slabs.
- `table_background.png` is sprite 1031, `FIXED_MODE_SIDE_PANEL_BACKGROUND` — it
  has a dark vignette down the left and right edges, so tiling it striped the
  panel and stretching it smeared the texture.

Both are superseded by `panel_parchment.png`, whose border is a plain bevel and
therefore survives being stretched along its length.

## Licence

RuneScape and Old School RuneScape are trademarks of Jagex Ltd. These sprites are
Jagex assets used here for a fan-made calculator; they are not covered by this
project's licence.
