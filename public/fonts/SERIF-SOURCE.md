Mowafy Serif in Mowr is two imports from https://github.com/mowfxy/serif:

- `MowafySerif-Regular.woff2` is Soft Ink Serif Book (revision 2967d3c, derived
  from Source Serif 4, OFL): the Regular text face for Latin, Greek and Cyrillic.
- `MowafySerifFull-*.woff2` are the fuller Mowafy Serif styles from revision
  cb34d94 (Regular, Bold, Regular Italic, Bold Italic). They supply bold, italic
  and every script the Book face lacks, such as Arabic, math and symbols.

`src/type.css` and `core/serif-fonts.ts` declare the Full styles first and the
Book face last with its own character range, so Book wins wherever it has the
character. The desktop's external pages inline only the Book face through
`desktop/brand-fonts.ts`. Native MathML uses the dedicated Mowafy Math face.
Copyright notices and licenses are in `licenses/`.
