/**
 * PDF figure helpers.
 *
 * A "figure" is a labelled, captioned SVG/PNG block embedded into a PDF
 * page. The composer measures the figure and the page margin to choose a
 * placement; this module exposes the helper functions used by the
 * document composer.
 */

import type { RectOptions } from "./pdf.js";

export interface FigureBlock {
  kind: "svg" | "png";
  /** Width in points; height is computed from the aspect ratio when set. */
  widthPt: number;
  /** Optional explicit height. When omitted, computed from widthPt and the aspect ratio. */
  heightPt?: number;
  /** Source bytes (decoded). */
  data: string; // svg XML or base64-encoded PNG
  caption?: string;
  label?: string;
  /** x,y in points relative to the page origin. */
  x: number;
  y: number;
}

/**
 * Auto-compute a figure's height when only width and aspect ratio are known.
 */
export function figureHeight(widthPt: number, aspectRatio: number): number {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new Error(`Invalid aspect ratio: ${aspectRatio}`);
  }
  return widthPt / aspectRatio;
}

/**
 * Bounding box helper used to reserve layout space for a figure before
 * placing it. The figure will be drawn with `drawImage` or SVG path
 * operators; this returns the surrounding `RectOptions` if a background
 * fill is desired.
 */
export function figureBackground(b: FigureBlock, fill: { r: number; g: number; b: number }): RectOptions {
  const h = b.heightPt ?? 0;
  return {
    x: b.x,
    y: b.y - h,
    width: b.widthPt,
    height: h,
    fill,
    stroke: undefined,
  };
}
