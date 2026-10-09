Mowafy Serif comes from https://github.com/mowfxy/serif at revision 68dca33 (Mowafy Serif 2.4: six weights
with italics, built from Source Serif 4, covering Latin, Greek, Cyrillic, Arabic and math). Import a newer
revision with `python scripts/import-serif.py <serif checkout>`.

Mowr ships Light, Regular, Bold, Italic and Bold Italic. Each is split in two:
`MowafySerif-<style>.woff2` is a Latin cut (about 60 kB) that the app, emails, server pages and films load,
and `MowafySerifFull-<style>.woff2` is the upstream file unchanged, declared in `src/type.css` with a
unicode-range of only what the Latin cut leaves out, so it is fetched only for other scripts and symbols.
CSS weights: Light 300, Regular 400-500, Bold 600-800; italics 300-500 and 600-800.

Native MathML uses `MowafyMath-Regular.woff2` from the same revision, only for `<math>`.
The desktop's external pages inline the Latin cuts through `desktop/brand-fonts.ts`.
The license is `Mowafy-OFL.txt`.
