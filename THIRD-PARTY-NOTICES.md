# Third-party notices

## libheif (through libheif-js 1.23.2) — LGPL-3.0

Mowr converts iPhone HEIC/HEIF photos to JPEG on attach with **libheif**, compiled to WebAssembly and packaged as the
npm module [`libheif-js`](https://github.com/catdad-experiments/libheif-js) (libheif: <https://github.com/strukturag/libheif>).
Both are licensed under the GNU Lesser General Public License v3.0; the full text is in `libheif-js-LGPL-3.0.txt`.

- The library is used **unmodified**, loaded at run time from its own file (`libheif.wasm`, with its JavaScript loader in a separate worker script), not merged into Mowr's code, so it can be replaced by another build of the same library.
- Source code: the versions above, from the repositories linked; `npm pack libheif-js@1.23.2` gives the exact package Mowr ships.
- HEVC (the codec inside HEIC) is covered by patents in some countries; the library is provided as is.
