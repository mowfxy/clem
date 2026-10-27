# Toolkit parts catalogue

Generated from the part registry by `npm run docs:toolkit-parts`; do not edit by hand.

The library adds 92 part types to the 11 basic shapes described in [engine.md](engine.md#basic-parts-agent-1) (point, rect/box, block, circle, segment, polyline, polygon, arc, arrow/force, curve, text).

| Category | Parts |
| --- | --- |
| General | 12 |
| Mechanics and structures | 21 |
| Fields and electromagnetism | 8 |
| Fluids and thermodynamics | 8 |
| Circuits | 27 |
| Logic and controls | 7 |
| Plots | 9 |

Contact sheets of every part: [contact-sheet/](contact-sheet/) (SVG and PNG per category).

## Conventions

- **World units.** Sizes are world units unless an option says px. Circuit and logic symbols keep the template schematic's proportions; use `scale` (circuits) or `w` (gates) to size them for the canvas zoom.
- **Placed parts** take `at` or `place` relations for their origin (named in the description). **Point parts** take point references (`"id.anchor"`, `{"x":..,"y":..}`, `{"ref":..,"dx":..}`).
- **Anchors** are named points other elements can refer to as `"id.anchor"`; `name(arg)` anchors take a number, a length or an angle, e.g. `"beam.top(0.5)"`, `"pulley.rim(30 deg)"`, `"gate.in(1)"`.
- **Contacts.** Parts that sit on or connect to other parts may touch them without `mayTouch`: connectors, leaders, ropes, springs, dampers, loads, wires and pipes touch the elements their end points name; supports, pivots, hinges, moments, junctions and take-off points touch what they are attached to; series and plot annotations touch their axes; transitions and self-loops touch their states. Any other contact still needs `mayTouch`, and **text is never excused**: a line through a part's own text (tick labels, symbol letters, table cells) is an E_COLLISION even between parts allowed to touch.
- **Text inside symbols** (meter letters, gate marks, state names, box text) must fit inside its frame at the current zoom; otherwise E_INVALID_VALUE asks for a larger `scale`/size.
- **Style.** Every part draws only Scene2D shapes in palette colours and contract stroke widths, so output matches the template renderers ([style-contract.md](style-contract.md)).
- **Checks.** Parts expose values to declared checks as `<id>.<name>` (listed under *Refs* where a part has them), e.g. `shade.area`, `slopeTriangle.slope`, `incline.angle`, `rope.length`, `truss.members`.

## General

### `roundedBox`

Box with optional rounded corners and centred text (block-diagram blocks, flow-chart steps, panels); origin at its centre.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `panel`, `tfBlock`, `blockDiagramBlock`

| Option | Meaning |
| --- | --- |
| `w` | width |
| `h` | height |
| `r` | corner radius (world, default 0) |
| `rotation` | degrees |
| `fill` | palette colour |
| `stroke` | palette colour |
| `text` | centred text |
| `textSize` | 11-13 |
| `textColor` | palette colour |

**Anchors:** `center`, `top`, `bottom`, `left`, `right`, `topLeft`, `topRight`, `bottomLeft`, `bottomRight`, `topAt(t)`, `bottomAt(t)`, `leftAt(t)`, `rightAt(t)`

```json
{ "id": "roundedBox", "type": "roundedBox", "at": { "x": 2, "y": 1.5 }, "w": 1.609, "h": 0.819, "r": 0.3, "text": "Plant" }
```

### `circleNode`

Circle with centred text (graph nodes, states, junction labels); origin at its centre.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `node`

| Option | Meaning |
| --- | --- |
| `r` | radius |
| `fill` | palette colour (default white) |
| `stroke` | palette colour |
| `text` | centred text |
| `textSize` | 11-13 |
| `textColor` | palette colour |

**Anchors:** `center`, `top`, `bottom`, `left`, `right`, `rim(angle)`

```json
{ "id": "circleNode", "type": "circleNode", "at": { "x": 2, "y": 1.5 }, "r": 0.453, "text": "A" }
```

### `textBlock`

Multi-line text, optionally framed; origin at the block centre. Lines are given as a list or split on \n.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `paragraph`

| Option | Meaning |
| --- | --- |
| `text` | string with \n, or |
| `lines` | list of strings |
| `size` | 11-13 |
| `align` | left \| center \| right |
| `frame` | draw a box |
| `padding` | px inside the frame (default 4) |
| `fill` | frame fill |
| `color` | text colour |

**Anchors:** `center`, `top`, `bottom`, `left`, `right`, `topLeft`, `topRight`, `bottomLeft`, `bottomRight`, `line(i)`

```json
{ "id": "textBlock", "type": "textBlock", "at": { "x": 2, "y": 1.5 }, "lines": ["Given:", "m = 2 kg", "v₀ = 3 m/s"], "align": "left", "frame": true}
```

### `curvedArrow`

Curved arrow along a circular arc from `from` to `to`, bulging to the left of the direction of travel by bend x chord (negative bends right). Head at `to`; `double` adds one at `from`.

**Positioning:** by point references · **Aliases:** `arcArrow`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `bend` | -0.45..0.45, default 0.25 |
| `double` | heads at both ends |
| `color` | palette colour |
| `width` | shaft px (default 1.6) |
| `labelAt` | label slot t in [0,1] (default 0.5) |

**Anchors:** `start`, `end`, `mid`, `apex`, `center`, `at(t)`, `slot(t)`

```json
{ "id": "curvedArrow", "type": "curvedArrow", "from": { "x": 0.8, "y": 1.2 }, "to": { "x": 3.2, "y": 1.2 }, "bend": 0.202, "double": true, "color": "velocity" }
```

### `doubleArrow`

Straight arrow with heads at both ends (drawn as two Scene2D vectors from the midpoint, so the heads match every other arrow).

**Positioning:** by point references · **Aliases:** `twoWayArrow`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `color` | palette colour |
| `dashed` | boolean |
| `labelAt` | label slot t (default 0.5) |

**Anchors:** `start`, `end`, `mid`, `at(t)`, `slot(t)`

```json
{ "id": "doubleArrow", "type": "doubleArrow", "from": { "x": 0.953, "y": 2.087 }, "to": { "x": 3.047, "y": 0.913 }, "dashed": true}
```

### `connector`

Line between two anchors: straight, orthogonal (routed around the endpoint parts and any `avoid` parts with few bends and few crossings of other connectors in `avoid`) or curved. Ends: arrow, dot or none. It may touch the parts it connects, and it may cross another straight or orthogonal connector cleanly (at 30° or more, 10 px from corners and ends) without mayTouch.

**Positioning:** by point references · **Aliases:** `wireArrow`, `link`, `signal`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `route` | straight \| orthogonal \| curved |
| `via` | explicit corner points (orthogonal; skips routing) |
| `start` | none \| arrow \| dot |
| `end` | arrow (default) \| dot \| none |
| `fromSide` | exit direction left/right/up/down (default: inferred) |
| `toSide` | entry side of the target |
| `avoid` | element ids to route around |
| `margin` | px clearance from bodies (default 12) |
| `labelAt` | label slot t |
| `color` | palette colour |
| `width` | px (default 1.4) |
| `dashed` | boolean |

**Anchors:** `start`, `end`, `mid`, `at(t)`, `slot(t)`, `bend(i)`

```json
{ "id": "connector", "type": "connector", "from": "connector_a.right", "to": "connector_b.left", "route": "straight", "end": "arrow" }
{ "id": "connector_a", "type": "roundedBox", "at": { "x": 0.9, "y": 1.95 }, "w": 0.9, "h": 0.5, "text": "A" }
{ "id": "connector_b", "type": "roundedBox", "at": { "x": 3.1, "y": 1.95 }, "w": 0.9, "h": 0.5, "text": "B" }
```

### `brace`

Curly brace spanning `from` to `to`; its tip points to the left of the direction of travel (side: right flips it).

**Positioning:** by point references · **Aliases:** `curlyBrace`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `side` | left (default) \| right of from->to |
| `depth` | tip depth (world, default 12% of the span, at most 0.4) |
| `color` | palette colour |
| `width` | px (default 1.2) |

**Anchors:** `start`, `end`, `mid`, `tip`

```json
{ "id": "brace", "type": "brace", "from": { "x": 3.2, "y": 1.3 }, "to": { "x": 0.8, "y": 1.3 }}
```

### `dimension`

Engineering dimension between two points: extension lines, a dimension line offset to the left of from->to (negative: right) with inward heads, and its value as text. The default text is the measured length in `unit` (default: the canvas world unit).

**Positioning:** by point references · **Aliases:** `dimensionLine`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `offset` | world, signed (default 0.4) |
| `text` | override the measured text |
| `unit` | display unit, e.g. cm |
| `precision` | significant decimals (default 2) |
| `color` | palette colour (default dimension #444) |
| `textSize` | 11-13 |

**Anchors:** `start`, `end`, `mid`, `text`

```json
{ "id": "dimension", "type": "dimension", "from": { "x": 0.8, "y": 1 }, "to": { "x": 3.2, "y": 1 }, "offset": 0.502, "unit": "m" }
```

### `angleArc`

Angle mark at `vertex` from the ray toward `start` counter-clockwise to the ray toward `end` (or from/to angles). Optional arrowhead, a right-angle square, and text on the bisector.

**Positioning:** by point references · **Aliases:** `angleMark`

| Option | Meaning |
| --- | --- |
| `vertex` | point |
| `start` | point on the first ray |
| `end` | point on the second ray |
| `fromAngle` | instead of start (deg) |
| `toAngle` | instead of end (deg) |
| `r` | radius (world, default 0.4) |
| `arrow` | head at the end |
| `square` | draw a right-angle square (90 deg only) |
| `text` | e.g. \theta |
| `textSize` | 11-13 |
| `color` | palette colour |
| `width` | px (default 1) |

**Anchors:** `vertex`, `start`, `end`, `mid`, `text`, `at(angle)`

```json
{ "id": "angleArc", "type": "angleArc", "vertex": "angleArc_a.start", "start": "angleArc_a.end", "end": "angleArc_b.end", "r": 0.6, "text": "θ", "arrow": true}
{ "id": "angleArc_a", "type": "segment", "from": { "x": 0.8, "y": 0.8 }, "to": { "x": 3.3, "y": 0.8 }}
{ "id": "angleArc_b", "type": "segment", "from": { "x": 0.8, "y": 0.8 }, "to": { "x": 2.515, "y": 1.619 }, "mayTouch": ["angleArc_a"]}
```

### `leader`

Callout: a marker at `target`, a leader line to an elbow at target + (dx, dy), a short horizontal landing and the text. The text side follows the sign of dx.

**Positioning:** by point references · **Aliases:** `callout`

| Option | Meaning |
| --- | --- |
| `target` | point |
| `text` | callout text |
| `dx` | world offset to the elbow (default 0.8) |
| `dy` | world offset (default 0.5) |
| `marker` | dot \| arrow (default) \| none |
| `size` | 11-13 |
| `color` | palette colour (default text #333) |

**Anchors:** `target`, `elbow`, `text`

```json
{ "id": "leader", "type": "leader", "target": "leader_p", "text": "pivot", "dx": 0.7, "dy": 0.5 }
{ "id": "leader_p", "type": "point", "at": { "x": 1.1, "y": 1.1 }}
```

### `legend`

Legend box: one row per entry with a swatch (line, dashed, arrow, box, dot, circle) and text. Origin at its centre (attach topLeft etc. to place a corner).

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `key`

| Option | Meaning |
| --- | --- |
| `entries` | [{text, kind: line\|dashed\|arrow\|box\|dot\|circle, color, fill}] |
| `size` | 11-13 (default 11) |
| `frame` | draw the frame (default true) |

**Anchors:** `center`, `top`, `bottom`, `left`, `right`, `topLeft`, `topRight`, `bottomLeft`, `bottomRight`, `entry(i)`

```json
{ "id": "legend", "type": "legend", "at": { "x": 2, "y": 1.5 }, "entries": [{ "text": "measured", "kind": "dot", "color": "ink" },{ "text": "model", "kind": "line", "color": "rayAlt" },{ "text": "force", "kind": "arrow", "color": "force" }]}
```

### `table`

Table of text cells with ruled lines; a header row is separated by a heavier rule. Cell sizes follow the text. Origin at its centre.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `grid`

| Option | Meaning |
| --- | --- |
| `rows` | list of rows, each a list of strings or numbers |
| `header` | first row is a header (default true) |
| `size` | 11-13 (default 11) |
| `padding` | px (default 5) |
| `align` | left \| center |

**Anchors:** `center`, `top`, `bottom`, `left`, `right`, `topLeft`, `topRight`, `bottomLeft`, `bottomRight`, `row(i)`, `col(j)`, `cell(k)`

```json
{ "id": "table", "type": "table", "at": { "x": 2, "y": 1.5 }, "rows": [["x", "y"],[0,0],[1,1],[2,4]]}
```

## Mechanics and structures

### `beam`

Beam drawn as a bar of the given depth centred on the line from `from` to `to`. Load and support parts attach to its anchors.

**Positioning:** by point references · **Aliases:** `bar`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `depth` | bar depth (world, default 0.2) |
| `fill` | palette colour (default mechanismFill) |
| `stroke` | palette colour (default mechanismMid) |

**Anchors:** `start`, `end`, `mid`, `at(t)`, `atDistance(d)`, `top(t)`, `bottom(t)`, `topStart`, `topEnd`, `bottomStart`, `bottomEnd`

```json
{ "id": "beam", "type": "beam", "from": { "x": 0.5, "y": 1.5 }, "to": { "x": 3.5, "y": 1.5 }}
{ "id": "beam_s1", "type": "pinSupport", "place": { "attach": "top", "to": "beam.bottom(0)" }}
{ "id": "beam_s2", "type": "rollerSupport", "place": { "attach": "top", "to": "beam.bottom(1)" }}
{ "id": "beam_F", "type": "pointLoad", "tip": "beam.top(0.4)", "length": 0.7 }
```

### `pinSupport`

Pin support: a triangle with its pin at the origin, on hatched ground.

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `rotation` | degrees; 0 = ground below, the support pushes +y |
| `scale` | size factor (default 1) |
| `fill` | triangle fill (default mechanismFill) |

**Anchors:** `top`, `contact`, `base`, `left`, `right`

```json
{ "id": "pinSupport", "type": "pinSupport", "at": { "x": 2, "y": 1.8 }, "scale": 1.6 }
```

### `rollerSupport`

Roller support: pin triangle on two rollers, on hatched ground.

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `rotation` | degrees; 0 = ground below, the support pushes +y |
| `scale` | size factor (default 1) |
| `fill` | triangle fill (default mechanismFill) |

**Anchors:** `top`, `contact`, `base`, `left`, `right`

```json
{ "id": "rollerSupport", "type": "rollerSupport", "at": { "x": 2, "y": 1.8 }, "scale": 1.6 }
```

### `fixedSupport`

Fixed (clamped) support: a wall face through the origin with hatching behind it. Rotate 90 deg for a side wall.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `clamp`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees; 0 = ground below, the support pushes +y |
| `scale` | size factor (default 1) |
| `fill` | triangle fill (default mechanismFill) |

**Anchors:** `top`, `contact`, `base`, `left`, `right`

```json
{ "id": "fixedSupport", "type": "fixedSupport", "at": { "x": 2, "y": 1.5 }, "rotation": 0, "scale": 1.6 }
```

### `hinge`

Internal hinge or pin joint: a small open circle (white fill) at the origin. It may sit on the members it joins (list them in mayTouch).

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `pin`, `joint`

| Option | Meaning |
| --- | --- |
| `r` | radius (world, default 0.07) |

**Anchors:** `center`, `rim(angle)`

```json
{ "id": "hinge", "type": "hinge", "at": { "x": 2, "y": 1.5 }, "r": 0.12, "mayTouch": ["hinge_a", "hinge_b"]}
{ "id": "hinge_a", "type": "beam", "from": { "x": 0.6, "y": 1.5 }, "to": { "x": 1.95, "y": 1.5 }, "depth": 0.16 }
{ "id": "hinge_b", "type": "beam", "from": { "x": 2.05, "y": 1.5 }, "to": { "x": 3.4, "y": 1.2 }, "depth": 0.16 }
```

### `ground`

Hatched surface from `from` to `to`. Hatching goes on the `side` of the direction of travel; defaults: ground/surface/hatch right (below a left-to-right line), ceiling left (above), wall left (behind an upward line). Its surface is straight, so round parts can be tangentTo it.

**Positioning:** by point references · **Aliases:** `wall`, `ceiling`, `hatch`, `surface`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `side` | left \| right of from->to |
| `width` | surface line px (default 1.5) |
| `color` | palette colour (default ink) |

**Anchors:** `start`, `end`, `mid`, `at(t)`

```json
{ "id": "ground", "type": "ground", "from": { "x": 0.5, "y": 1.5 }, "to": { "x": 3.5, "y": 1.5 }}
```

### `pulley`

Pulley wheel with its axle; origin at the centre. Ropes wrap it with exact tangency (rope `route` items {around: id}).

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `sheave`

| Option | Meaning |
| --- | --- |
| `r` | radius |
| `fill` | palette colour (default surfaceFill) |
| `stroke` | palette colour (default mechanismLight) |

**Anchors:** `center`, `axle`, `top`, `bottom`, `left`, `right`, `rim(angle)`

```json
{ "id": "pulley", "type": "pulley", "at": { "x": 2, "y": 1.5 }, "r": 0.6 }
```

### `rope`

Rope along `route`: point references and {around: pulleyId, dir: cw|ccw} items. Straight runs are exact common tangents of the wrapped wheels and the rope follows each rim between its contact points. It may touch the wheels it wraps and the parts its end points name.

**Positioning:** by point references · **Aliases:** `string`, `belt`

| Option | Meaning |
| --- | --- |
| `route` | [point, {around: id, dir: "cw"\|"ccw"}, ..., point] |
| `color` | palette colour (default dimension #444) |
| `width` | px (default 1.5) |

**Anchors:** `start`, `end`, `mid`, `at(t)`, `contact(k)`

```json
{ "id": "rope", "type": "rope", "route": ["rope_m1.top",{ "around": "rope_p", "dir": "cw" }, "rope_m2.top"]}
{ "id": "rope_p", "type": "pulley", "at": { "x": 2, "y": 2.2 }, "r": 0.5 }
{ "id": "rope_m1", "type": "mass", "at": { "x": 1.5, "y": 0.9 }, "w": 0.5, "h": 0.4, "text": "m₁" }
{ "id": "rope_m2", "type": "mass", "at": { "x": 2.5, "y": 1.1 }, "w": 0.5, "h": 0.4, "text": "m₂" }
```

### `coilSpring`

Zig-zag spring from `from` to `to`. The coil count adapts to the length (about one coil per 12 px) unless `coils` is given; the gate rejects a pitch under 5 px.

**Positioning:** by point references · **Aliases:** `zigzagSpring`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `coils` | number of coils (default adaptive) |
| `amplitude` | half-width (world, default 7 px) |
| `lead` | straight end fraction (default 0.15) |
| `color` | palette colour |
| `width` | px (default 1.4) |

**Anchors:** `start`, `end`, `mid`

```json
{ "id": "coilSpring", "type": "coilSpring", "from": "coilSpring_w.mid", "to": "coilSpring_m.left" }
{ "id": "coilSpring_w", "type": "wall", "from": { "x": 0.5, "y": 0.9 }, "to": { "x": 0.5, "y": 2.1 }}
{ "id": "coilSpring_m", "type": "mass", "at": { "x": 2.804, "y": 1.5 }, "w": 0.6, "h": 0.6 }
```

### `damper`

Viscous damper (dashpot) from `from` to `to`: a cylinder on the `from` side and a piston on a rod from `to`.

**Positioning:** by point references · **Aliases:** `dashpot`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `bodyWidth` | cylinder width (world, default 14 px) |
| `color` | palette colour |
| `width` | px (default 1.4) |

**Anchors:** `start`, `end`, `mid`

```json
{ "id": "damper", "type": "damper", "from": "damper_w.mid", "to": "damper_m.left" }
{ "id": "damper_w", "type": "wall", "from": { "x": 0.5, "y": 0.9 }, "to": { "x": 0.5, "y": 2.1 }}
{ "id": "damper_m", "type": "mass", "at": { "x": 3, "y": 1.5 }, "w": 0.6, "h": 0.6 }
```

### `mass`

A mass: a box (or a ball) in the pulley template's colours with centred text (default "m"). Origin at its centre; anchors include `hook` on top.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `weight`, `load`

| Option | Meaning |
| --- | --- |
| `w` | width (box) / diameter (ball) |
| `h` | height (box, default w) |
| `shape` | box \| ball |
| `rotation` | degrees |
| `text` | centred text (default m; "" for none) |
| `fill` | palette colour |
| `stroke` | palette colour |
| `textSize` | 11-13 |

**Anchors:** `center`, `top`, `bottom`, `left`, `right`, `hook`, `topLeft`, `topRight`, `bottomLeft`, `bottomRight`

```json
{ "id": "mass", "type": "mass", "at": { "x": 2, "y": 1.5 }, "w": 0.9, "h": 0.7, "shape": "box", "text": "M" }
```

### `pivot`

Fulcrum: a triangle with its apex at the origin standing on hatched ground (rotate for other orientations).

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `fulcrum`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees |
| `scale` | size factor |
| `fill` | palette colour (default surfaceFill) |

**Anchors:** `apex`, `base`, `left`, `right`

```json
{ "id": "pivot", "type": "pivot", "at": { "x": 2, "y": 1.8 }, "scale": 1.8 }
```

### `spokedWheel`

Wheel with a hub and spokes; origin at the centre. Round, so it can be tangentTo a ground, incline or another wheel.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `cartWheel`, `roller`

| Option | Meaning |
| --- | --- |
| `r` | radius |
| `spokes` | 0-12 (default 6) |
| `fill` | palette colour (default surfaceFill) |
| `stroke` | palette colour (default mechanismLight) |

**Anchors:** `center`, `hub`, `top`, `bottom`, `left`, `right`, `contact`, `rim(angle)`

```json
{ "id": "spokedWheel", "type": "spokedWheel", "r": 0.6, "place": [{ "tangentTo": "spokedWheel_g", "side": "above" },{ "x": 2 }], "mayTouch": ["spokedWheel_g"]}
{ "id": "spokedWheel_g", "type": "ground", "from": { "x": 0.5, "y": 0.7 }, "to": { "x": 3.5, "y": 0.7 }}
```

### `incline`

Right-triangle incline with its toe (the low corner where the slope starts) at the origin; base length and angle set the shape. The slope is a straight surface (tangentTo, surface(t)). An optional angle mark sits at the toe.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `wedge`, `ramp`

| Option | Meaning |
| --- | --- |
| `base` | base length |
| `angle` | slope angle (default 30) |
| `rises` | right (default) \| left |
| `mark` | draw the angle mark (default true) |
| `markText` | mark text (default \theta) |
| `fill` | palette colour (default surfaceFill) |
| `stroke` | palette colour |

**Anchors:** `toe`, `top`, `corner`, `surfaceMid`, `baseMid`, `centroid`, `surface(t)`, `surfaceAt(d)`

```json
{ "id": "incline", "type": "incline", "at": { "x": 0.5, "y": 0.6 }, "base": 3, "angle": 25.117 }
{ "id": "incline_b", "type": "block", "w": 0.6, "h": 0.4, "rotation": 25.117, "place": { "attach": "bottom", "to": "incline.surface(0.6)" }, "mayTouch": ["incline"]}
```

### `truss`

Pin-jointed truss: `joints` (points) and `members` (index pairs). Members are drawn as bars, joints as pins. Exposes joint(k) and member(k) anchors and joints/members counts for checks (e.g. m + r = 2j).

**Positioning:** by point references · **Aliases:** `frame`

| Option | Meaning |
| --- | --- |
| `joints` | list of points |
| `members` | list of [i, j] joint index pairs |
| `width` | member px (default 2.5) |
| `color` | palette colour (default mechanism) |
| `jointR` | pin radius px (default 3.5) |

**Anchors:** `joint(k)`, `member(k)`, `centroid`

```json
{ "id": "truss", "type": "truss", "joints": [{ "x": 0.6, "y": 0.9 },{ "x": 2, "y": 0.9 },{ "x": 3.4, "y": 0.9 },{ "x": 1.3, "y": 2.1 },{ "x": 2.7, "y": 2.1 }], "members": [[0,1],[1,2],[0,3],[3,1],[1,4],[4,2],[3,4]]}
```

### `cable`

Hanging cable from `from` to `to` that sags `sag` below the chord at mid-span (parabolic profile, exact for a uniform load per horizontal length). Exposes the lowest point.

**Positioning:** by point references · **Aliases:** `catenary`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `sag` | mid-span sag below the chord (world, default 15% of the span) |
| `color` | palette colour (default steel) |
| `width` | px (default 1.6) |

**Anchors:** `start`, `end`, `mid`, `lowest`, `at(t)`

```json
{ "id": "cable", "type": "cable", "from": { "x": 0.5, "y": 2.1 }, "to": { "x": 3.5, "y": 1.706 }, "sag": 0.9 }
```

### `gear`

Symbolic spur gear: a toothed outline around the pitch circle (dashed) with a hub; origin at the centre. Its radius is the pitch radius, so two gears placed tangentTo each other mesh at the pitch point (they need mayTouch).

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `spurGear`

| Option | Meaning |
| --- | --- |
| `r` | pitch radius |
| `teeth` | 6-80 (default from size) |
| `depth` | tooth depth (world, default 8% of r) |
| `phase` | rotation of the teeth (degrees) |
| `fill` | palette colour (default mechanismFill) |
| `stroke` | palette colour (default mechanism) |

**Anchors:** `center`, `top`, `bottom`, `left`, `right`, `pitch(angle)`

```json
{ "id": "gear", "type": "gear", "at": { "x": 1.45, "y": 1.5 }, "r": 0.75, "teeth": 18 }
{ "id": "gear_b", "type": "gear", "r": 0.45, "teeth": 11, "phase": 16.4, "place": [{ "tangentTo": "gear" },{ "y": 1.5 }], "prefer": "right", "mayTouch": ["gear"]}
```

### `pointLoad`

Point load: an arrow whose TIP is at `tip`, pointing along `angle` (default -90 = downward). Give `length` (world) or `magnitude` (a quantity at the declared scale; quantity defaults to force, so it counts in vectorSum/momentSum).

**Positioning:** by point references · **Aliases:** `load_arrow`, `concentratedLoad`

| Option | Meaning |
| --- | --- |
| `tip` | point the load acts on |
| `angle` | direction of the force (default -90) |
| `length` | drawn length (world) |
| `magnitude` | quantity, e.g. "12 kN" |
| `quantity` | scale name (default force) |
| `color` | palette colour (default force) |

**Anchors:** `tip`, `tail`, `mid`

```json
{ "id": "pointLoad", "type": "pointLoad", "tip": "pointLoad_b.top(0.5)", "length": 0.9 }
{ "id": "pointLoad_b", "type": "beam", "from": { "x": 0.6, "y": 1.1 }, "to": { "x": 3.4, "y": 1.1 }}
```

### `distributedLoad`

Distributed load on the line from `from` to `to`: arrows pointing onto the line from its `side`, with heights varying linearly from `height` to `endHeight` (uniform when equal, triangular when one is 0) and an envelope line. Exposes `resultant` (the centroid of the load diagram on the line).

**Positioning:** by point references · **Aliases:** `udl`, `pressureLoad`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `height` | arrow length at from (world) |
| `endHeight` | arrow length at to (default = height) |
| `side` | left (default, above a left-to-right beam) \| right |
| `spacing` | px between arrows (default 22) |
| `color` | palette colour (default force) |

**Anchors:** `start`, `end`, `mid`, `resultant`, `topStart`, `topEnd`

```json
{ "id": "distributedLoad", "type": "distributedLoad", "from": "distributedLoad_b.topStart", "to": "distributedLoad_b.topEnd", "height": 0.7, "endHeight": 0.7 }
{ "id": "distributedLoad_b", "type": "beam", "from": { "x": 0.6, "y": 1 }, "to": { "x": 3.4, "y": 1 }}
```

### `moment`

Applied moment: a curved arrow around the origin, counter-clockwise or clockwise. Origin at the centre (attach it to a beam point).

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `momentArc`, `couple`, `torque`

| Option | Meaning |
| --- | --- |
| `r` | radius (world, default 0.35) |
| `direction` | ccw (default) \| cw |
| `start` | start angle (default -60) |
| `sweep` | degrees (default 270) |
| `color` | palette colour (default force) |
| `width` | px (default 1.6) |

**Anchors:** `center`, `start`, `end`

```json
{ "id": "moment", "type": "moment", "at": { "x": 2, "y": 1.5 }, "r": 0.6, "direction": "ccw", "label": "M₀" }
```

### `triad`

Coordinate triad at the origin: x and y arrows (rotatable) with their names, and optionally a z axis out of the page (dot in circle) or into it (cross in circle).

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `axesTriad`, `coordinateFrame`

| Option | Meaning |
| --- | --- |
| `length` | arrow length (world, default 0.8) |
| `rotation` | degrees |
| `x` | x-axis name (default x) |
| `y` | y-axis name (default y) |
| `z` | none (default) \| out \| in |
| `zText` | z-axis name (default z) |
| `color` | palette colour (default frame) |

**Anchors:** `origin`, `xTip`, `yTip`

```json
{ "id": "triad", "type": "triad", "at": { "x": 1.6, "y": 1 }, "length": 1.1, "rotation": 0, "z": "none" }
```

## Fields and electromagnetism

### `charge`

Point charge: a circle with a + or − sign (positive in the force red, negative in rayAlt blue). Round, so field lines and tangency can use it.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `pointCharge`

| Option | Meaning |
| --- | --- |
| `sign` | + (default) \| - |
| `r` | radius (world, default 9 px) |
| `filled` | tinted fill (default false: white) |
| `color` | palette colour override |

**Anchors:** `center`, `top`, `bottom`, `left`, `right`, `rim(angle)`

```json
{ "id": "charge", "type": "charge", "at": { "x": 1.4, "y": 1.5 }, "sign": "+", "r": 0.3, "label": "+q" }
{ "id": "charge_b", "type": "charge", "at": { "x": 2.7, "y": 1.5 }, "sign": "-", "r": 0.3 }
```

### `pageVector`

A vector perpendicular to the page: a circle with a dot (out of the page) or a cross (into the page). outOfPage / intoPage set the default direction.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `dotCross`, `outOfPage`, `intoPage`

| Option | Meaning |
| --- | --- |
| `direction` | out \| in |
| `r` | radius (world, default 7 px) |
| `color` | palette colour (default #225) |

**Anchors:** `center`, `rim(angle)`

```json
{ "id": "pageVector", "type": "pageVector", "at": { "x": 1.5, "y": 1.5 }, "direction": "out", "r": 0.2, "label": "B" }
{ "id": "pageVector_in", "type": "pageVector", "at": { "x": 2.6, "y": 1.5 }, "direction": "in", "r": 0.2 }
```

### `magnet`

Bar magnet (N half in force red, S half in rayAlt blue, letters in their halves) or a horseshoe magnet; origin at the centre, north to +x before rotation.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `barMagnet`

| Option | Meaning |
| --- | --- |
| `w` | length (default 1.6) |
| `h` | thickness (default 0.45) |
| `rotation` | degrees |
| `kind` | bar \| horseshoe |
| `northColor` | palette colour |
| `southColor` | palette colour |

**Anchors:** `center`, `north`, `south`, `northFace`, `southFace`, `top`, `bottom`

```json
{ "id": "magnet", "type": "magnet", "at": { "x": 1.7, "y": 1.5 }, "kind": "horseshoe", "w": 1.6, "h": 0.4 }
```

### `solenoid`

Solenoid seen from the side along the axis `from` -> `to`: each turn is an ellipse whose front half is solid and back half dashed in guide grey, with optional leads and an iron core.

**Positioning:** by point references · **Aliases:** `coil`

| Option | Meaning |
| --- | --- |
| `from` | axis start |
| `to` | axis end |
| `turns` | number of turns (default from length) |
| `radius` | coil radius (world, default 0.35) |
| `leads` | draw the two leads (default true) |
| `core` | draw an iron core (default false) |
| `color` | palette colour (default mechanism) |
| `width` | px (default 1.4) |

**Anchors:** `start`, `end`, `mid`, `leadStart`, `leadEnd`, `top`, `bottom`

```json
{ "id": "solenoid", "type": "solenoid", "from": { "x": 0.7, "y": 1.6 }, "to": { "x": 3.3, "y": 1.6 }, "radius": 0.45, "turns": 8, "core": true}
```

### `plates`

Parallel charged plates centred on the origin, `gap` apart (the + plate on top before rotation), with optional + / − marks and uniform field arrows from + to −.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `parallelPlates`, `capacitorPlates`

| Option | Meaning |
| --- | --- |
| `gap` | plate separation |
| `length` | plate length |
| `rotation` | degrees |
| `charges` | draw + and − marks (default true) |
| `field` | number of field arrows (default 0) |
| `color` | plate colour (default ink) |

**Anchors:** `center`, `plus`, `minus`, `plusStart`, `plusEnd`, `minusStart`, `minusEnd`

```json
{ "id": "plates", "type": "plates", "at": { "x": 2, "y": 1.5 }, "gap": 1.2, "length": 2.4, "field": 5 }
```

### `fieldGrid`

A grid of field arrows over the rectangle from `from` (one corner) to `to` (the opposite corner). Uniform (angle), or a field Ex(x, y), Ey(x, y) in world coordinates; arrows are scaled to the grid cell (longest = 70% of a cell) unless scaleByMagnitude is false. kind out/in draws dots or crosses instead.

**Positioning:** by point references · **Aliases:** `vectorField`, `fieldArrows`

| Option | Meaning |
| --- | --- |
| `from` | corner |
| `to` | opposite corner |
| `nx` | columns (default 5) |
| `ny` | rows (default 4) |
| `angle` | uniform direction (default 0) |
| `ex` | expression in x, y |
| `ey` | expression in x, y |
| `kind` | vector \| out \| in |
| `scaleByMagnitude` | lengths follow \|E\| (default true) |
| `color` | palette colour (default #225) |

**Anchors:** `center`, `cell(k)`

```json
{ "id": "fieldGrid", "type": "fieldGrid", "from": { "x": 0.5, "y": 0.5 }, "to": { "x": 3.5, "y": 2.5 }, "nx": 5, "ny": 3, "kind": "out" }
```

### `fieldLine`

Field or flow line through `points` (smoothed with Catmull-Rom), with arrowheads at the fractions in `arrows` (default [0.5]). It may touch the parts its end points name.

**Positioning:** by point references · **Aliases:** `streamline`

| Option | Meaning |
| --- | --- |
| `points` | list of points (at least 2) |
| `arrows` | head positions along the line, fractions in (0, 1] |
| `color` | palette colour (default #225) |
| `width` | px (default 1.2) |
| `dashed` | boolean |

**Anchors:** `start`, `end`, `mid`, `at(t)`

```json
{ "id": "fieldLine", "type": "fieldLine", "points": ["fieldLine_q.rim(30 deg)",{ "x": 2, "y": 2.3 }, "fieldLine_m.rim(150 deg)"], "arrows": [0.5]}
{ "id": "fieldLine_q", "type": "charge", "at": { "x": 0.8, "y": 1.2 }, "sign": "+", "r": 0.25 }
{ "id": "fieldLine_m", "type": "charge", "at": { "x": 3.2, "y": 1.2 }, "sign": "-", "r": 0.25 }
```

### `currentArrow`

Current direction on a conductor from `from` to `to`: an arrowhead on the wire at fraction `t` (inline), or a short arrow beside it (beside). Label it I. It may touch the wire it marks (an inline head may touch any wire, segment or connector it sits on, with no mayTouch).

**Positioning:** by point references · **Aliases:** `current`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `t` | position (default 0.5) |
| `style` | inline (default) \| beside |
| `side` | left \| right for beside |
| `length` | beside arrow length px (default 26) |
| `color` | palette colour (default force) |

**Anchors:** `at`, `tail`, `tip`

```json
{ "id": "currentArrow", "type": "currentArrow", "from": "currentArrow_w.start", "to": "currentArrow_w.end", "style": "inline", "label": "I" }
{ "id": "currentArrow_w", "type": "segment", "from": { "x": 0.6, "y": 1.5 }, "to": { "x": 3.4, "y": 1.5 }, "width": 1.2 }
```

## Fluids and thermodynamics

### `tank`

Tank with walls, optional lid, and liquid up to `level` (fraction of the height). Origin at the bottom centre. Side and bottom ports via leftAt(t), rightAt(t), bottomAt(t); `surface` is the middle of the free surface.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `vessel`, `container`

| Option | Meaning |
| --- | --- |
| `w` | width |
| `h` | height |
| `level` | liquid fraction 0-1 (default 0.6) |
| `open` | no lid (default true) |
| `wavy` | wavy surface (default false) |
| `marker` | free-surface marker (default true) |
| `liquid` | palette colour (default bodyFill) |

**Anchors:** `bottom`, `top`, `center`, `surface`, `left`, `right`, `leftAt(t)`, `rightAt(t)`, `bottomAt(t)`, `liquidCenter`

```json
{ "id": "tank", "type": "tank", "at": { "x": 2, "y": 0.5 }, "w": 2, "h": 1.8, "level": 0.453, "wavy": true}
```

### `pipe`

Pipe along `points` with diameter `d`: two mitred walls, a light fill and optional flow arrowheads. It may touch the parts its end points name (tanks, pumps, valves).

**Positioning:** by point references · **Aliases:** `duct`

| Option | Meaning |
| --- | --- |
| `points` | centreline points |
| `d` | inner diameter (world, default 0.2) |
| `flow` | draw flow arrowheads (default true) |
| `fill` | palette colour (default bodyFill) |
| `color` | wall colour (default mechanism) |

**Anchors:** `start`, `end`, `mid`, `at(t)`

```json
{ "id": "pipe", "type": "pipe", "points": [{ "x": 0.5, "y": 2 },{ "x": 2, "y": 2 },{ "x": 2, "y": 1 },{ "x": 3.5, "y": 1 }], "d": 0.22 }
```

### `valve`

Valve symbol on a line: two triangles meeting at the origin (bow tie), with a stem and handwheel (gate), an actuator dome (control) or a single filled triangle (check). Filled when closed. Ports: inlet (left), outlet (right) before rotation.

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `size` | length (world, default 0.5) |
| `rotation` | degrees |
| `kind` | gate (default) \| control \| check |
| `open` | open (unfilled, default true) |

**Anchors:** `center`, `inlet`, `outlet`, `stem`

```json
{ "id": "valve", "type": "valve", "at": { "x": 2, "y": 1.5 }, "size": 0.7, "kind": "gate" }
{ "id": "valve_l", "type": "pipe", "points": [{ "x": 0.5, "y": 1.5 }, "valve.inlet"], "d": 0.14, "flow": false}
{ "id": "valve_r", "type": "pipe", "points": ["valve.outlet",{ "x": 3.5, "y": 1.5 }], "d": 0.14, "flow": false}
```

### `pump`

Pump (or compressor) symbol: a circle with a triangle pointing in the flow direction; inlet on the left, outlet on the right before rotation.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `compressor`

| Option | Meaning |
| --- | --- |
| `r` | radius (world, default 0.35) |
| `rotation` | degrees (flow direction) |

**Anchors:** `center`, `inlet`, `outlet`, `top`, `bottom`

```json
{ "id": "pump", "type": "pump", "at": { "x": 2, "y": 1.5 }, "r": 0.45 }
{ "id": "pump_l", "type": "pipe", "points": [{ "x": 0.5, "y": 1.5 }, "pump.inlet"], "d": 0.16, "flow": false}
{ "id": "pump_r", "type": "pipe", "points": ["pump.outlet",{ "x": 3.5, "y": 1.5 }], "d": 0.16 }
```

### `pistonCylinder`

Piston-cylinder device: an open-top cylinder (origin at its bottom centre), gas below a piston at `position` (fraction of the height), optional rod and stacked weights, optional text in the gas.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `piston`, `cylinder`

| Option | Meaning |
| --- | --- |
| `w` | inner width |
| `h` | cylinder height |
| `position` | piston height fraction (default 0.55) |
| `gas` | palette colour (default surfaceFill) |
| `rod` | draw a rod (default false) |
| `weights` | number of weights on the piston (default 0) |
| `text` | text in the gas, e.g. "gas" |

**Anchors:** `bottom`, `top`, `piston`, `pistonTop`, `gas`, `rodTop`, `left`, `right`

```json
{ "id": "pistonCylinder", "type": "pistonCylinder", "at": { "x": 2, "y": 0.4 }, "w": 1.4, "h": 2, "position": 0.452, "text": "gas", "weights": 0 }
```

### `heatFlow`

Heat-transfer arrow from `from` to `to`: a wavy shaft with an arrowhead, in the force red by default. Label it Q.

**Positioning:** by point references · **Aliases:** `heatArrow`, `heat`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `waves` | number of waves (default from length) |
| `color` | palette colour (default force) |
| `width` | px (default 1.6) |

**Anchors:** `start`, `end`, `mid`

```json
{ "id": "heatFlow", "type": "heatFlow", "from": { "x": 0.8, "y": 1.5 }, "to": { "x": 3.2, "y": 1.5 }, "label": "Q" }
```

### `reservoir`

Thermal reservoir: a box outlined in force red (hot) or rayAlt blue (cold) with a heavier bottom or top edge and centred text (default "Hot reservoir" / "Cold reservoir"). Origin at the centre.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `thermalReservoir`

| Option | Meaning |
| --- | --- |
| `w` | width |
| `h` | height |
| `kind` | hot \| cold |
| `text` | centred text, e.g. T₁ = 500 K |
| `textSize` | 11-13 |

**Anchors:** `center`, `top`, `bottom`, `left`, `right`, `topAt(t)`, `bottomAt(t)`

```json
{ "id": "reservoir", "type": "reservoir", "at": { "x": 2, "y": 1.5 }, "w": 2.6, "h": 0.8, "kind": "hot", "text": "T₁ = 600 K" }
```

### `liquidSurface`

Wavy free surface from `from` to `to` with the ▽ free-surface marker; optionally fills liquid below it to `depth`.

**Positioning:** by point references · **Aliases:** `freeSurface`, `waterline`

| Option | Meaning |
| --- | --- |
| `from` | point |
| `to` | point |
| `waves` | periods (default from length) |
| `amp` | amplitude (world, default 2.5 px) |
| `marker` | draw the marker (default true) |
| `fill` | fill the liquid below (default false) |
| `depth` | fill depth (world, default 0.5) |
| `color` | palette colour (default rayAlt) |

**Anchors:** `start`, `end`, `mid`, `at(t)`

```json
{ "id": "liquidSurface", "type": "liquidSurface", "from": { "x": 0.5, "y": 1.5 }, "to": { "x": 3.5, "y": 1.5 }, "fill": true, "depth": 0.8 }
```

## Circuits

### `resistor`

Resistor (zig-zag), as in the template schematic: 0.6 wide, pins pin0/pin1 at ±0.3.

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |

**Anchors:** `center`, `pin0`, `pin1`, `start`, `end`

```json
{ "id": "resistor", "type": "resistor", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "resistor_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "resistor.pin0"]}
{ "id": "resistor_r", "type": "wire", "points": ["resistor.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `capacitor`

Capacitor: two plates 0.3 apart (template geometry); `variant: "polarized"` curves the minus plate and adds a + mark.

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |
| `variant` | "polarized" for an electrolytic capacitor |

**Anchors:** `center`, `pin0`, `pin1`, `plus`, `minus`, `start`, `end`

```json
{ "id": "capacitor", "type": "capacitor", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "capacitor_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "capacitor.pin0"]}
{ "id": "capacitor_r", "type": "wire", "points": ["capacitor.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `inductor`

Inductor: four half-turns between pins at ±0.36, as in the template schematic (bumps below the axis; flip puts them above).

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |

**Anchors:** `center`, `pin0`, `pin1`, `start`, `end`

```json
{ "id": "inductor", "type": "inductor", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "inductor_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "inductor.pin0"]}
{ "id": "inductor_r", "type": "wire", "points": ["inductor.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `voltageSource`

Independent voltage source: circle r 0.18 with + (pin0 side) and − marks, as in the template schematic.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `dcSource`, `voltage-source`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |

**Anchors:** `center`, `pin0`, `pin1`, `plus`, `minus`, `start`, `end`

```json
{ "id": "voltageSource", "type": "voltageSource", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "voltageSource_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "voltageSource.pin0"]}
{ "id": "voltageSource_r", "type": "wire", "points": ["voltageSource.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `currentSource`

Independent current source: circle r 0.18 with an arrow from pin0 to pin1, as in the template schematic.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `current-source`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |

**Anchors:** `center`, `pin0`, `pin1`, `start`, `end`

```json
{ "id": "currentSource", "type": "currentSource", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "currentSource_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "currentSource.pin0"]}
{ "id": "currentSource_r", "type": "wire", "points": ["currentSource.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `switch`

Single-pole switch (template geometry): open by default, `closed: true` closes it.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `spst`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |
| `closed` | boolean (default false) |

**Anchors:** `center`, `pin0`, `pin1`, `start`, `end`

```json
{ "id": "switch", "type": "switch", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "switch_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "switch.pin0"]}
{ "id": "switch_r", "type": "wire", "points": ["switch.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `circuitGround`

Ground symbol (template geometry): its single pin is at the origin (pin0 = pin1).

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `groundSymbol`, `earth`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |

**Anchors:** `center`, `pin0`, `pin1`

```json
{ "id": "circuitGround", "type": "circuitGround", "at": { "x": 2, "y": 1.9 }, "scale": 2.4 }
{ "id": "circuitGround_w", "type": "wire", "points": [{ "x": 0.8, "y": 2.3 },{ "x": 2, "y": 2.3 }, "circuitGround.pin0"]}
```

### `battery`

Battery of `cells` cells (long plate +, short plate −); + is pin0. Pins at ±0.3.

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |
| `cells` | 1-6 (default 2) |

**Anchors:** `center`, `pin0`, `pin1`, `plus`, `minus`, `start`, `end`

```json
{ "id": "battery", "type": "battery", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "battery_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "battery.pin0"]}
{ "id": "battery_r", "type": "wire", "points": ["battery.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `cell`

Single electrochemical cell (one long + plate, one short − plate); + is pin0. Pins at ±0.3.

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |

**Anchors:** `center`, `pin0`, `pin1`, `plus`, `minus`, `start`, `end`

```json
{ "id": "cell", "type": "cell", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "cell_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "cell.pin0"]}
{ "id": "cell_r", "type": "wire", "points": ["cell.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `bulb`

Lamp: a circle with a cross (IEC); pins at ±0.3.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `lamp`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |

**Anchors:** `center`, `pin0`, `pin1`, `start`, `end`

```json
{ "id": "bulb", "type": "bulb", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "bulb_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "bulb.pin0"]}
{ "id": "bulb_r", "type": "wire", "points": ["bulb.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `ammeter`

Ammeter: a circle with "A"; pins at ±0.3. The letter must fit inside the circle at the current zoom (raise scale if the gate says it does not).

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |
| `textSize` | 11-13 (default 11) |
| `text` | override the letter |

**Anchors:** `center`, `pin0`, `pin1`, `plus`, `minus`, `start`, `end`

```json
{ "id": "ammeter", "type": "ammeter", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "ammeter_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "ammeter.pin0"]}
{ "id": "ammeter_r", "type": "wire", "points": ["ammeter.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `voltmeter`

Voltmeter: a circle with "V"; pins at ±0.3. The letter must fit inside the circle at the current zoom (raise scale if the gate says it does not).

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |
| `textSize` | 11-13 (default 11) |
| `text` | override the letter |

**Anchors:** `center`, `pin0`, `pin1`, `plus`, `minus`, `start`, `end`

```json
{ "id": "voltmeter", "type": "voltmeter", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "voltmeter_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "voltmeter.pin0"]}
{ "id": "voltmeter_r", "type": "wire", "points": ["voltmeter.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `ohmmeter`

Ohmmeter: a circle with "Ω"; pins at ±0.3. The letter must fit inside the circle at the current zoom (raise scale if the gate says it does not).

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |
| `textSize` | 11-13 (default 11) |
| `text` | override the letter |

**Anchors:** `center`, `pin0`, `pin1`, `plus`, `minus`, `start`, `end`

```json
{ "id": "ohmmeter", "type": "ohmmeter", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "ohmmeter_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "ohmmeter.pin0"]}
{ "id": "ohmmeter_r", "type": "wire", "points": ["ohmmeter.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `galvanometer`

Galvanometer: a circle with "G"; pins at ±0.3. The letter must fit inside the circle at the current zoom (raise scale if the gate says it does not).

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |
| `textSize` | 11-13 (default 11) |
| `text` | override the letter |

**Anchors:** `center`, `pin0`, `pin1`, `plus`, `minus`, `start`, `end`

```json
{ "id": "galvanometer", "type": "galvanometer", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "galvanometer_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "galvanometer.pin0"]}
{ "id": "galvanometer_r", "type": "wire", "points": ["galvanometer.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `diode`

Diode: anode (pin0) to cathode (pin1); pins at ±0.3.

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |

**Anchors:** `center`, `pin0`, `pin1`, `anode`, `cathode`, `start`, `end`

```json
{ "id": "diode", "type": "diode", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "diode_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "diode.pin0"]}
{ "id": "diode_r", "type": "wire", "points": ["diode.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `zener`

Zener diode: a diode whose bar has bent ends; anode pin0, cathode pin1.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `zenerDiode`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |

**Anchors:** `center`, `pin0`, `pin1`, `anode`, `cathode`, `start`, `end`

```json
{ "id": "zener", "type": "zener", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "zener_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "zener.pin0"]}
{ "id": "zener_r", "type": "wire", "points": ["zener.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `led`

Light-emitting diode: a diode with two outward arrows; anode pin0, cathode pin1.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `lightEmittingDiode`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |

**Anchors:** `center`, `pin0`, `pin1`, `anode`, `cathode`, `start`, `end`

```json
{ "id": "led", "type": "led", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "led_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "led.pin0"]}
{ "id": "led_r", "type": "wire", "points": ["led.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `acSource`

AC voltage source: a circle with one sine period; pins at ±0.18 (use span for longer leads).

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `sineSource`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |

**Anchors:** `center`, `pin0`, `pin1`, `start`, `end`

```json
{ "id": "acSource", "type": "acSource", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "acSource_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "acSource.pin0"]}
{ "id": "acSource_r", "type": "wire", "points": ["acSource.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `potentiometer`

Potentiometer: a resistor with a wiper arrow from above; pins pin0, pin1 and wiper.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `rheostat`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |

**Anchors:** `center`, `pin0`, `pin1`, `wiper`, `start`, `end`

```json
{ "id": "potentiometer", "type": "potentiometer", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "potentiometer_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "potentiometer.pin0"]}
{ "id": "potentiometer_r", "type": "wire", "points": ["potentiometer.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `fuse`

Fuse: a small rectangle with the conductor through it; pins at ±0.3.

**Positioning:** placed (origin by `at` / `place`)

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |

**Anchors:** `center`, `pin0`, `pin1`, `start`, `end`

```json
{ "id": "fuse", "type": "fuse", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "fuse_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "fuse.pin0"]}
{ "id": "fuse_r", "type": "wire", "points": ["fuse.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `spdtSwitch`

Single-pole double-throw switch: common on the left (pin0), throws pin1 (upper) and pin2 (lower). `closed: true` selects the lower throw.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `changeoverSwitch`, `spdt`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `closed` | boolean: lower throw (default upper) |

**Anchors:** `center`, `pin0`, `pin1`, `pin2`, `common`, `upper`, `lower`

```json
{ "id": "spdtSwitch", "type": "spdtSwitch", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "spdtSwitch_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "spdtSwitch.common"]}
{ "id": "spdtSwitch_a", "type": "wire", "points": ["spdtSwitch.upper",{ "x": 3.5, "y": 1.79 }]}
{ "id": "spdtSwitch_b", "type": "wire", "points": ["spdtSwitch.lower",{ "x": 3.5, "y": 1.21 }]}
```

### `pushButton`

Normally-open push-button switch; `closed: true` draws it pressed. Pins at ±0.3.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `pushSwitch`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `span` | pin-to-pin distance (world); leads are extended |
| `closed` | pressed (default false) |

**Anchors:** `center`, `pin0`, `pin1`, `start`, `end`

```json
{ "id": "pushButton", "type": "pushButton", "at": { "x": 2, "y": 1.5 }, "scale": 2.4 }
{ "id": "pushButton_l", "type": "wire", "points": [{ "x": 0.5, "y": 1.5 }, "pushButton.pin0"]}
{ "id": "pushButton_r", "type": "wire", "points": ["pushButton.pin1",{ "x": 3.5, "y": 1.5 }]}
```

### `bjt`

Bipolar transistor (type npn or pnp, or variant "pnp"): base pin on the left, collector up, emitter down, with the emitter arrow and an envelope circle.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `transistor`, `npn`, `pnp`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `variant` | npn (default) \| pnp |

**Anchors:** `center`, `base`, `collector`, `emitter`, `pin0`, `pin1`, `pin2`

```json
{ "id": "bjt", "type": "bjt", "at": { "x": 2, "y": 1.5 }, "scale": 2.2, "variant": "npn" }
```

### `mosfet`

Enhancement MOSFET (variant "n" or "p"): gate on the left, drain up, source down, with the body arrow (into the channel for n) and the source tied to the body.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `nmos`, `pmos`, `fet`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `variant` | n (default) \| p |

**Anchors:** `center`, `gate`, `drain`, `source`, `pin0`, `pin1`, `pin2`

```json
{ "id": "mosfet", "type": "mosfet", "at": { "x": 2, "y": 1.5 }, "scale": 2.2, "variant": "n" }
```

### `opamp`

Operational amplifier: a triangle pointing +x; inverting input (inMinus) on top unless `flip`, non-inverting (inPlus) below, output on the right; `variant: "supply"` adds vPlus/vMinus leads.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `opAmp`, `amplifier`

| Option | Meaning |
| --- | --- |
| `rotation` | degrees (0: pin0 left, pin1 right) |
| `scale` | size factor (default 1; symbol widths match the template schematic in world units) |
| `flip` | mirror across the axis |
| `variant` | "supply" draws the supply leads |

**Anchors:** `center`, `inMinus`, `inPlus`, `out`, `vPlus`, `vMinus`, `pin0`, `pin1`, `pin2`

```json
{ "id": "opamp", "type": "opamp", "at": { "x": 2, "y": 1.5 }, "scale": 2.2, "variant": "supply" }
```

### `wire`

Circuit wire through `points` (pins and corners), 1.2 px ink like the template. `orthogonal: "hv"` or `"vh"` inserts a corner between points that are not axis-aligned. Crossing wires are not connected; mark real nodes with a junction. It may touch the parts whose pins it names.

**Positioning:** by point references · **Aliases:** `conductor`

| Option | Meaning |
| --- | --- |
| `points` | pins and corner points |
| `orthogonal` | none (default) \| hv \| vh |
| `color` | palette colour |
| `width` | px (default 1.2) |

**Anchors:** `start`, `end`, `vertex(k)`, `at(t)`

```json
{ "id": "wire", "type": "wire", "points": [{ "x": 0.6, "y": 0.9 },{ "x": 3.4, "y": 2.1 }], "orthogonal": "hv" }
```

### `junction`

Junction dot at a circuit node. It names the `wires` that meet there and is accepted only at a real node: at least three wire ends or pass-throughs at the dot (a wire passing through counts twice). Elsewhere it fails with E_CONSTRAINT_VIOLATED. The wires it names may touch each other.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `node_dot`, `connectionDot`

| Option | Meaning |
| --- | --- |
| `wires` | ids of the wires meeting at the dot |
| `color` | palette colour |

**Anchors:** `center`

```json
{ "id": "junction", "type": "junction", "at": { "x": 2, "y": 1.5 }, "wires": ["junction_a", "junction_b"]}
{ "id": "junction_a", "type": "wire", "points": [{ "x": 0.6, "y": 1.5 },{ "x": 3.4, "y": 1.5 }]}
{ "id": "junction_b", "type": "wire", "points": [{ "x": 2, "y": 1.5 },{ "x": 2, "y": 0.6 }]}
```

## Logic and controls

### `logicGate`

Logic gate (AND, OR, NOT, NAND, NOR, XOR, XNOR, BUF). style iec (default) matches Kinetra's logic schematic; ansi draws the distinctive shapes. Origin at the body centre; pins in(k) top to bottom (also in0..in3) and out.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `gate`

| Option | Meaning |
| --- | --- |
| `kind` | AND \| OR \| NOT \| NAND \| NOR \| XOR \| XNOR \| BUF |
| `inputs` | 1-8 (default 2; NOT/BUF 1) |
| `w` | body width (world, default 1.12) |
| `rotation` | degrees |
| `style` | iec \| ansi |
| `text` | replace the IEC mark (e.g. a name) |

**Anchors:** `center`, `out`, `in(k)`, `in0`, `in1`, `in2`, `in3`, `top`, `bottom`

```json
{ "id": "logicGate", "type": "logicGate", "at": { "x": 1.5, "y": 1.75 }, "kind": "AND", "inputs": 3, "w": 1.1 }
{ "id": "logicGate_b", "type": "logicGate", "at": { "x": 3, "y": 0.6 }, "kind": "AND", "style": "ansi", "w": 0.8 }
```

### `flipFlop`

Flip-flop box (D, JK, T, SR) with its input names inside, a clock triangle (unless clock: false for a latch), and outputs Q and Q̄. Origin at the centre. Pins: d / j / k / t / s / r, clk, q, qbar.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `latch`, `ff`

| Option | Meaning |
| --- | --- |
| `kind` | D \| JK \| T \| SR |
| `w` | width (default 1.2) |
| `h` | height (default 1.6) |
| `clock` | edge-triggered clock input (default true) |
| `size` | text size 11-13 (default 11) |

**Anchors:** `center`, `d`, `j`, `k`, `t`, `s`, `r`, `clk`, `q`, `qbar`, `top`, `bottom`

```json
{ "id": "flipFlop", "type": "flipFlop", "at": { "x": 2, "y": 1.5 }, "kind": "D", "clock": true, "w": 1.3, "h": 1.7 }
```

### `summingJunction`

Block-diagram summing junction: a circle (with an X, a Σ, or plain) and a sign beside each signed input port. Ports: left, right, top, bottom (on the rim).

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `sum`, `summer`

| Option | Meaning |
| --- | --- |
| `r` | radius (world, default 0.22) |
| `signs` | {left: "+", bottom: "-", ...} |
| `style` | cross (default) \| sigma \| plain |

**Anchors:** `center`, `left`, `right`, `top`, `bottom`, `rim(angle)`

```json
{ "id": "summingJunction", "type": "summingJunction", "at": { "x": 2, "y": 1.5 }, "r": 0.3, "style": "cross", "signs": { "left": "+", "bottom": "-" }}
{ "id": "summingJunction_in", "type": "connector", "from": { "x": 0.5, "y": 1.5 }, "to": "summingJunction.left" }
{ "id": "summingJunction_fb", "type": "connector", "from": { "x": 2, "y": 0.4 }, "to": "summingJunction.bottom" }
{ "id": "summingJunction_out", "type": "connector", "from": "summingJunction.right", "to": { "x": 3.5, "y": 1.5 }}
```

### `takeoff`

Take-off (pick-off) point on a signal line: a dot at the origin. It may touch the line it is attached to (at/attach).

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `pickoff`, `branchPoint`

| Option | Meaning |
| --- | --- |
| `color` | palette colour |

**Anchors:** `center`

```json
{ "id": "takeoff", "type": "takeoff", "at": "takeoff_line.at(0.5)" }
{ "id": "takeoff_line", "type": "connector", "from": { "x": 0.5, "y": 1.8 }, "to": { "x": 3.5, "y": 1.8 }}
{ "id": "takeoff_br", "type": "connector", "from": "takeoff", "to": { "x": 2, "y": 0.7 }, "route": "orthogonal", "mayTouch": ["takeoff_line"]}
```

### `state`

State of a finite-state machine: a circle with its name, a second ring when accepting, and an optional initial-state arrow coming in from direction `initial` (degrees, e.g. 180 for from the left). Round, so transitions and self-loops attach to its rim.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `fsmState`

| Option | Meaning |
| --- | --- |
| `r` | radius (world, default 0.4) |
| `text` | state name |
| `accepting` | double ring (default false) |
| `initial` | direction the start arrow comes from (degrees) |
| `textSize` | 11-13 |
| `fill` | palette colour (default white) |

**Anchors:** `center`, `top`, `bottom`, `left`, `right`, `rim(angle)`, `initialTail`

```json
{ "id": "state", "type": "state", "at": { "x": 2.3, "y": 1.5 }, "r": 0.5, "text": "q₀", "accepting": true, "initial": 180 }
```

### `transition`

Transition arrow between two round parts (states): straight when bend is 0, otherwise a circular arc bulging to the left of from->to by bend x the centre distance (use opposite signs for the two directions of a pair). It starts and ends exactly on the rims and may touch both states.

**Positioning:** by point references · **Aliases:** `fsmTransition`

| Option | Meaning |
| --- | --- |
| `from` | state id |
| `to` | state id |
| `bend` | -0.45..0.45 (default 0) |
| `color` | palette colour |
| `width` | px (default 1.4) |
| `labelAt` | label slot t (default 0.5) |

**Anchors:** `start`, `end`, `mid`, `slot(t)`

```json
{ "id": "transition", "type": "transition", "from": "transition_a", "to": "transition_b", "bend": 0.3, "label": "1" }
{ "id": "transition_back", "type": "transition", "from": "transition_b", "to": "transition_a", "bend": 0.3, "label": "0" }
{ "id": "transition_a", "type": "state", "at": { "x": 1, "y": 1.5 }, "r": 0.38, "text": "A" }
{ "id": "transition_b", "type": "state", "at": { "x": 3, "y": 1.5 }, "r": 0.38, "text": "B" }
```

### `selfLoop`

Self-loop on a round part (a state): a loop centred in direction `angle` (default 90, on top) that leaves and re-enters the rim, with its arrowhead on re-entry.

**Positioning:** by point references · **Aliases:** `loop`

| Option | Meaning |
| --- | --- |
| `state` | state id |
| `angle` | where the loop sits (degrees, default 90) |
| `size` | loop radius as a fraction of the state radius (default 0.7) |
| `direction` | ccw (default) \| cw |
| `color` | palette colour |
| `width` | px (default 1.4) |

**Anchors:** `apex`, `start`, `end`, `center`

```json
{ "id": "selfLoop", "type": "selfLoop", "state": "selfLoop_s", "angle": 90, "label": "a" }
{ "id": "selfLoop_s", "type": "state", "at": { "x": 2, "y": 1.15 }, "r": 0.45, "text": "q₁" }
```

## Plots

### `axes`

Cartesian plot axes. The origin is the bottom-left corner of the plot area (w x h world units). Each axis: {min, max, scale: linear|log, ticks: count or list, label, unit, grid, decimals, minor (log)}. Optional y2 (right axis). frame: axes (left and bottom), box, or cross (axes through data zero with arrowheads). Series, shades, points and annotations name these axes.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `plot`, `chartAxes`

| Option | Meaning |
| --- | --- |
| `w` | plot width (world) |
| `h` | plot height (world) |
| `x` | axis spec |
| `y` | axis spec |
| `y2` | optional right axis spec |
| `frame` | axes (default) \| box \| cross |
| `textSize` | tick text 11-13 (default 11) |

**Anchors:** `origin`, `bottomLeft`, `topLeft`, `topRight`, `bottomRight`, `center`, `zero`, `x(v)`, `y(v)`, `y2(v)`

```json
{ "id": "axes", "type": "axes", "at": { "x": 0.85, "y": 0.95 }, "w": 2.6, "h": 1.45, "x": { "min": 0, "max": 4, "ticks": 4, "label": "t", "unit": "s", "grid": true}, "y": { "min": 0, "max": 2, "ticks": 2, "grid": true}, "frame": "axes" }
```

### `series`

A data series on an axes (or polarAxes) element: y = fn(x) over `domain` (default the x range), parametric {x, y} over `t`, polar r = fn(theta) (theta in radians; domain in degrees), or `data` [[x, y], ...]. Drawn as a line, markers or both, clipped to the plot area; points off a log axis are skipped. It may touch its axes.

**Positioning:** by point references · **Aliases:** `dataSeries`, `graph`

| Option | Meaning |
| --- | --- |
| `axes` | axes id |
| `fn` | expression in x |
| `domain` | [x0, x1] |
| `x` | parametric x(t) |
| `y` | parametric y(t) |
| `t` | [t0, t1] |
| `data` | [[x, y], ...] |
| `style` | line \| markers \| both (default line; data: both) |
| `marker` | dot \| circle \| square \| triangle \| cross \| x |
| `axis` | y (default) \| y2 |
| `samples` | 2-2000 (default 200) |
| `color` | palette colour |
| `width` | px (default 1.6) |
| `dashed` | boolean |

**Anchors:** `start`, `end`, `max`, `min`, `at(x)`, `point(k)`

```json
{ "id": "series", "type": "series", "axes": "series_ax", "fn": "1 - exp(-x)" }
{ "id": "series_ax", "type": "axes", "at": { "x": 0.85, "y": 0.95 }, "w": 2.6, "h": 1.45, "x": { "min": 0, "max": 6, "ticks": 3 }, "y": { "min": -1, "max": 1, "ticks": 2 }}
```

### `shade`

Shaded region on an axes between an upper bound (`upper` expression in x or number, or `series` id) and a lower bound (`lower`, default 0, or `lowerSeries` id) for x from `from` to `to`. Clamped to the plot area; its `area` (data units, trapezoidal) is exposed to checks. Declare it before the series it sits under; when bounded by `series`, that series' edge is redrawn on top.

**Positioning:** by point references · **Aliases:** `area`, `fillBetween`

| Option | Meaning |
| --- | --- |
| `axes` | axes id |
| `upper` | expression in x or number |
| `series` | upper bound from a series id |
| `lower` | expression or number (default 0) |
| `lowerSeries` | lower bound from a series id |
| `from` | x start (default x min) |
| `to` | x end (default x max) |
| `fill` | palette colour (default bodyFill) |
| `axis` | y \| y2 |

**Anchors:** `center`, `start`, `end`

```json
{ "id": "shade", "type": "shade", "axes": "shade_ax", "series": "shade_s", "from": 0.8, "to": 2.6, "fill": "bodyFill", "label": { "text": "W", "size": 11 }}
{ "id": "shade_ax", "type": "axes", "at": { "x": 0.85, "y": 0.95 }, "w": 2.6, "h": 1.45, "x": { "min": 0.5, "max": 4, "ticks": [1,2,3,4], "label": "V" }, "y": { "min": 0, "max": 2, "ticks": [0,1,2], "label": "P" }}
{ "id": "shade_s", "type": "series", "axes": "shade_ax", "fn": "1.2/x", "domain": [0.62,4], "color": "ink" }
```

### `plotPoint`

A marked point at data coordinates (x, y) on an axes (on polarAxes: x = angle in degrees, y = radius), optionally with dashed guides to both axes. With `series`, the point sits on that series (y defaults to its value at x) and may touch it. It may touch its axes. Refs: dataX, dataY.

**Positioning:** by point references · **Aliases:** `dataPoint`, `marker`

| Option | Meaning |
| --- | --- |
| `axes` | axes id |
| `x` | data x (polar: angle deg) |
| `y` | data y (polar: r); optional with series |
| `series` | series id the point lies on |
| `marker` | dot (default) \| circle \| square \| triangle \| cross \| x |
| `guides` | dashed lines to the axes (default false) |
| `axis` | y \| y2 |
| `color` | palette colour |

**Anchors:** `center`

```json
{ "id": "plotPoint", "type": "plotPoint", "axes": "plotPoint_ax", "x": 2, "y": 1.2, "guides": true, "marker": "circle" }
{ "id": "plotPoint_ax", "type": "axes", "at": { "x": 0.85, "y": 0.95 }, "w": 2.6, "h": 1.45, "x": { "min": 0, "max": 4, "ticks": 2 }, "y": { "min": 0, "max": 2, "ticks": 2 }}
```

### `guideLine`

Line across an axes at data x = value (vertical) or y = value (horizontal): asymptotes, thresholds, reference levels. Dashed by default.

**Positioning:** by point references · **Aliases:** `asymptote`, `hline`, `vline`, `refLine`

| Option | Meaning |
| --- | --- |
| `axes` | axes id |
| `x` | vertical line at this x |
| `y` | horizontal line at this y |
| `axis` | y \| y2 |
| `dashed` | default true |
| `color` | palette colour (default constraint #666) |
| `width` | px (default 1) |

**Anchors:** `start`, `end`, `mid`

```json
{ "id": "guideLine", "type": "guideLine", "axes": "guideLine_ax", "y": 1 }
{ "id": "guideLine_ax", "type": "axes", "at": { "x": 0.85, "y": 0.95 }, "w": 2.6, "h": 1.45, "x": { "min": 0, "max": 5, "ticks": 5 }, "y": { "min": 0, "max": 1.5, "ticks": [0,0.5,1,1.5]}}
{ "id": "guideLine_s", "type": "series", "axes": "guideLine_ax", "fn": "1 - exp(-x)", "mayTouch": ["guideLine"]}
```

### `slopeTriangle`

Rise-over-run triangle on a series between data x and x + run (dashed legs below the secant). Its `slope` (data units) is exposed to checks.

**Positioning:** by point references · **Aliases:** `slope`, `riseRun`

| Option | Meaning |
| --- | --- |
| `series` | series id (fn or data) |
| `x` | start x |
| `run` | run in x |
| `color` | palette colour (default constraint #666) |

**Anchors:** `start`, `corner`, `end`, `runMid`, `riseMid`

```json
{ "id": "slopeTriangle", "type": "slopeTriangle", "series": "slopeTriangle_s", "x": 1, "run": 2 }
{ "id": "slopeTriangle_ax", "type": "axes", "at": { "x": 0.85, "y": 0.95 }, "w": 2.6, "h": 1.45, "x": { "min": 0, "max": 4, "ticks": 4 }, "y": { "min": 0, "max": 3, "ticks": 3 }}
{ "id": "slopeTriangle_s", "type": "series", "axes": "slopeTriangle_ax", "fn": "0.6*x + 0.2" }
```

### `intercept`

Marks where a series crosses y = 0 (axis x: the root nearest `near`, by bisection on a sign change) or x = 0 (axis y). Its `value` is exposed to checks.

**Positioning:** by point references · **Aliases:** `root`, `zeroCrossing`

| Option | Meaning |
| --- | --- |
| `series` | series id (fn or data) |
| `axis` | x (root, default) \| y (value at x = 0) |
| `near` | x to search near (default: first sign change) |
| `marker` | default circle |
| `color` | palette colour |

**Anchors:** `center`

```json
{ "id": "intercept", "type": "intercept", "series": "intercept_s", "axis": "x" }
{ "id": "intercept_ax", "type": "axes", "at": { "x": 0.85, "y": 0.95 }, "w": 2.6, "h": 1.45, "x": { "min": -2, "max": 2, "ticks": [-2,2]}, "y": { "min": -2, "max": 2, "ticks": [-2,2]}, "frame": "cross" }
{ "id": "intercept_s", "type": "series", "axes": "intercept_ax", "fn": "x/2 + 0.5", "domain": [-1.6,1.8]}
```

### `polarAxes`

Polar axes centred on the origin: radius r (world) for data radius rMax, `rings` grid circles with radius labels, spokes every `spokes` degrees with angle labels outside the rim. Series (r = fn(theta)), plotPoints and phasors name it.

**Positioning:** placed (origin by `at` / `place`) · **Aliases:** `polarPlot`, `phasorDiagram`

| Option | Meaning |
| --- | --- |
| `r` | outer radius (world) |
| `rMax` | data radius at the rim (default 1) |
| `rings` | grid circles (default 4) |
| `spokes` | degrees between spokes (default 30; 0 for none) |
| `labels` | angle labels (default true) |
| `ringLabels` | radius labels between the first two spokes; a ring whose label would touch a grid line is left unlabelled (default true) |
| `textSize` | 11-13 (default 11) |

**Anchors:** `center`, `rim(angle)`, `at(angle)`

```json
{ "id": "polarAxes", "type": "polarAxes", "at": { "x": 2, "y": 1.5 }, "r": 0.85, "rMax": 2, "rings": 2, "spokes": 45 }
```

### `phasor`

Phasor on polarAxes: an arrow of data length `magnitude` at `angle`, from the centre or from the tip of another phasor (`from`, for phasor sums; it may touch that phasor). Exposes magnitude, angle, re and im. Phasors that both start at the centre may touch there automatically (no mayTouch), as long as each tip stays clear of the other phasor.

**Positioning:** by point references · **Aliases:** `polarVector`

| Option | Meaning |
| --- | --- |
| `axes` | polarAxes id |
| `magnitude` | data radius units |
| `angle` | degrees |
| `from` | phasor id to start at its tip |
| `color` | palette colour (default force) |
| `dashed` | boolean |

**Anchors:** `tail`, `tip`, `mid`

```json
{ "id": "phasor", "type": "phasor", "axes": "phasor_ax", "magnitude": 1.2, "angle": 25.293 }
{ "id": "phasor_b", "type": "phasor", "axes": "phasor_ax", "magnitude": 0.7, "angle": 120, "color": "rayAlt", "mayTouch": ["phasor"]}
{ "id": "phasor_ax", "type": "polarAxes", "at": { "x": 2, "y": 1.5 }, "r": 1.05, "rMax": 2, "rings": 1, "spokes": 90, "labels": false, "ringLabels": false}
```
