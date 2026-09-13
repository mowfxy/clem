---
name: kinetra-diagrams
description: Render physics diagrams and textbook-style charged-rod illustrations to deterministic SVG using Kinetra. Use for free-body diagrams, projectile motion, lenses, mirrors, supported pulley systems, fields, or electrostatic attraction/repulsion with suspended rods. Do not use for CAD, arbitrary 3D scenes, chemical structures, circuit schematics (use kinetra-circuits), or animation/video.
---

# Kinetra Diagrams

Route into the Kinetra 2D physics diagram engine. All renderers are
deterministic: the same model produces the same SVG. Determinism does not
establish physical correctness: verify the model assumptions and inspect the
rendered figure. Six diagram families are supported.

## When to activate

- User describes a physics scene and asks for a diagram.
- User posts equations and wants the corresponding free body / field
  visualization.
- User asks to convert a textual problem ("block on incline at 30 deg,
  mass 5 kg, friction mu=0.2") into a labeled SVG.

Do not activate for 3D scenes, chemical structures, circuit diagrams
(use kinetra-circuits), or animation/video.

## Core entry points

All paths are relative to the repo root.

```ts
import { renderFBD, buildSceneFromFBD, validateFBD } from "../../../../core/src/diagram/freebody.js";
import { renderProjectile, buildSceneFromProjectile, projectileAnalytics, validateProjectile } from "../../../../core/src/diagram/projectile.js";
import { renderPulley, buildSceneFromPulley, mechanicalAdvantage, validatePulley } from "../../../../core/src/diagram/pulley.js";
import { renderOptics, buildSceneFromOptics, lensImage } from "../../../../core/src/diagram/optics.js";
import { renderVectorField, renderScalarField, validateVectorField } from "../../../../core/src/diagram/fields.js";
import { renderPlotSvg } from "../../../../core/src/graph/render_svg.js";
import { samplePlot, sampleMulti } from "../../../../core/src/graph/sample.js";
import { defaultElectrostaticRods, renderElectrostaticRods, validateElectrostaticRods, electrostaticForcePair } from "../../../../core/src/diagram/electrostatics.js";
```

## Per-family workflow

### Textbook charged-rod apparatus

Use `defaultElectrostaticRods()` as a starting model, then set the two rods'
positions, material, labels, charge signs, charge patches, and suspension.
`renderElectrostaticRods(model)` generates shaded cylinders, attached threads,
localized charge marks, and equal/opposite force arrows. Opposite signs attract;
like signs repel. The optional rotation cue indicates freedom to turn, not a
calculated angular velocity. This is a qualitative illustration of distributed
charges, not a point-charge Coulomb calculation or a full free-body diagram.

For the repo CLI, run `npm run diagram` for the default figure, or
`npm run diagram -- examples/charged-rods.json out/diagrams/custom.svg` for an
editable JSON model. `npm run examples:diagrams` creates a gallery under
`out/diagrams/`. Coordinates use +y up; rods must be separated and the fork
and support must be above the suspended rod. Never trace charge/force arrows
as decorative elements independent of the model.

### Free body diagram

1. Build an `FBDModel` with `bodyPosition`, `bodySize: {w, h}`,
   `frameAngleDeg`, `forces: FBDForce[]`, `world: {xMin, xMax, yMin,
   yMax}`, and `width` / `height`. Optional: `constraints`,
   `velocity`, `acceleration`, `dimensions`, `annotations`,
   `frameLabels`, `bodyLabel`.
2. Call `validateFBD(model)` before rendering; reject inconsistent
   magnitudes.
3. Render with `renderFBD(model)` directly, or normalize first with
   `buildSceneFromFBD(model)` then render.
4. `forceScale` is a common world-units-per-force scale (auto-fit by default).
   `showComponents` projects into the chosen `frameAngleDeg`; `bodyAngleDeg`
   controls the box orientation independently. Verify the actual forces from
   the problem: the renderer does not infer normals, friction or equilibrium.

### Projectile

1. Build a `ProjectileModel` with `initialPosition`, `initialSpeed`
   (m/s), `launchAngleDeg` (above horizontal), `gravity` (m/s^2,
   positive; explicitly supply 9.81 for Earth), `width`, `height`. Optional: `tMax`,
   `samples`, `showInitialVectors`, `showKeyPoints`, `world`,
   `drag` (only zero is supported; nonzero values are rejected).
2. Compute analytics with `projectileAnalytics(model)` -> returns
   `{apex: { time, position }, range: { time, distance }, flightTime,
   maxHeight }` (verify exact shape in `projectile.ts`).
   - Apex time is `vy / g` when `vy > 0`; otherwise 0 (no apex).
   - Flight time is the positive root of `y(t) = 0` after the apex
     (when `vy > 0`) or simply the positive root (when `vy <= 0`).
     This works for horizontal launches (`vy = 0`), downward launches
     (`vy < 0`), and ground-level launches (`y0 = 0`).
   - Ground is y=0. Below-ground launches and zero gravity are rejected.
   - The rendered trajectory stops at impact or an earlier requested `tMax`.
     Future apex/impact labels are omitted for a partial interval.
3. `validateProjectile(model)` then `renderProjectile(model)`.
4. Surface `apex.time`, `apex.position.y` (max height),
   `flightTime`, and `range.distance` alongside the SVG.

### Pulley

1. Build a `PulleyModel` with `pulleys: { center, radius, fixed,
   label? }[]`, `masses: { mass, position, size: {w,h}, label? }[]`,
   `tension` (N, >= 0), `world`, `width`, `height`. Optional: `title`.
2. `validatePulley(model)` enforces at least one pulley, one mass,
   non-negative tension.
3. Supported routes are a single fixed wheel, an Atwood pair over one or
   two fixed wheels, and `configuration: "movable"` with one moving wheel
   and one load below its axle. The movable route explicitly anchors one
   end at the support and lifts the other: MA=2. Fixed routes have MA=1.
   General compound routing is rejected; do not infer MA from wheel count.
   For vertical Atwood motion place loads under the wheel's outer tangent
   contacts. Tension is supplied by the caller; use `atwoodDynamics` in
   `pulley.ts` when the ideal Atwood assumptions apply.
4. `buildSceneFromPulley(model)` then `renderPulley(model)`.

### Optics

1. Build an `OpticsModel` with `element: OpticalElement`
   (plane-mirror / concave-mirror / convex-mirror / thin-lens-
   converging / thin-lens-diverging), `objectHeight`, `objectBase:
   Vec2`, `world`, `width`, `height`. Optional: `title`.
2. Compute the image with `lensImage(model)` -> returns
   `{imageHeight, imageBase, magnification, rayPath, virtual, atInfinity}`.
   Incoming light travels left to right. Supply a positive focal length for
   converging lenses/concave mirrors and negative for diverging lenses/convex
   mirrors. Spherical `radius` must equal `2*abs(focal)`. The object base
   lies on the element's optical axis. Rays use the ideal paraxial model;
   curved mirror outlines are schematic. `atInfinity` marks an object at
   focus; do not format its infinite analytics as a finite image position.
   The renderer shows parallel outgoing rays and a caption for that case.
3. `buildSceneFromOptics(model)` then `renderOptics(model)`.

### Fields

1. `renderVectorField(model: VectorFieldModel)` where `model = {type:
   "vector", field: VectorField2D, world, width, height, cols, rows,
   scale?, encoding?, title?}`. `field` is `(p: Vec2) => Vec2`. Equal-length
   direction arrows are the default and labeled accordingly. Use
   `encoding: "magnitude"` for lengths proportional to field magnitude.
   Grid dimensions must be finite integers from 2 through 200.
2. `renderScalarField(model: ScalarFieldModel)` where `model = {type:
   "scalar", field: ScalarField2D, world, width, height, cols, rows,
   title?, contours?: number[]}`. `field` is `(p: Vec2) => number`.
   Contours use piecewise-linear interpolation over a triangulated grid;
   refine the grid to resolve curved level sets. Undefined samples are
   gray and excluded from contour geometry. Supply pure field callbacks.
3. For time-varying plots of `f(t)` or `f(x)`, prefer `renderPlotSvg`
   from the graph engine; sample with `samplePlot` / `sampleMulti`.

## What to hand back

- The SVG path and a rendered preview when possible.
- The key analytic quantities (apex height, image distance, MA, etc.)
  in a small summary.
- The relevant model assumptions. Do not claim universal textbook accuracy
  from passing tests or reuse the old synthetic benchmark percentages.

## Common failure modes

- **Inconsistent units.** Reject mixes of mm/inches, deg/rad.
- **Negative lengths / mass / time constants.** Surface and ask.
- **Off-canvas geometry.** Set explicit `world` bounds; do not rely
  on auto-computation if the user has a fixed canvas in mind.
- **Invalid field grid.** Use finite integer cols/rows in [2,200].
- **Renderer drift.** Two consecutive renders must match
  byte-for-byte. If not, stop and report - determinism is
  load-bearing.
