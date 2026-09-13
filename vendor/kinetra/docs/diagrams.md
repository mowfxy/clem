# Diagram APIs and assumptions

Run the commands in the root README for the CLI and examples. For application code, import the specific module under `packages/core/src/diagram/`; the current verified workflow runs source with Node's TypeScript loader.

## Charged rods

```ts
import { defaultElectrostaticRods, renderElectrostaticRods } from "./packages/core/src/diagram/electrostatics.ts";

const model = defaultElectrostaticRods();
model.nearby.charge = -1;
model.nearby.material = "rubber";
model.nearby.label = "Rubber";
const svg = renderElectrostaticRods(model); // like charges repel
```

`examples/charged-rods.json` is the editable attraction model. Each rod supplies two axis endpoints, a radius, material, label, charge sign, charge region, charge count and approximate force application fraction. The suspension supplies its support, fork and two rod attachment fractions. The renderer validates separated rods and a support above the load.

Coordinates use +y up and equal scaling in both directions. They are schematic units, not meters. Signs determine attraction or repulsion; `electrostaticForcePair` makes the two displayed arrows equal and opposite. Their length is a visual scale, not a computed force in newtons. Distributed charge, polarization, friction and torsional motion are not solved. The curved cue means “free to rotate,” not a predicted direction or angular velocity. Suspension forces are omitted intentionally, so this apparatus illustration is not a complete FBD.

SVG shading, labels, threads and forces are generated from code. No raster reference or textbook image is embedded in the output. Export the SVG for lossless scaling; PNG previews can be produced by any ordinary SVG rasterizer.

## Shared geometry

`Scene2DModel` preserves equal world-unit scale by default, adding letterboxing when necessary. `preserveAspect: false` is available for plots that intentionally use different axis scales. Optional pixel `padding` reserves space around the data region.

`kind: "path"` uses world coordinates by default, transformed with the same affine map as points and segments. Existing pixel-native path clients must specify `space: "view"`. Stroke widths remain in pixels. Vector markers are emitted with matching references; the older `renderScene2DWithArrows` entry point now delegates to the same correct renderer.

## Physics families

| Family | Inputs and supported assumptions |
| --- | --- |
| FBD | Supply actual force components, magnitudes and units. Magnitudes must agree with vector norms. One `forceScale` applies to all forces; it auto-fits by default. `showComponents` projects into `frameAngleDeg`; `bodyAngleDeg` is independent. The renderer does not determine friction direction, contact normals or equilibrium for the caller. |
| Projectile | Supply finite initial position, speed, angle and positive gravity. Initial height is at/above ground y=0. Nonzero `drag` is rejected. The trajectory ends at impact or an earlier `tMax`; only reached key points are labeled. |
| Optics | Real object to the left, with base on the optical axis. Positive f for converging lenses/concave mirrors; negative f for diverging lenses/convex mirrors. A spherical mirror's radius is `2*abs(f)`. Principal rays use the paraxial vertex-plane model; curved-end mirror symbols indicate concavity without claiming exact spherical ray tracing. `atInfinity` must be handled when using analytic results at u=f. The SVG avoids infinite coordinates and labels this case. |
| Pulley | One fixed wheel with one load/free end or two masses, two aligned fixed wheels with two masses, or `configuration: "movable"` with one moving wheel and a load below its axle. The explicit movable route has two supporting strands and MA=2. Fixed routes have MA=1. Compound routes without a supported topology fail explicitly. Caller-supplied tension is a diagram input; `atwoodDynamics(m1,m2,g)` solves the ideal Atwood case separately. |
| Vector field | Grid counts are integers in [2,200]. Default `encoding: "direction"` normalizes lengths and states that in the caption. `encoding: "magnitude"` uses `scale*|field|`; choose scale/world bounds so arrows fit. Nonfinite samples are omitted. |
| Scalar field | Finite grid counts as above; a caption explains the color mapping. Undefined samples are gray. Contours interpolate linearly on consistently triangulated cells; refine the grid for curved fields. Samples must be pure functions. |

## Electrical diagrams

Analog component bodies and terminals share a position, rotation and scale transform. Pins are numbered 0 and 1, including explicit ground pin references. Optional wire `via` points specify world-coordinate routing; use them to keep dense circuits clear. Crossings without junction dots are not connections. Source polarity and current arrows are tied to the local terminal orientation. Switches default to open and accept `closed: true`.

Logic uses rectangular symbols with separate input terminals and inversion bubbles. Layout is topological and independent of gate array order. Feedback layouts are rejected. Inspect dense layouts for wire crossings and readability; a valid netlist alone is not a visual acceptance test.

## Verification and limits

### Reviewed examples — 2026-09-07

![Reviewed gallery of 16 diagram examples](assets/diagram-review.png)

This saved contact sheet records the examples visually inspected after the repairs. Regenerate the current SVG gallery with `npm run examples:diagrams`; outputs are written to `out/diagrams/`. The image above is a dated review snapshot, not an automatically updated test result.

| Family | Checks performed |
| --- | --- |
| Charged rods | Suspension attachments, visible charge signs, attraction/repulsion direction and equal/opposite force arrows. |
| Optics | Image positions, principal-ray intersections, focal labels, virtual extensions and finite rendering at focus. |
| Projectile and FBD | Trajectory coordinates, ground impact, common force scale and rotated components. |
| Pulleys | Rope continuity, tangent contacts and mechanical advantage for supported routes. |
| Fields | Arrow direction/encoding and nonzero scalar contour geometry. |
| Electrical diagrams | Circuit body/terminal alignment and distinct logic input terminals; the visual gallery includes an RC circuit. |

Verification at this review: 297/297 repository tests, including 82/82 diagram tests; 9/9 original acceptance probes; strict diagram TypeScript checking passed. Physics calculations, emitted geometry and visual inspection were separate checks. These examples were not individually compared against published textbook figures, and the results do not certify every possible input or universal textbook-level visual polish.

`packages/core/test/diagram/textbook_accuracy.test.ts` independently checks ray intersections, force equality, contour levels, rope tangency, coordinate transforms and symbol terminals. `scripts/audit-diagrams.mjs` retains the nine original audit acceptance checks. `examples/render-diagrams.mjs` produces the figures used for visual review.

These checks do not certify untested scenes. Text labels may still need deliberate placement in dense custom compositions, and the model's physics must be checked against the actual problem.
