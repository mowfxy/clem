---
name: kinetra-kmap
description: Build a 2-4 variable Karnaugh map and Boolean SOP/POS minimization using Kinetra's deterministic TypeScript core. Use when the user asks to minimize a Boolean expression, build a truth table, group K-map cells, handle don't-cares, render a logic circuit from an expression, or verify an existing minimization with a mask check. Do not use for general numeric algebra, arithmetic minimization, or non-Boolean search.
---

# Kinetra K-map

Route into the Kinetra core for deterministic, byte-stable Boolean
minimization. Every render is reproducible given the same input. Prefer
the CLI demo at `workflow-a` as the canonical happy-path example.

## When to activate

- The user posts a Boolean expression in `!`, `+`, `*` (or spelled out
  AND/OR/NOT) and asks for a minimized form.
- The user provides a minterm list (`m3 + m7 + ...`) or a truth table.
- The user mentions "K-map", "Karnaugh", "SOP", "POS", "Quine-McCluskey".
- The user asks to render a logic circuit from an expression.

Do not activate for arithmetic minimization, search problems, or SAT
solving - those have separate toolchains.

## Core entry points

All paths are relative to the repo root and resolve under
`packages/core/src/...`.

```ts
import { buildKMap } from "../../../../core/src/dld/kmap.js";
import { buildTruthTable, minterms, maskToMintermExpression } from "../../../../core/src/dld/truth_table.js";
import { parseBoolExpr, xor, variable, constant, and, or, not, collectVariables } from "../../../../core/src/dld/expression.js";
import { simplifyExpression } from "../../../../core/src/dld/simplify.js";
import { context } from "../../../../core/src/dld/boolean.js";
import { expressionToCircuit } from "../../../../core/src/dld/circuit.js";
import { renderLogicSchematic } from "../../../../core/src/diagram/logic_schematic.js";
```

`KMAP_MAX_VARS = 4` is a hard ceiling; >4 variables must be cofactored.

## Workflow

1. **Normalize the input.** Parse the user's expression with
   `parseBoolExpr`, or derive a minterm mask from a truth table.
2. **Sanity-check.** Verify the variable set is in `[2, 4]`; collect it
   with `collectVariables`.
3. **Build the canonical mask.** Convert the expression to a mask via
   `expressionToMask(expr, context(vars))` or `maskFromMinterms` /
   `maskFromMaxterms`. This is the single source of truth.
4. **Run the K-map minimizer.** Call
   `buildKMap({ variables, minterms, dontCares?, form?: "sop" | "pos" })`
   (`form` defaults to `"sop"`; any other value is ignored).
   The returned `KMap` exposes `cells` (per-cell value `0 | 1 | "x"`),
   `groups` (each `KMapGroup` has `cells`, `positives`, `negatives`,
   `usesDontCare`), `simplified` (the minimized `BoolExpr`),
   `simplifiedText` (the formatted SOP/POS string), and the masks
   `mintermMask` and `dontCareMask` (both `bigint`).
5. **Verify.** Independently evaluate `kmap.simplified` over every
   assignment and compare masks. Never trust the minimizer without a
   mask-equality check against the user's minterm list.
6. **Render.** Build a circuit from the expression with
   `expressionToCircuit(name, expr)` and render with
   `renderLogicSchematic({ circuit, width, height, title })`. The
   schematic is byte-stable for the same input.

## Don't-cares

- If the user marks X / `dontCares`, pass them in. Groupings may include
  them, but only if doing so also covers a real minterm.
- Don't-care cells must not appear in the final expression mask. Verify
  with the mask equality check in step 5.

## What to hand back

- The minimized expression (SOP or POS, whichever was requested).
- The list of prime implicants / K-map groups.
- The truth table rows if the user asked.
- A path to the rendered schematic when a diagram was requested.
- A short summary of the verification step (mask equality).

## Common failure modes

- **>4 variables.** Refuse and explain. Suggest cofactoring.
- **Non-disjoint variable sets across sub-expressions.** Normalize first
  with `collectVariables`; reject if the union exceeds 4.
- **Mixing `1` / `0` / `true` / `false` literals.** Use `constant(0)` or
  `constant(1)` from `expression.ts`.
- **Renderer drift.** If two consecutive renders differ byte-for-byte
  for the same input, stop and report it - determinism is load-bearing.
