---
name: kinetra-compose
description: Compose an accurate, non-overlapping custom engineering or physics diagram from Kinetra's toolkit parts (mechanics, fields, fluids, thermo, circuits, logic, controls, plots) with formulas with units, relational placement, declared checks for every law it claims, and an overlap gate. Use when the user needs a technical diagram that no Kinetra template (kinetra-diagrams, kinetra-circuits, kinetra-kmap, kinetra-textbook-diagrams) can draw, such as shear and moment diagrams, trusses, Mohr's circle, P-V cycles, Bode or root-locus plots, block diagrams, state machines or datapaths. Do not use when a template fits, for 3D scenes, or for decorative illustrations without engineering content.
---

# Kinetra Compose

Build a custom 2D diagram as a JSON composition: named parts placed by
relations, every quantity a formula with units, and checks for the laws the
diagram claims. `compose` renders it only when every check passes and nothing
overlaps; otherwise it returns precise errors to fix. The output matches the
Kinetra template style exactly.

The full rules, cheat-sheet and worked examples are in
`docs/toolkit/rules.md`; every part is in `docs/toolkit/parts.md`; 30 checked
examples are in `examples/toolkit/proof/`.

## When to activate

- The user wants an engineering or physics figure and no Kinetra template
  shows it (check `kinetra-diagrams`, `kinetra-circuits`, `kinetra-kmap` and
  `kinetra-textbook-diagrams` first).
- The figure carries numbers that must be right: forces, reactions, currents,
  curves, phasors, states.

## The rules

1. Use an existing template if one fits; only otherwise compose.
2. Work out the physics first: write the governing equations and compute the
   values before drawing.
3. Express every quantity-bearing number as a formula with units in `vars`
   or on the element (`"magnitude": "m*g*sin(theta)"`), never a hand-typed
   coordinate.
4. Position by relationships (`attach`/`to`, `tangentTo`, `along`,
   `alignedWith`, anchor offsets) rather than raw coordinates.
5. Declare checks for every law the diagram claims: equilibrium
   (`vectorSum`, `momentSum`), conservation (`equal`), KCL (`kcl`) and KVL,
   consistency between linked plots, inequalities. Each check must be able to
   fail.
6. Call `compose`. On errors, fix exactly what is reported and retry. Never
   suppress the gate: no `mayTouch` to hide a real overlap, no widened
   tolerance, no deleted check.
7. Present the result with the report: what was verified and what was assumed.
   Never claim correctness beyond the checks.

## How to call it

```ts
import { compose } from "../../../../core/src/toolkit/index.js";

const r = compose(model);
if (!r.ok) {
  for (const e of r.errors) console.log(e.code, e.elements, e.message, e.suggestion);
} else {
  // r.svg is the figure; r.report.checks lists every check with expected, actual and tolerance.
}
```

From the shell: `npm run compose -- model.json out.svg` writes `out.svg` and
`out.report.json`, or prints the errors and exits 1.

## Quick reference

- Model: `{ canvas: { width, height, world: { xMin, xMax, yMin, yMax }, worldUnit? }, title?, caption?, vars, scales?, elements, checks }`; world +y is up.
- Points: `{"x", "y"}`, `"id"`, `"id.anchor"`, `"id.anchor(arg)"`, `{"ref": "id.anchor", "dx", "dy"}`.
- Checks read `vars`, part refs (`F.magnitude`, `s.area`, `p.dataY`, `V.re`) and anchor coordinates (`T.surface.y`).
- Labels: let the placer choose; `F_N`, `V_{CC}`, `x^2`, `\theta` render as real scripts. Titles and captions are plain text.
- The spring part is `coilSpring`. Units include kN, MPa, litre, eV and nm; `-3^2` is `-9`.
- Allowed without `mayTouch`: parts joined by their named end points, series on their axes, phasors sharing the polar origin, cleanly crossing wires or connectors, current arrows on their conductor. Grid lines are low priority; filled media take `"background": true`.

## Reporting

End with a short report, for example: "Verified: 4 declared checks passed
(ΣF = 0, ΣM = 0, f ≤ μN, N ⟂ slope); 0 overlaps; style contract met. Assumed:
rigid block, Coulomb friction, g = 9.81 m/s²." The toolkit checks geometry,
units, overlaps and the declared laws; it cannot know whether the chosen
physics is the right model for the problem.
