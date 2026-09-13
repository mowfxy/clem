/**
 * PDF layout helpers.
 *
 * Re-export of geometry primitives from the PDF emitter. Higher-level
 * document composition lives in `./document.ts`.
 */
export { BLACK, WHITE, GRAY, RED, BLUE, GREEN, ORANGE } from "./pdf.js";
export type { RgbColor, StandardFont, Point2D, TextOptions, LineOptions, RectOptions, PathOptions } from "./pdf.js";
