# Mowr integration patches

The vendored core has four small fixes for the desktop bridge:

- Import the Boolean constructors used by truth-table expression conversion.
- Import the derivative function used by the math evaluator.
- Treat transient recorded component IDs as strings.
- Negate actual literals in POS K-map groups without unsafe AST property access.

The desktop bridge, JSON adapters, skill/API loader and illustrated PDF exporter live in `desktop/`. PDF figures use Chromium SVG rendering; the upstream PDF `addFigure` placeholder is not used. Original license: Apache-2.0.
