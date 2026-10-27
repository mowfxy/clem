# Composition toolkit

The toolkit is an additional path next to Kinetra's fixed templates. An agent
describes a 2D engineering diagram as named parts placed by relations, with
every quantity written as a formula with units and every claimed law declared
as a check. `compose(model)` returns an SVG only when all checks pass and the
overlap gate finds nothing; otherwise it returns structured errors that name
the elements involved and how to fix them. Output goes through the same
`renderScene2D` pipeline as the templates and is checked against the
[style contract](style-contract.md), so it looks like the rest of Kinetra.

| Document | Contents |
| --- | --- |
| [rules.md](rules.md) | The rules an agent follows, a cheat-sheet and six worked examples |
| [engine.md](engine.md) | Model format, pipeline, relations, expressions, checks, gate, error codes |
| [parts.md](parts.md) | All 92 library parts (plus 11 basic shapes): options, anchors, samples |
| [style-contract.md](style-contract.md) | The SVG rules toolkit output must meet |
| [contact-sheet/](contact-sheet/) | Every part, the worked examples and the 30-diagram proof set (`proof.html`, `proof.png`) |
| [HANDOFF.md](HANDOFF.md) | What each of the three build stages added, test counts and open issues |

The plugin skill `kinetra-compose` (`packages/plugin/skills/kinetra-compose/`)
carries the same rules for agents.

## Try it

```sh
npm run compose -- examples/toolkit/proof/07-mohr-circle.json out/mohr.svg
npm run proof:toolkit        # compose all 30 proof diagrams, write SVGs and the contact sheet
npm run test:toolkit         # unit, error, fuzz, part, example and proof-set tests
npm run test:compat          # golden outputs, API lock and style contract of the templates
```

## What is verified, and what is not

**Verified on every render:**

- every relation and anchor resolves, with no contradiction or ambiguity;
- every expression has consistent units, and nothing is non-finite;
- every declared check passes: equilibrium (`vectorSum`, `momentSum`), KCL,
  equalities and inequalities (conservation, KVL, limits), points on curves,
  tables, proportional arrows;
- quantity arrows are drawn to their declared scale, and the scale is printed;
- nothing drawn overlaps anything else unless the contact is declared or is a
  built-in contact of the parts (a connector on the parts it joins, phasors at
  the polar origin, cleanly crossing wires), and text never overlaps anything;
- everything lies inside the canvas, and the SVG meets the style contract;
- the same model always produces the same bytes.

**Not verified:**

- whether the agent modelled the right physics, chose the right inputs or made
  sensible idealisations: the toolkit checks the diagram against the agent's
  declared model, not against the real problem;
- laws the agent did not declare as checks;
- aesthetic quality beyond the overlap and bounds rules (balance, emphasis),
  which still needs a human or visual review.

## Proof set

`examples/toolkit/proof/` holds 30 diagrams built only from toolkit parts:
beam with shear and moment diagrams, truss by the method of joints, ladder,
incline with friction, Atwood machine, mass–spring–damper with response,
Mohr's circle, stress–strain curve, Carnot P–V cycle, heat-engine energy flow,
pump and tanks, Venturi meter, refraction and total internal reflection,
standing wave, dipole field lines and equipotentials, wire magnetic field,
Wheatstone bridge, inverting amplifier, RLC phasors, three-phase phasors, Bode
plot, step response, root locus, feedback block diagram, Moore machine,
Karnaugh map, CPU datapath, flowchart, hydrogen energy levels and a Minkowski
diagram.

`packages/core/test/toolkit/proof_set.test.ts` composes each one (zero
collisions, style and SVG oracle clean, deterministic), recomputes its physics
independently in plain JavaScript (linear solves, ODE integration, numerical
integration, simulation), and injects one wrong piece of physics per diagram
that a declared check must reject.
