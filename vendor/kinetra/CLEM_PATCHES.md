# Clem integration patches

The vendored core has four small fixes for the desktop bridge:

- Import the Boolean constructors used by truth-table expression conversion.
- Import the derivative function used by the math evaluator.
- Treat transient recorded component IDs as strings.
- Negate actual literals in POS K-map groups without unsafe AST property access.

Expression parsing repairs (the vendored copy had lost its non-ASCII characters, which silently changed behaviour):

- `π`, `Σ`/`∑`, `∏`, `×`/`·` restored. Previously any identifier starting with `p` parsed as π (so `pi` became π·i and `pow(x,2)` failed) and any starting with `S` began a sum.
- `pi` spelled out is the constant π.
- Implicit multiplication after a number only applies before a letter, `(` or `π`, so `(a)^(b)` parses.
- Unary minus binds looser than `^`: `-x^2` is `-(x²)`, and exponents may be signed (`2^-x`).
- Plots draw measured data as markers (with error bars), include them in the axis range, never join scatter points with lines, and the legend no longer emits a duplicate `y` attribute that made multi-curve SVGs invalid.
- Boolean NOT also accepts a postfix apostrophe (`A'`, `(A + B)'`).
- Plot curves no longer end with a closing `Z`, which drew a false straight line from the last point back to the first.
- Boolean XOR accepts `⊕`, `^` or `xor`, and formatted results print `⊕`.

Diagram quality (all diagrams):

- Circuits: `renderCircuit` lays out a netlist (elements between named nodes) on its own: ground rail, nodes on a top rail, shunt elements between them, series elements on the rail and longer connections arched over it with nested arches never crossing. Every wire is horizontal or vertical, junctions carry dots, polarity marks stay upright, and dependent sources are diamonds. Optional current arrows and +/− voltage marks.
- `renderSchematic` (components placed by coordinates) routes wires at right angles around the symbols instead of drawing straight pin-to-pin diagonals, and adds junction dots.
- Circuit labels print a value once with engineering prefixes ("4 ohm" with value 4 → "4 Ω"; 2200 Ω → "2.2 kΩ") and are placed by a collision search that keeps 7 px from every wire, symbol, other label and the frame.
- Scene diagrams (free-body, projectile, optics, pulley, fields) place each label at its usual spot when clear, otherwise at the nearest clear spot beside, above or below the point it labels.
- One circuit model for drawing and numbers: `circuit/circuit.ts` reads the netlist `renderCircuit` draws (`normalizeNetlist`, SI units from prefixed units, dependent sources linked to the `current`/`voltage` their label names, the same ground rule via `netlistGround`), `circuit/spice.ts` `solveNetlist` returns its DC operating point (node voltages, each element's voltage, current and power; diodes by constant drop) and `solveNetlistTransient` runs `solveTransient` on it by name. `test/circuit/netlist.test.ts` checks them against hand analysis.
- `test/diagram/circuit_layout.test.ts` rebuilds the electrical nets from the drawn wires and checks them against the netlist, plus clearances, on fixed and random circuits.

Audit fixes (`test/audit_fixes.test.ts`):

- Expressions: a bare `e` is Euler's number (`2e`, `2exp(x)` were NaN / "xp"); `d/dx(f)` differentiates by `x` (it used `dx`, so every derivative was 0) and `d/t` divides; implicit multiplication works after brackets, constants and single letters (`(x+1)x`, `x y`, `πr^2`, `x(x+1)`); sums and products parse (`Σ k=1 to n (k)`, `1...4`); `log(x)` is log₁₀ (was NaN); variable lookup ignores `Object` prototype names.
- Symbolic: polynomial products keep repeated factors (`x·x` was `x`; `x·y` looped forever) and nested sums no longer share one accumulator; negative exponents are refused; `simplify` leaves non-polynomial terms alone instead of throwing; derivatives use the power rule for constant exponents (`x^2` at `x ≤ 0` was NaN or division by zero), `|u|' = u'·sign(u)`, cover log₁₀/log₂/cbrt/pow/atan2/mod/floor (unknown functions returned `−u'`), nest `d/dx` correctly and refuse products/min/max; `integratePoly` raises the power (`x²` gave ⅓); `findPolynomialRoots` finds every real and complex root (Durand–Kerner; it returned nothing for quadratics).
- K-maps: implicants merged twice are no longer kept as primes, the cover is exact (greedy gave extra terms in ~1 map in 13), POS treats don't-cares as free and prints a product (`A(B + !D)`, not `A + (…)`), cell positions match the minterm numbering used everywhere else (first variable = bit 0), out-of-range minterms are refused. The kmap skill states the numbering.
- Boolean parser: spelled-out `or`, `and`, `xor`, `not` (any case) are operators, not letters (`A or B` was A·O·R·B).
- `solveTransient` refuses `dt ≤ 0` (dt = 0 looped forever); plots survive a zero-width x range (NaN) and a y range below double spacing (tick loop overflow); SVG backgrounds are escaped.
- Plugin test: SKILL.md frontmatter is read with CRLF line endings (Windows checkouts).

The desktop bridge, JSON adapters, skill/API loader and illustrated PDF exporter live in `desktop/`. PDF figures use Chromium SVG rendering; the upstream PDF `addFigure` placeholder is not used. Original license: Apache-2.0.
