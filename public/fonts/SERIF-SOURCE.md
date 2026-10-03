Mowafy Serif is imported byte for byte from https://github.com/mowfxy/serif
at revision abf57cc (broad coverage in every style, derived from Source Serif 4, OFL).

Each file covers Latin, Greek, Cyrillic, Arabic, math and symbols, so no
companion fonts are needed. The Text cut's Regular, Bold, Regular Italic and
Bold Italic are shipped. `src/type.css` and `core/serif-fonts.ts` expose them as
Mowafy Serif at weight bands 300-500 and 600-800. Native MathML uses the
dedicated Mowafy Math face.

The desktop's external pages embed the upright files through
`desktop/brand-fonts.ts`. Copyright notices and licenses are in `licenses/`.
