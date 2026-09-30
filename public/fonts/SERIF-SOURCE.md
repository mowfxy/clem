Mowafy Serif is imported byte for byte from https://github.com/mowfxy/serif
at revision 3f1dea6 (Match bold and companion Latin to the approved Regular).

The original Latin Regular and Bold and all nine companion WOFF2 files are
included. `src/type.css` and `core/serif-fonts.ts` expose them as Mowafy Serif
using non-overlapping Unicode ranges in the source package's fallback order:
Latin, Greek, Arabic, math, math supplement, science, science supplement,
Coptic supplement. Companions without Bold use their supplied Regular at
both requested weights. Native MathML uses the dedicated Mowafy Math face.

The desktop's external pages embed the same files and ranges through
`desktop/brand-fonts.ts`. Copyright notices and licenses are in `licenses/`.
