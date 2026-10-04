# Mowr integration patches

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
- `test/diagram/circuit_layout.test.ts` rebuilds the electrical nets from the drawn wires and checks them against the netlist, plus clearances, on fixed and random circuits.

The desktop bridge, JSON adapters, skill/API loader and illustrated PDF exporter live in `desktop/`. PDF figures use Chromium SVG rendering; the upstream PDF `addFigure` placeholder is not used. Original license: Apache-2.0.
