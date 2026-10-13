Mowafy Serif comes from https://github.com/mowfxy/serif at revision 953b2ed (Mowafy Serif 3.1: lighter, evenly spaced weights, natural italics, Source Serif 4
with Arabic, Greek, Hebrew, Devanagari, Bengali, Tamil, Thai, Armenian,
Georgian, math, science and Coptic companion families).
Import a newer revision with `python scripts/import-serif.py <serif checkout>`.

Mowr ships Light, Regular, Medium, Bold, Italic, Medium Italic and Bold Italic. Each style has
`MowafySerif-<style>.woff2`, a Latin cut (about 60 kB) that the app, emails, server pages and films load, and
`MowafySerifFull-<style>.woff2`, the whole Mowafy Serif file (Greek, Cyrillic, extended Latin). The companions
(`MowafyGreek-*`, `MowafyArabic-*`, `MowafyHebrew-*`, `MowafyDevanagari-*`, `MowafyBengali-*`, `MowafyTamil-*`, `MowafyThai-*`,
`MowafyArmenian-*`, `MowafyGeorgian-*`, `MowafyMath-Regular`, `MowafyMathSupplement-Regular`, `MowafyScience-Regular`,
`MowafyScienceSupplement-Regular`, `MowafyCopticSupplement-Regular`) are declared under the same family in
`src/type.css`, each with a unicode-range of only what the files before it leave out, so they are fetched only for
those scripts and symbols. Bold weights use the companions' Bold where there is one.
CSS weights: Light 300, Regular 400, Medium 500, Bold 600-800; italics 300-400, 500 and 600-800.
Medium is the bold inside answers and file previews; Bold is for headings.

Native MathML uses `MowafyMath-Regular.woff2` from the same revision, only for `<math>`.
The desktop's external pages inline the Latin cuts through `desktop/brand-fonts.ts`.
The license is `Mowafy-OFL.txt`.

Mowafy Sans comes from https://github.com/mowfxy/sans at revision f3b1e92 (Mowafy Sans 6.0: Light to Bold with italics,
script and math companions). Import a newer revision with `python scripts/import-sans.py <sans checkout>`; it rewrites the
Mowafy Sans block in `src/type.css`.
