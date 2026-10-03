Mowafy Serif is imported byte for byte from https://github.com/mowfxy/serif at
revision c0f52a6 (Make Bold only slightly heavier than Regular): the original
Latin Regular and Bold plus the Greek, Arabic, math, math supplement, science,
science supplement and Coptic supplement companions.

`src/type.css` and `core/serif-fonts.ts` expose them as one family, Mowafy Serif,
with non-overlapping Unicode ranges in the source package's fallback order.
Companions without a Bold use their Regular at both weights. There is no italic
(browsers slant the Regular). Native MathML uses the dedicated Mowafy Math face.

The desktop's external pages embed the Latin, Greek and Arabic files through
`desktop/brand-fonts.ts`. Copyright notices and licenses are in `licenses/`.
