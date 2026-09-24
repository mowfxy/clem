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

The desktop bridge, JSON adapters, skill/API loader and illustrated PDF exporter live in `desktop/`. PDF figures use Chromium SVG rendering; the upstream PDF `addFigure` placeholder is not used. Original license: Apache-2.0.
