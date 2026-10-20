# Third-party notices

Clem itself is MIT licensed (see `LICENSE`). These bundled components keep their own licenses.

## Mowafy Sans and Mowafy Serif — SIL Open Font License 1.1

The interface and reading fonts in `public/fonts/` are under the SIL Open Font License 1.1. License texts and sources:
`public/fonts/Mowafy-OFL.txt`, `public/fonts/licenses/` and `public/fonts/SERIF-SOURCE.md`. The fonts may be used, shared
and modified under the OFL, but not sold on their own.

## Kinetra — MIT

Calculations, figures, PDF and Office tools in `vendor/kinetra/`. License: `vendor/kinetra/LICENSE`. Clem's changes are
listed in `vendor/kinetra/CLEM_PATCHES.md`.

## libheif (through libheif-js 1.23.2) — LGPL-3.0

Clem converts iPhone HEIC/HEIF photos to JPEG on attach with **libheif**, compiled to WebAssembly and packaged as the
npm module [`libheif-js`](https://github.com/catdad-experiments/libheif-js) (libheif: <https://github.com/strukturag/libheif>).
Both are licensed under the GNU Lesser General Public License v3.0; the full text ships as `licenses/libheif-js-LGPL-3.0.txt` in the app (copied from `node_modules/libheif-js/LICENSE` by `scripts/build-desktop.mjs`).

- The library is used **unmodified**, loaded at run time from its own file (`libheif.wasm`, with its JavaScript loader in a separate worker script), not merged into Clem's code, so it can be replaced by another build of the same library.
- Source code: the versions above, from the repositories linked; `npm pack libheif-js@1.23.2` gives the exact package Clem ships.
- HEVC (the codec inside HEIC) is covered by patents in some countries; the library is provided as is.
