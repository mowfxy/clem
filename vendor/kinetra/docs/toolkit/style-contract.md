# Toolkit SVG style contract

A toolkit diagram must be indistinguishable in style from a template diagram.
The rules below were extracted from the Scene2D template family (free-body,
projectile, optics, pulley) and their golden outputs in
`packages/core/test/compat/golden/`. The machine-readable form lives in
`packages/core/src/toolkit/style.ts`. `checkToolkitStyle(svg)` returns every
violation, and `style_contract.test.ts` shows that the template goldens pass it.

The toolkit renders through `renderScene2D`, the same pipeline the templates
use. It never writes SVG markup itself, so most of these rules hold by
construction. The checker guards against regressions.

## Document

| Rule | Value |
| --- | --- |
| Header | `<?xml version="1.0" encoding="UTF-8"?>` then a newline |
| Root | `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H" width="W" height="H">`, with the viewBox size equal to width × height |
| Background | `<rect x="0" y="0" width="W" height="H" fill="#fff"/>` immediately before the single scene `<g>` |
| Coordinates | World +y points up. Both axes use the same scale, and the world box is letterboxed and centred (`sceneTransform`). |
| Numbers | Never `NaN` or `Infinity` |

## Text

| Use | Font | Size | Weight | Colour | Placement |
| --- | --- | --- | --- | --- | --- |
| Title | `Inter, system-ui, sans-serif` | 14 | 600 | `#222` | x = W/2, y = 16, `text-anchor="middle"` |
| Caption | `Arial, Helvetica, sans-serif` | 11 | normal | `#555` | x = W/2, y = H − 8, middle |
| Labels | `Arial, Helvetica, sans-serif` | 11, 12 (default) or 13 | normal | palette | `label` shape: a white backdrop rect, then the text |

Label backdrops are opaque white rectangles that are `len × size × 0.62` wide,
as drawn by Scene2D. The toolkit's collision box for a label is the union of
the measured glyph box and this backdrop, so the backdrop can never hide
geometry.

## Strokes and markers

- Stroke widths (px): 0.6, 0.8, 1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2, 2.5 and 3. Rect, circle and polygon outlines are 1, and vector shafts are 1.6.
- Dash patterns: none, `4 4` (dashed) and `3 3` (components).
- Vector arrowheads use one `<marker>` per vector, inside an inline `<defs>`.
  - The id is `arr-<hex code points of the colour string>-<index>`.
  - The marker has `markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto-start-reverse" markerUnits="userSpaceOnUse"`.
  - Its path is `M0,0 L7,3.5 L0,7 Z`, filled with the vector colour.
  - The line references it with `marker-end`.
- Every `marker-end` reference must resolve.

## Palette

Only these colours, by name or hex, are accepted in a composition. Each one
occurs in template output.

| Name | Hex | Template use |
| --- | --- | --- |
| ink | #222 | default stroke and text |
| text | #333 | annotations |
| dimension | #444 | dimension lines |
| caption | #555 | caption |
| constraint | #666 | constraint lines |
| axis | #777 | axes |
| component | #888 | vector components |
| guide | #aaa | dashed guides |
| componentLight | #c8c8c8 | light components |
| grid | #eee | grid |
| white | #fff | background, backdrops |
| body / bodyFill | #1f4f8b / #cfe4ff | FBD body |
| force | #c0392b | forces |
| normal | #377f5c | normal force |
| friction | #357aa6 | friction |
| frame | #66717a | coordinate frame |
| velocity / acceleration | #117a3a / #7a3a11 | kinematics |
| ray / rayAlt / optic | #ba4b37 / #2679a0 / #237f9b | optics |
| mechanism, mechanismDark, mechanismMid, mechanismLight | #526873, #50616b, #586d78, #65757d | pulleys |
| steel / rope | #8a969c / #a0a0a0 | pulleys |
| mechanismFill / surfaceFill | #d6e1e6 / #e8edef | fills |
| greenDark | #38775c | optics |
| point | #225 | projectile points |

## Scripts (toolkit addition)

Sub- and superscripts in toolkit labels are `<tspan>` children of the label
`<text>`; template output never contains them.

| Rule | Value |
| --- | --- |
| Allowed attributes | `font-size` and `dy` only |
| Script size | `round(size × 0.75)`: 8 px for 11, 9 px for 12, 10 px for 13 |
| Shift | `dy` = +0.3 em (subscript) or −0.4 em (superscript), one decimal; a following base run gets the opposite `dy` |
| Limits | `|dy|` ≤ 0.71 em; no tspans in the title |

Labels over plot grid lines additionally get a white halo: a
`<rect fill="#fff" stroke="none">` covering the label box, drawn just before
the label. `checkToolkitStyle` enforces the tspan rules (`TOOLKIT_SCRIPT`).

## Scope

The charged-rod, circuit, logic and timing renderers use their own serif or
schematic styling, and the contract does not describe them. The toolkit
follows the Scene2D family, which covers physics geometry in general.
