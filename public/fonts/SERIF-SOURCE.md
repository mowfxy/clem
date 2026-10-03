Mowafy Serif in Mowr is two imports from https://github.com/mowfxy/serif:

- `MowafySerif-{Regular,Bold,RegularItalic,BoldItalic}.woff2` are Soft Ink Serif
  Book, Bold, Book Italic and Bold Italic (revision 1deb0be, derived from
  Source Serif 4, OFL): Latin, Greek and Cyrillic.
- `MowafySerifFull-*.woff2` are the fuller Mowafy Serif styles from revision
  cb34d94. They only supply what Soft Ink lacks, such as Arabic, math and symbols.

`src/type.css` and `core/serif-fonts.ts` declare the Full styles first and the
Soft Ink faces last with their own character range, so Soft Ink wins wherever it
has the character. The desktop's external pages inline only the Regular face
through `desktop/brand-fonts.ts`. Native MathML uses the dedicated Mowafy Math
face. Copyright notices and licenses are in `licenses/`.
