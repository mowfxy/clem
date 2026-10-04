Mowafy Serif is imported byte for byte from https://github.com/mowfxy/serif at
revision 898d879 (Fix P spacing, widen word space, redraw E, L and w): the original Latin Regular and Bold,
and nothing else. No Source Serif 4, Soft Ink, Noto or STIX faces are loaded,
and the serif stack names no fallback font.

`src/type.css` declares Regular at weights 300-500 and Bold at 600-800. There is
no italic (browsers slant the Regular). Native MathML uses the separate
`MowafyMath-Regular.woff2` (STIX-derived) and only for `<math>`.

The desktop's external pages embed both weights through `desktop/brand-fonts.ts`.
Licenses are in `licenses/`.
