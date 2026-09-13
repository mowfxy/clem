---
name: kinetra-circuits
description: Solve DC operating points and transients for RC/RL/RLC electrical circuits using Kinetra's deterministic pure-TypeScript SPICE-lite solver, and render a schematic. Use when the user describes an analog circuit (resistors, capacitors, inductors, independent sources, switches), asks for V(t) or I(t), wants a step or natural response for an RC/RL/RLC network, or asks to convert a textual netlist into a schematic. Do not use for digital logic gates (use kinetra-kmap instead), microwave/transmission-line analysis, or SPICE .lib model fitting.
---

# Kinetra Circuits

Route into the Kinetra pure-TS circuit solver. The solver is intentionally
simple: it handles R, L, C, independent V/I sources, and switches via
modified nodal analysis (DC) and backward Euler (transient). It does
not replace commercial SPICE.

## When to activate

- User describes a circuit with R, L, C, sources, switches and asks for
  V(t), I(t), time constant, or a schematic.
- User mentions "RC low-pass", "RL high-pass", "RLC band-pass", or wants
  step-response / natural response plotted.

Do not activate for digital gates, op-amp macromodels with internal
transistors, transmission lines, or .model library fitting.

## Core entry points

All paths are relative to the repo root.

```ts
import {
  newCircuit, addResistor, addCapacitor, addInductor,
  addVoltageSource, addCurrentSource, addSwitch, addGround,
  validateCircuit,
} from "../../../../core/src/circuit/circuit.js";
import { solveDC, solveTransient } from "../../../../core/src/circuit/spice.js";
import { renderSchematic } from "../../../../core/src/diagram/circuit_schematic.js";
import { renderPlotSvg } from "../../../../core/src/graph/render_svg.js";
import { samplePlot } from "../../../../core/src/graph/sample.js";
```

## Workflow

1. **Build the netlist.** Start with `newCircuit(name)`, allocate
   node ids with `addNode(c)` (returns a `CircuitNodeId`) for each
   non-ground node, then `addResistor(c, nA, nB, ohms, label?)`, `addCapacitor`,
   `addInductor`, `addVoltageSource(c, nPlus, nMinus, volts, label)`,
   `addCurrentSource(c, nIn, nOut, amps, label)`, `addSwitch`, and
   `addGround(c, nodeId)`. Call `validateCircuit(c)` before solving.
2. **DC analysis.** Call `solveDC(c)` (or `solveDC(c, { sourceOverride: Map<id, volts> })`
   to pin specific voltage sources) for the operating point. The
   result exposes `nodeVoltages: Map<number, number>` (volts),
   `componentCurrents: Map<string, number>` (amps), and
   `componentPowers: Map<string, number>` (watts).
3. **Transient analysis.** Call `solveTransient(c, { startTime,
   endTime, dt, events?, recordNodes?, recordComponents?, waveform? })`.
   Choose `dt` small enough to resolve the smallest time constant
   (rule of thumb: dt < 0.1 * tau). `waveform: (t) => volts` overrides
   the first voltage source per step (useful for square/pulse/sine
   inputs); `recordNodes` and `recordComponents` ensure their arrays
   are populated even when not present in the model.
4. **Plot V(t).** `transient.times` is an array of seconds; `transient.nodeVoltages`
   is a `Map<nodeId, number[]>` of parallel arrays. Build a scatter
   `PlotSpec` with `{ id, title, type: "scatter", xRange, yRange,
   xAxis, yAxis, data: [{x, y}, ...] }` by zipping `transient.times`
   with `transient.nodeVoltages.get(nodeId)`, then call
   `renderPlotSvg(spec)`. The SVG output is byte-stable for the same
   spec.
5. **Render schematic.** Build a `Schematic` model with `components`
   (id, kind, x, y, label) and `wires`, then `renderSchematic`.

## Solver limits to surface honestly

- No dependent sources, no op-amp macromodels, no mutual inductance.
- No .model / .subckt support. Netlists are constructed in TypeScript.
- DC uses modified nodal analysis; circuits with a floating sub-network
  (no DC path to ground) will throw `Error: "Singular matrix"`. The
  solver does NOT run a connectivity check; confirm ground connectivity
  before solving.
- Transient uses fixed-step backward Euler. Capacitors are stamped with
  `I = C * (V - V_prev) / dt`; inductors use a Thevenin companion
  (`R_eq = L/dt`, `V_eq = R_eq * I_prev`) which approximates the inductor
  as a resistor in series with a voltage source. Very stiff RLC networks
  may need a smaller `dt` than naive estimates suggest.

## What to hand back

- DC voltages and currents in a small table.
- Transient V(t) plot for the requested probe node.
- Schematic SVG path.
- Time constants computed from R*C / L/R / 2*pi*sqrt(L*C) where useful.

## Common failure modes

- **Floating node.** `validateCircuit` only checks values and the
  presence of a ground component - it does NOT verify topology. A
  floating sub-network surfaces as `Error: "Singular matrix"` from
  `solveDC` or `solveTransient`. Add a ground-tied resistor or wire to
  any sub-network that lacks a DC path back to ground.
- **Switch event outside the time window.** Validate `events[i].t`
  is in `[startTime, endTime]` before passing them in. Events past
  `endTime` are silently dropped.
- **dt too coarse.** If the result looks stepped or the energy check
  diverges, halve `dt` and re-run.
- **Schematic drift.** Two renders of the same schematic must match
  byte-for-byte. If not, stop and report - determinism is load-bearing.
