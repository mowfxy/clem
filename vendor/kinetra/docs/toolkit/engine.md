# Composition toolkit engine

The toolkit is an additional path next to Kinetra's fixed templates. When no
template fits, an agent describes a 2D diagram as named parts placed by
relations. Kinetra renders it only when every declared check passes and the
layout has no overlaps. Otherwise it returns precise errors that the agent can
fix. Templates, their outputs and their APIs are unchanged; see
`packages/core/test/compat/` for the locks.

```ts
import { compose } from "./packages/core/src/toolkit/index.ts"; // also re-exported from packages/core/src/index.ts
const r = compose(model);
if (r.ok) use(r.svg, r.report); else fix(r.errors);
```

```sh
npm run compose -- examples/toolkit/block-on-incline.json out/toolkit/incline.svg
npm run examples:toolkit     # renders examples/toolkit/*.json to out/toolkit/
npm run test:toolkit         # toolkit unit, error, example, CLI and fuzz tests
npm run test:compat          # golden snapshots, API lock, style contract
npm run typecheck:toolkit
```

The CLI writes `<out>.svg` and `<out>.report.json` and exits 0. On failure it
writes nothing, prints `{"ok": false, "errors": [...], "stage": "..."}` and
exits 1. Wrong usage exits 2.

## Pipeline

1. **Input:** validate the model shape, evaluate `vars`, `canvas.world` and `scales`.
2. **Resolve:** evaluate part properties, order elements by dependency and
   solve positions (`resolver.ts`). `inside` relations and part gate hooks
   (minimum arrow length) are checked here.
3. **Checks:** run the declared invariants, plus an automatic "arrow length ∝
   value" check for each quantity type (`checks.ts`). Any failure blocks the render.
4. **Geometry gate:** test elements, title and caption against each other and
   the canvas before labels are placed, so the root cause is reported (`gate.ts`).
5. **Labels:** place labels greedily by priority, then try a local search,
   then a leader line (`labels.ts`).
6. **Full gate:** test everything that will be drawn, labels and leaders included.
7. **Render:** draw through `renderScene2D` (the template pipeline), then
   self-check the result with `checkToolkitStyle`.

Output is deterministic: the same model always gives the same bytes.

## Model

```jsonc
{
  "version": 1,
  "canvas": { "width": 800, "height": 520, "world": { "xMin": -1, "xMax": 9, "yMin": -0.8, "yMax": 5.6 }, "worldUnit": "m" },
  "title": "optional (Inter 14/600, y = 16)",
  "caption": "optional (11 px #555, y = H - 8); arrow scales are appended",
  "vars": { "theta": "30 deg", "m": "4 kg", "g": "9.81 m/s^2" },
  "scales": { "force": { "per": "20 N" } },          // 1 world unit of arrow = 20 N
  "elements": [ { "id": "block", "type": "block", "w": 1.4, "h": 0.9, "place": { "attach": "bottom", "to": "wedge.edge(1)" } } ],
  "checks": [ { "type": "vectorSum", "vectors": ["W", "N", "f"] } ]
}
```

World coordinates have +y up. Both axes use the same scale, and the world box
is letterboxed into the canvas exactly as `Scene2D` does it.
`report.canvas.pxPerWorldUnit` gives the resulting scale.

Every element has `id` (`[A-Za-z_][A-Za-z0-9_-]*`, no dots) and `type`. It
also accepts these common keys: `place`/`at`, `prefer`, `label`, `mayTouch`
and `color`. Unknown keys are rejected with the list of accepted keys.

### Points and anchors

A point can be written in any of these forms:

- `{"x": 1, "y": "2 m"}`
- `"id"` (the element's origin)
- `"id.anchor"`
- `"id.anchor(arg)"`, for example `"wheel.rim(30 deg)"`, `"path.at(2)"` or `"wedge.edge(1)"`
- `{"ref": "block.top", "dx": 0.5, "dy": "10 cm"}`

### Relations (origin-placed parts)

Each relation constrains the part's own `anchor`, or its origin by default.
Relations are intersected as loci: a point, a line or a circle.

| Relation | Locus |
| --- | --- |
| `{at: P, anchor?}` / `{attach: ownAnchor, to: P}` | point |
| `{x: v}` / `{y: v}` | line |
| `{along: {from: P, angle, distance?}}` | point, or a ray if `distance` is omitted |
| `{alignedWith: P, axis: "x"\|"y"}` | line; `"x"` shares x (stacked vertically), `"y"` shares y |
| `{distance: d, from: P}` | circle |
| `{tangentTo: id, side?, mode?}` | round parts only. Against a round part, a circle with radius R+r (`external`, the default) or \|R−r\| (`internal`). Against a straight part, an offset line on `side` (`above`/`below`/`left`/`right`), with a check that the contact falls within the segment. |
| `{leftOf\|rightOf\|above\|below: id, gap?, align?}` | bounding boxes; `align` is `center` (default), `start`, `end` or `none` |
| `{inside: id, margin?}` | a containment check after resolution (`E_CONSTRAINT_VIOLATED`) |

`at` on the element is shorthand for `place: {at}`. Two discrete solutions
need `prefer: "above"|"below"|"left"|"right"`. Errors name the relations
involved (`place[i]`) and the residual in world units.

### Values by formula (`expr.ts`)

Any number may be an expression string, for example `"m*g*sin(theta)"`,
`"0.5*m*(3 m/s)^2"` or `"150 cm"`.

- **Parsing and units.** Expressions are tokenised by the toolkit, then parsed
  and evaluated by Kinetra's `math/expression` and `math/eval`. Dimensions
  come from `units.ts` (`UNITS`). Everything is held in SI.
- **Literals.** A number followed by units is one literal: `"9.81 m/s^2"` and `"4/2 m"` = 4/(2 m).
- **Names.** A bare name resolves as a variable or element reference first,
  then a unit, then a constant (`pi`, `e`). In `"m*g"`, `m` is the variable;
  in `"2 m"`, it is the metre.
- **Angles.** Angles have their own dimension, so `sin(30)` is an error and
  `sin(30 deg)` is correct. In angle fields a JSON number means degrees, and a
  string needs an angle unit.
- **Lengths.** A plain number is in world units. A dimensioned length is
  divided by `canvas.worldUnit`, which defaults to `m`.
- **Operators.** Unary minus binds looser than `^`, so `-3^2 = -9`. Use `a^b`;
  `pow()` is rejected.
- **Element references.** Checks can read element properties: `<id>.x`/`.y`
  for placed parts, `w`/`h`/`r` where the part has them, `length` and `angle`
  for segments, and `magnitude`, `vx`, `vy`, `angle` and `length` for arrows.

### Quantity arrows and scales

An arrow written as `{"from": P, "angle": a, "magnitude": "39.2 N"}` encodes a
quantity. The quantity type is inferred from the dimension (force, velocity,
acceleration, momentum, current, electricField, magneticField, displacement)
or given with `quantity`. Each quantity type needs one `scales.<name>.per`.
The caption states every scale in use ("Arrow scale: 1 unit = 20 N (force)"),
and an automatic check verifies on screen that every arrow of that type has
px/value equal to the declared scale. Declaring a scale that no arrow uses is
an error.

### Checks (`checks.ts`)

| type | fields | verifies |
| --- | --- | --- |
| `equal` | `left`, `right`, `tol?` | \|l − r\| ≤ tol (default 1e-9 relative) |
| `less`, `lessEqual`, `greater`, `greaterEqual` | `left`, `right` | the inequality |
| `vectorSum` | `vectors[]`, `equals?{x,y}`, `tol?` | Σ of arrow quantity vectors |
| `momentSum` | `about` (point), `vectors[]`, `equals?`, `tol?` | Σ r × F, with lever arms from arrow tails in metres (via worldUnit) |
| `kcl` | `currents[{value, direction: in\|out}]`, `node?` | Σin = Σout |
| `table` | `fn`, `var`, `rows[[x, y]]`, `tol?` | every row equals fn(x) |
| `proportional` | `arrows[]`, `tol?` | rendered length / value is constant |
| `onCurve` | `point`, `curve`, `tol?` | the distance to the curve; exact for `curve` (fn) and `arc` |

Tolerances carry units and must match the dimension of the checked values.
Each result in `report.checks` has `expected`, `actual`, `residual`,
`tolerance` and `unit`.

## Layout and overlap gate

- **Text measurement** (`text_metrics.ts`) uses hard-coded Arial/Helvetica
  advance widths for ASCII, Greek and symbols. Sub/superscripts are measured
  at 0.65 em, and unknown glyphs at 1 em, so widths are never underestimated.
- **Label markup:**
  - `F_1` becomes `F₁`.
  - `v_{max}` becomes `vₘₐₓ`.
  - `x^2` becomes `x²`.
  - `\theta` becomes `θ`, and `\deg` becomes `°`.
  - Unicode has no capital subscripts, so `formatLabelText("F_N")` raises `E_TEXT_UNSUPPORTED`. Since Agent 3, labels and part text use `formatLabelMarkup` instead and render every script as a real SVG `<tspan>` (see "Agent 3 additions").
- **Collision shapes** are in view pixels (`geometry.ts`), with stroke widths included:
  - `stroke`: a thick polyline, used for lines, shafts, wires, outlines, arcs and curves.
  - `area`: a filled polygon, used for text boxes, arrowheads and filled bodies.
  - `disc`.
  - Distances are exact. Unfilled closed shapes register only their outline,
    so their contents do not collide with them.
- **Text footprint.** A label's box is the union of the glyph box and the
  opaque white backdrop that Scene2D draws (`len × size × 0.62`), so a backdrop
  can never hide geometry.
- **Clearance and bounds.** Geometry needs 0.5 px of clearance and text needs
  2 px. Text stays at least 2 px inside the canvas, so Scene2D never clamps it,
  and geometry must lie within the canvas.
- **Placement.** Labels have candidate positions (`right`, `above-right`, …,
  `center`) relative to the part's label anchor and extent. `priority` decides
  the order. A local search moves one already-placed label to free a blocked
  one. Leader lines (#777, 0.8 px) are tried at 12–48 px in 16 directions.
  `position` pins a single position, and a collision then reports the free
  positions.
- **Allowed contacts.** These are the only contacts the gate accepts:
  - between elements that declare each other in `mayTouch`
  - a label fully inside its own closed owner (the `center` position)
  - a leader line touching its owner and its own label

  Physics geometry never moves.

## Errors (`errors.ts`)

`compose` never throws on bad input. A failure returns `ToolkitIssue[]`:

```ts
{ code, elements: string[], message, measured?, suggestion?, path? }
```

`elements` uses element ids, plus `var:<name>`, `check:<id>`, `label:<id>`,
`scale:<name>`, `title` and `caption`.

| Code | Meaning |
| --- | --- |
| E_SCHEMA | The model shape is wrong (missing or mistyped field, unknown key) |
| E_DUPLICATE_ID | Two elements share an id |
| E_UNKNOWN_PART | Part type not registered (known types are listed) |
| E_UNKNOWN_REF | Unknown element id ("did you mean") |
| E_UNKNOWN_ANCHOR | Unknown anchor, or a missing or unexpected argument |
| E_EXPR_PARSE | An expression cannot be parsed |
| E_EXPR_UNKNOWN_NAME | A name is not a variable, reference or unit |
| E_UNIT_MISMATCH | Incompatible dimensions |
| E_NON_FINITE | NaN or Infinity |
| E_INVALID_VALUE | Finite but out of range |
| E_SCALE_MISSING | A quantity arrow has no scale |
| E_UNDERCONSTRAINED | The free direction is named |
| E_CONTRADICTORY | The relations and residual are named |
| E_AMBIGUOUS | The candidates are listed; add `prefer` |
| E_CIRCULAR | The cycle path is given |
| E_CONSTRAINT_VIOLATED | An `inside` relation fails |
| E_CHECK_FAILED | Expected vs actual |
| E_TEXT_UNSUPPORTED | Label markup cannot be rendered |
| E_STYLE | Off-contract colour, stroke width or font size |
| E_ARROW_TOO_SHORT | Under 12 px on screen |
| E_COLLISION | An overlap without `mayTouch`; for a pinned label, the free positions are listed |
| E_OUT_OF_BOUNDS | Overflow side and pixels |
| E_LABEL_UNPLACEABLE | Every candidate tried, with what blocked it |

`report.stage` tells where a failure happened: `input`, `resolve`, `checks`,
`gate`, `labels` or `render`.

## Basic parts (Agent 1)

| type (aliases) | positioning | props | anchors |
| --- | --- | --- | --- |
| `point` | placed | color | center |
| `rect` (`box`) | placed (centre) | w, h, rotation, fill, stroke | center, top, bottom, left, right, topLeft, topRight, bottomLeft, bottomRight; these rotate with the body |
| `block` | placed (centre) | w, h, rotation (FBD style #cfe4ff/#1f4f8b) | same as rect |
| `circle` (`disc`, `wheel`) | placed (centre) | r, fill, stroke | center, top, bottom, left, right, rim(angle) |
| `segment` (`line`) | points: from, to | width, dashed, color | start, end, mid, at(t) |
| `polyline` | points: points[] | width, dashed, color | start, end, mid, vertex(i), at(t) |
| `polygon` | points: points[] | fill, stroke | centroid, vertex(i), edge(i) |
| `arc` | placed (centre) | r, from, to, width, color | center, start, end, mid, at(angle) |
| `arrow` (`vector`, `force`) | points: from, to? | to \| angle+length \| angle+magnitude (+quantity), dashed, color | tail, tip, mid, at(t) |
| `curve` | points: none | fn+domain \| x,y+t, samples, width, dashed, color | start, end, mid, at(x) |
| `text` | placed (box centre) | text, size 11–13, color | center, left, right, top, bottom |

`force` defaults to the force colour (#c0392b); `arrow` defaults to ink.
Colours are palette names or palette hex values (`style-contract.md`).

## Part interface (for Agent 2)

Parts register with `registerPart(def)`; see `parts.ts`. Physics and
electronics parts belong in new files under `packages/core/src/toolkit/parts/`,
imported from `toolkit/index.ts` so that registration happens on import.

```ts
interface PartDefinition<P> {
  type: string; aliases?: string[]; description: string;
  positioning: "placed" | "points";              // origin placed by relations, or geometry from point refs
  pointProps?: { name; list?; optional? }[];     // for "points" parts; refs become dependencies
  propKeys: string[];                            // accepted spec keys besides the common ones
  props(spec, ctx): P;                           // evaluate with lengthProp/angleProp/colorProp/strokeWidthProp/boolProp; must not depend on position
  anchorNames: string[]; anchorArgs?: Record<name, "angle" | "number" | "length">;
  anchor(inst, name, arg, ctx): Vec2 | undefined;  // absolute world point; for placed parts it MUST equal origin + f(props)
  box(inst, ctx): {x0,y0,x1,y1};                 // world bounding box (leftOf/rightOf/above/below)
  radius?(inst); segment?(inst);                 // enable tangentTo (round / straight)
  outline?(inst): Vec2[];                        // closed parts: inside relations and centre labels
  curve?(inst, ctx): Vec2[]; curveResidual?(inst, p): number | undefined;  // onCurve checks
  quantity?(inst): ArrowQuantity | undefined;    // vectorSum/momentSum/proportional/automatic scale check
  refs?(inst, ctx): Record<string, TkQuantity>;  // values exposed to checks as <id>.<name>
  draw(inst, ctx): Scene2DShape[];               // STYLE HOOK: only Scene2D shapes, palette colours, contract stroke widths
  collide(inst, ctx): CollisionShape[];          // view px (ctx.view.toView), stroke width included, must cover everything draw() paints
  label?(inst, ctx): { anchor: Vec2 (world); candidates: LabelPosition[] };
  gate?(inst, ctx): void;                        // extra part rules; throw via fail(code, ...)
}
```

Rules for part authors:

1. **Draw through Scene2D shapes.** Use `point`, `segment`, `vector`,
   `circle`, `rect`, `arc`, `polygon`, `path` and `label`, so the output keeps
   the template style. `compose()` rejects any rendering that fails
   `checkToolkitStyle`.
2. **Bound what is painted.** `collide()` must be a superset of what `draw()`
   paints. Use the same sampling for arcs and curves; `arcPoints` mirrors
   Scene2D's 3° step.
3. **Validate in `props()`.** Use `fail()` with a precise code, the element
   id, `measured` values and a `suggestion`.
4. **Choose anchor names deliberately.** They are part of the agent-facing
   API, for example `resistor.pin0`/`pin1`, `pulley.rim(angle)` and
   `spring.end`. Document them in `description`.
5. **Do not edit shared files.** `primitives.ts` and `scene2d.ts` are covered
   by byte-identical goldens.


## Part library (Agent 2)

The full catalogue (every part, its options, anchors and a sample) is
[parts.md](parts.md), generated from the registry; contact sheets of every
part are in [contact-sheet/](contact-sheet/). The parts live in
`packages/core/src/toolkit/parts/`:

- `kit.ts` is the shared machinery. A part builds one list of world-space
  primitives (`Prim`) per instance, and `definePart()` derives `draw()`,
  `collide()`, `box()`, anchors, outline, label anchor and refs from it, so
  collision shapes always cover what is painted. It also registers each part's
  catalogue entry (`TOOLKIT_PART_CATALOG`) and its sample
  (`TOOLKIT_PART_SAMPLES`), which drive the docs, contact sheets, tests and
  fuzz.
- `general.ts`, `mechanics.ts`, `fields.ts`, `fluids.ts`, `circuits.ts`,
  `logic.ts` and `plots.ts` hold the parts by category.

### Additive engine hooks

| Hook | Where | Purpose |
| --- | --- | --- |
| `PartDefinition.elementRefs(spec)` | `parts.ts`, `resolver.ts` | Element ids a part reads beyond its point references (the pulleys a rope wraps, the axes of a series). They become dependencies, so cycles and unknown ids are reported as usual. |
| `PartDefinition.link(inst, get, ctx)` | `parts.ts`, `resolver.ts` | Runs once after the part's origin and points are resolved, with read access to referenced elements. Ropes compute tangents here, connectors route, series map data and junctions validate their node. |
| `PartInstance.touches` | `parts.ts`, `compose.ts` | Element ids an instance may touch without a model `mayTouch` (a connector and the parts it joins, a series and its axes). They are merged into the gate's allowances. |
| `CollisionShape.strict` | `geometry.ts`, `gate.ts` | Marks a part's own text. An allowed contact (mayTouch or touches) never excuses a line through strict shapes; that is still `E_COLLISION`. Only kit text sets it, so basic-shape behaviour is unchanged. |
| Extra units | `expr.ts` | kN, MN, mN, Pa, kPa, MPa, GPa, bar, atm, litre/liter, mL, kJ, MJ, kWh, MW, mT, uC/µC, nC, uH/µH and nH, defined in SI inside the toolkit so `units.ts` is unchanged. A model variable of the same name still wins, so a variable `m` shadows the metre. |

In their `gate` hook, kit parts also check two things:

- Internal text fits inside its frame (meter letters, box text).
- A part's own lines never cross its own text (tick labels, ring labels, angle marks).

Both report `E_INVALID_VALUE` with a suggestion. No error code was added.

## Agent 3 additions

All additive; no existing export, signature or error code changed. The agent
rules are in [rules.md](rules.md).

| Addition | Where | Behaviour |
| --- | --- | --- |
| Real sub/superscripts | `text_metrics.ts` (`formatLabelMarkup`, `renderScriptTspans`, `plainLabelText`), `compose.ts`, `style.ts` | `F_N`, `V_{CC}`, `x^2` in labels, part text, legends, tables and axis titles become `<tspan font-size dy>` after `renderScene2D`. Until then each script glyph is one private-use code point, so Scene2D's length-based backdrop and the toolkit's measurement both count glyphs. Script glyphs are measured at 0.77 em; label boxes grow by the shift. `formatLabelText` is unchanged (tick labels still use Unicode). |
| Low-priority grid | `geometry.ts` (`soft`), `gate.ts`, `parts/kit.ts`, `compose.ts` | Grid-colour (#eee) strokes are soft. Labels may sit over them and get a white halo rect covering their box; other elements' lines and fills may cross them. A part's own text (strict) still may not. |
| Background regions | `parts.ts` (`rect`, `block`, `polygon`: `background`) | Fill and outline become soft areas, so anything may be drawn over a medium. |
| Canvas-bounded router | `PartContext.canvas`, `routeOrthogonal(..., bounds?)` | Orthogonal connector routes stay inside the canvas (inset by half the stroke + 1 px). |
| Built-in contacts | `PartDefinition.contactWith` (hook), `compose.ts` | Called once per pair; a reason replaces the need for `mayTouch` and appears in `report.contacts`. Used by phasors sharing the polar origin (tips must clear the other shaft), wires and signal connectors that cross cleanly (≥ 30°, away from vertices; T-joints and overlaps still fail), and inline current arrows on their conductor. |
| Anchor coordinates in checks | `checks.ts` (`elementScope`) | `<id>.<anchor>.x` / `.y` for every argument-free anchor, in SI length. Part refs keep priority. |
| Marker-sized label extent | `compose.ts` | A label on a small open part (box ≤ 24 px) clears the part's own box, so markers do not block their labels. |
| `via` with one corner | `resolver.ts` (`pointProps[].min`) | Connector `via` accepts one point; other point lists still need two. |
| Units | `expr.ts` | eV, keV, MeV, nm, um/µm, pm. |
| Plain text in reports | `labels.ts`, `compose.ts` | Error messages and `report.labels[].text` show visible text, not the script carriers. |

