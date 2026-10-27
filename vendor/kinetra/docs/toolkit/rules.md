# Rules for composing diagrams with the toolkit

These are the rules an agent follows to build an accurate, non-overlapping
diagram with the composition toolkit. The engine is described in
[engine.md](engine.md), every part in [parts.md](parts.md), and 30 worked
diagrams live in `examples/toolkit/proof/` (rendered in
[contact-sheet/proof.html](contact-sheet/proof.html)).

The toolkit verifies geometry, units, overlaps and the laws you declare. It
cannot know whether you chose the right physics. Your job is the physics; its
job is to make sure the picture says exactly what your numbers say.

## The seven rules

1. **Use a template if one fits.** Free-body diagrams, projectiles, optics,
   pulleys, circuits (`kinetra-circuits`), logic and K-maps (`kinetra-kmap`)
   and the other `kinetra-diagrams` templates are tuned and golden-tested.
   Compose only when no template shows what the problem needs.
2. **Work out the engineering first.** Before placing anything, write the
   governing equations and solve them: reactions, member forces, node
   voltages, poles, states. Put the givens and the results in `vars` as
   formulas (`"RA": "P*(L - a)/L"`), not as numbers you computed elsewhere.
3. **Every quantity-bearing number is a formula with units.** Magnitudes,
   lengths, angles, plot data and positions that encode physics are
   expressions: `"m*g*sin(theta)"`, `"tp/(1 s)"`, `{"x": "L*cos(theta)"}`.
   Hand-typed coordinates are for layout only (where a box sits on the page).
4. **Position by relationships.** Attach parts to anchors (`"beam.top(0.5)"`,
   `{"attach": "bottom", "to": "ramp.surface(0.55)"}`), use `tangentTo`,
   `along`, `alignedWith`, `rightOf`, and `{"ref": "M.left", "dx": 0.2}`
   offsets. Then the geometry follows the physics when a value changes.
5. **Declare a check for every law the diagram claims.** Equilibrium
   (`vectorSum`, `momentSum`), conservation (`equal` on energy or flow), KCL
   (`kcl`) and KVL (`equal`), points on curves (`onCurve`), plot-to-plot
   consistency (area under V equals M), inequalities (no slip, second law).
   A check must be able to fail: ask "which wrong answer would this catch?"
6. **Call `compose` and fix exactly what it reports.** Each error names the
   elements, the measured values and a suggestion. Change only what is
   reported and retry. Never suppress the gate: do not add `mayTouch` to hide
   a real overlap, widen a tolerance to pass a check, or delete a check.
7. **Present the result with its report.** Say what was verified (the checks
   that ran, the gate, the style contract) and what was assumed (the model,
   the inputs, idealisations). Never claim more than the checks show.

## Workflow

```text
problem -> equations -> vars (formulas) -> parts placed by relations
        -> checks for each law -> compose -> fix reported errors -> render + report
```

```sh
npm run compose -- model.json out.svg      # writes out.svg and out.report.json, or prints errors
```

```ts
import { compose } from "./packages/core/src/toolkit/index.ts"; // also exported from packages/core/src/index.ts
const r = compose(model);
if (!r.ok) for (const e of r.errors) console.log(e.code, e.elements, e.message, e.suggestion);
```

Reading errors (stage tells you where it failed):

| Code | What to do |
| --- | --- |
| `E_CHECK_FAILED` | The physics or the drawing disagrees with a declared law. Recompute; do not loosen the tolerance. |
| `E_COLLISION` | Move one element, shorten text, or add `mayTouch` **only** if the contact is real (a force arrow starting on its body). |
| `E_LABEL_UNPLACEABLE` | Remove `position` pins, shorten the label, enlarge the canvas, or use a `leader` part with an explicit elbow. |
| `E_OUT_OF_BOUNDS` | Enlarge `canvas.world` or the canvas, or shorten the caption (arrow scales are appended to it). |
| `E_UNIT_MISMATCH` | Fix the units in the expression; plot functions must return plain numbers (`"v/(1 m/s)"`). |
| `E_TEXT_UNSUPPORTED` | Unknown `\symbol`, or a script character outside Latin/Greek/digits/punctuation. |

## Practical rules learned from the proof set

- **Let the placer choose label positions.** Pin `position` only when the
  convention requires it. A pinned label that collides is an error; an unpinned
  one tries every side, a local swap and leader lines.
- **Text markup:** `F_N`, `V_{CC}`, `x^2`, `\theta`, `\omega_n` in labels and
  part text render as real SVG sub/superscripts. **Titles and captions are
  plain text**: use Unicode there (`T₁`, `x²`) or words.
- **Contacts that are allowed without `mayTouch`:** connectors, wires, ropes,
  springs, loads, leaders with the parts their ends name; series and plot
  annotations with their axes; phasors that share the polar origin; wires and
  signal connectors that cross cleanly (no junction dot is drawn); inline
  current arrows on their conductor. Everything else needs `mayTouch`, and a
  part's own text is never excused.
- **Grid lines are low priority.** Labels may sit over plot grid lines (a white
  halo is drawn), and lines may cross them. Part text (tick labels, leader text)
  may not.
- **Background media:** give a filled region `"background": true` (rect or
  polygon) when other elements are drawn over it (glass, water, a fluid inside
  a pipe), and list it first so it is drawn first.
- **Checks can read geometry:** `<id>.x`, `<id>.y`, part refs (`magnitude`,
  `angle`, `length`, `area`, `dataX`, `dataY`, `re`, `im`, `members`, ...) and
  any argument-free anchor as `<id>.<anchor>.x` / `.y`, e.g.
  `"TB.surface.y - TA.surface.y"`. Use them to tie the drawing to the physics.
- **Tolerances carry units** and should reflect what is being checked: `1e-9 N`
  for algebraic identities, about 0.5 px in world units for layout, the
  integration error for areas from plotted data.
- **Angles:** angle fields take degrees as numbers or strings with units.
  Trigonometry needs an angle: `sin(30 deg)`, `cos(wd*x*1 s*1 rad)`. To test
  that two directions are parallel use `sin(a.angle - b.angle) = 0`, not angle
  equality (angles wrap).
- **Units:** SI plus kN, MPa, GPa, kPa, bar, litre (not `L`, which is usually a
  length variable), kJ, kWh, mT, uC, eV/keV/MeV, nm/um/pm. A variable of the
  same name always wins, so `m` as a mass shadows the metre.
- **Computed curves:** streamlines, root-locus branches and similar curves come
  from a small generator script (see `examples/toolkit/proof/gen/`) that writes
  data points into the model; check them independently (an invariant, the
  angle condition), not by trusting the generator.
- **Expression parser quirk.** Kinetra's core parser (`math/expression.ts`,
  unchanged) binds unary minus tighter than `^` and reads a number right before
  `)` as an implicit product. The toolkit rewrites every expression before it
  reaches that parser, so in toolkit models `-3^2 = -9` and `"2*(1 + 2)"`,
  `"(4)"` behave as written (pinned by `priority_fixes.test.ts`). Do not pass
  toolkit expressions to the core parser directly.

## Cheat-sheet

**Model:** `{ canvas: {width, height, world: {xMin,xMax,yMin,yMax}, worldUnit?}, title?, caption?, vars, scales?, elements, checks }`.
World +y is up; both axes share one scale. Arrow quantities need
`scales.<quantity>.per` (force, velocity, acceleration, current, magneticField, ...).

**Points:** `{"x": .., "y": ..}` · `"id"` · `"id.anchor"` · `"id.anchor(arg)"` · `{"ref": "id.anchor", "dx": .., "dy": ..}`.

**Relations (`place`, placed parts):** `at`, `attach`+`to`, `x`/`y`, `along {from, angle, distance}`,
`alignedWith` + `axis`, `distance` + `from`, `tangentTo` (+`side`, `mode`), `leftOf`/`rightOf`/`above`/`below` (+`gap`, `align`), `inside`.
Two solutions need `prefer`. `rightOf` measures bounding boxes (an initial arrow or ring widens a box): use `at` with a formula when spacing must be exact.

**Checks:** `equal`, `less`, `lessEqual`, `greater`, `greaterEqual`, `vectorSum` (+`equals`), `momentSum` (+`about`),
`kcl`, `table` (`fn`, `var`, `rows`), `proportional`, `onCurve`.

**Parts and their key anchors** (all options in [parts.md](parts.md)):

| Area | Parts (anchors) |
| --- | --- |
| Basic | `point`, `rect`/`block` (center, top, bottom, left, right, corners), `circle` (rim(a)), `segment` (start, end, mid, at(t)), `polyline`, `polygon` (vertex(i), edge(i)), `arc`, `arrow`/`force` (tail, tip), `curve`, `text` |
| General | `roundedBox` (left, right, topAt(t)), `circleNode`, `textBlock`, `connector` (route straight/orthogonal/curved, via), `curvedArrow`, `doubleArrow`, `brace`, `dimension`, `angleArc`, `leader`, `legend`, `table` |
| Mechanics | `beam` (top(t), bottom(t), atDistance(d)), `pinSupport`/`rollerSupport`/`fixedSupport` (top, base), `hinge`, `ground`/`wall`/`ceiling`, `pulley` (rim(a)), `rope` (route with {around}), **`coilSpring`** (start, end), `damper`, `mass` (hook, top), `pivot`, `spokedWheel`, `incline` (surface(t), toe), `truss` (joint(k), member(k)), `cable`, `gear`, `pointLoad` (tip), `distributedLoad`, `moment`, `triad` |
| Fields | `charge` (rim(a)), `pageVector` (in/out), `magnet`, `solenoid`, `plates`, `fieldGrid`, `fieldLine` (points, arrows), `currentArrow` |
| Fluids, thermo | `tank` (surface, leftAt(t), rightAt(t)), `pipe`, `valve` (inlet, outlet), `pump`, `pistonCylinder`, `heatFlow`, `reservoir`, `liquidSurface` |
| Circuits | `resistor`, `capacitor`, `inductor`, `voltageSource`, `currentSource`, `battery` (+ is pin0), `cell`, `switch`, `bulb`, meters (`ammeter`, `voltmeter`, `galvanometer`, ...), `diode`, `zener`, `led`, `acSource`, `potentiometer`, `fuse`, `spdtSwitch`, `pushButton`, `bjt` (base, collector, emitter), `mosfet`, `opamp` (inMinus, inPlus, out), `circuitGround`, `wire` (points), `junction` (real nodes only) — two-pin parts expose pin0/pin1, `rotation`, `scale`, `span` |
| Logic, controls | `logicGate` (in(k), out), `flipFlop`, `summingJunction` (left, bottom, signs), `takeoff`, `state` (rim(a), initial, accepting), `transition` (bend), `selfLoop` |
| Plots | `axes` (x(v), y(v), bottomLeft, ...; linear/log, grid, y2, frame axes/box/cross), `series` (fn, parametric, data, polar), `shade` (area), `plotPoint` (dataX, dataY), `guideLine`, `slopeTriangle` (slope), `intercept` (value), `polarAxes`, `phasor` (re, im, from) |

The spring part is **`coilSpring`** (alias `zigzagSpring`); there is no `spring` type.

## Six worked examples

### 1. Block resting on a rough incline

*Problem:* 5 kg block on a 25° slope, μₛ = 0.6. Does it stay put? Draw the FBD.
*Physics:* N = mg cos θ = 44.5 N, f = mg sin θ = 20.7 N up the slope; f ≤ μₛN = 26.7 N, so it stays.

```json
"vars": { "m": "5 kg", "g": "9.81 m/s^2", "theta": "25 deg", "mus": "0.6", "N": "m*g*cos(theta)", "f": "m*g*sin(theta)" },
"scales": { "force": { "per": "25 N" } },
"elements": [
  { "id": "ramp", "type": "incline", "at": { "x": 0, "y": 0 }, "base": 6.6, "angle": "theta" },
  { "id": "blk", "type": "block", "w": 1.3, "h": 0.8, "rotation": "theta", "place": { "attach": "bottom", "to": "ramp.surface(0.55)" }, "mayTouch": ["ramp"] },
  { "id": "fb", "type": "block", "w": 1.0, "h": 0.6, "rotation": "theta", "at": { "x": 9.7, "y": 3.0 } },
  { "id": "W", "type": "force", "from": "fb.center", "angle": -90, "magnitude": "m*g", "label": "W = mg", "mayTouch": ["fb"] },
  { "id": "Na", "type": "force", "from": "fb.center", "angle": "90 deg + theta", "magnitude": "N", "color": "normal", "label": "F_N", "mayTouch": ["fb", "W"] },
  { "id": "fa", "type": "force", "from": "fb.center", "angle": "theta", "magnitude": "f", "color": "friction", "label": "F_f", "mayTouch": ["fb", "W", "Na"] }
],
"checks": [
  { "type": "vectorSum", "vectors": ["W", "Na", "fa"], "tol": "1e-9 N" },
  { "type": "lessEqual", "left": "fa.magnitude", "right": "mus*Na.magnitude" },
  { "type": "equal", "left": "fa.angle", "right": "ramp.angle", "tol": "1e-9 deg" }
]
```

While building this, the first draft pointed friction down the slope; `vectorSum` failed with a 41 N residual, which is the check doing its job.

### 2. Simply supported beam with shear and moment diagrams

*Physics:* R₁ = Pb/L, R₂ = Pa/L; V jumps by P at the load; M(a) = R₁a = area under V on [0, a].
Draw the beam with `pointLoad`s on its anchors, two `axes` the same width as the beam, `series` from data
written as formulas (`["a/(1 m)", "RA/(1 kN)"]`) and a `shade` under V. Checks: `vectorSum` and `momentSum`
of the loads, and `equal` between `Vshade.area` and the moment plot's `Mpk.dataY` (linked plots agree).
See `examples/toolkit/proof/01-beam-shear-moment.json`.

### 3. Op-amp inverting amplifier

*Physics:* virtual ground, so i_in = v_in/R_in = i_f = −v_out/R_f, giving v_out = −(R_f/R_in)v_in.

```json
"vars": { "vin": "0.5 V", "Rin": "10 kohm", "Rf": "47 kohm", "iin": "vin/Rin", "vout": "-Rf/Rin*vin", "iF": "(0 V - vout)/Rf" },
"checks": [
  { "type": "kcl", "node": "v−", "currents": [{ "value": "iin", "direction": "in" }, { "value": "iF", "direction": "out" }] },
  { "type": "equal", "left": "vout/vin", "right": -4.7, "tol": 1e-12 }
]
```

Wire pins to pins (`"Ri.pin1"`, `"U1.inMinus"`), mark 3-way nodes with `junction` (it refuses a 2-way corner),
and put `currentArrow`s on the wires they describe. See `18-inverting-amplifier.json`.

### 4. Series RLC phasor diagram

*Physics:* with I as reference, V_R = IR at 0°, V_L = IX_L at 90°, V_C = IX_C at −90°, V = V_R + V_L + V_C.
Use `polarAxes` and `phasor`s from the centre (they may touch at the origin automatically). Checks:
`equal` on `V.re` vs `VR.re + VL.re + VC.re` and the same for `im` (KVL in phasor form), and
`V.magnitude/I` vs `sqrt(R^2 + (XL - XC)^2)`. See `19-rlc-phasors.json`.

### 5. Step response with overshoot

*Physics:* for ζ = 0.3, ωₙ = 4: t_p = π/ω_d, M_p = exp(−ζπ/√(1−ζ²)) = 37.2%.

```json
{ "id": "y", "type": "series", "axes": "ax", "fn": "1 - exp(-z*wn*x)/sqrt(1 - z^2)*sin(wd*x*1 rad + phi)" },
{ "id": "pk", "type": "plotPoint", "axes": "ax", "series": "y", "x": "tp" },
{ "id": "os", "type": "leader", "target": "pk", "text": "peak 1 + M_p = 1.372", "dx": 0.9, "dy": 0.55, "marker": "none", "mayTouch": ["y"] }
```

Checks: `equal` `pk.dataY` vs `1 + Mp`, and `onCurve` `pk` on `y`. See `22-step-response.json`.

### 6. Moore state machine

*Design:* output 1 after two consecutive 1s: A/0 →1 B/0 →1 C/1, any 0 returns to A, C loops on 1.
Use `state` (`initial`, `accepting`), `transition` with opposite bends for the two directions of a pair,
a deeper bend for the long return arc, and `selfLoop`s. Place states with `at` formulas so spacing is exact.
The structure (one transition per state and input) is tested outside the model by simulating it; the model's
own checks pin the layout. See `25-moore-fsm.json`.

## Presenting the result

Report it like this:

> **Verified by Kinetra:** 5 declared checks passed (ΣF = 0, ΣM_A = 0, area under V on [0, 2 m] equals M_max,
> M_max = 16 kN·m, arrow scale); 0 overlaps among 17 tested pairs; style contract met.
> **Assumed:** a simply supported prismatic beam, a point load, small deflections, self-weight neglected.

The checks prove that the picture agrees with the declared laws and values. They do not prove that the
model, the inputs or the idealisations are right for the problem.
