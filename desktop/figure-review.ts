import { createHash } from "node:crypto";

/**
 * Pictures of the figures in a file Mowr just made, for the model to look at before it answers, the way a deck's
 * contact sheets are: a figure copied from a problem sheet or a lecture can come out with a wire on the wrong node,
 * a swapped label or a wrong value, and only looking at it shows that. Each figure is drawn small (it only has to be
 * legible) and only figures the model has not seen in this answer are sent, so appending to a long document does
 * not resend the same drawings. The caps keep every request inside the providers' picture limits.
 */

/** Figure pictures per file result (a deck's contact sheets count towards it). The turn loop sends at most 12 a message. */
export const FIGURES_PER_RESULT = 6;
/** Longest side of a figure picture in pixels: labels stay readable, and dozens fit in any provider's request size. */
export const FIGURE_PIXELS = 900;
/** A picture larger than this is left out rather than sent (providers refuse images over a few megabytes). */
export const FIGURE_BYTES = 1_500_000;

export type DrawnFigure = { svg: string; where: string; figure?: { module?: string; fn?: string } };
export type FigurePicture = { name: string; image: Uint8Array };
type Raster = { svg: (svg: string, options: { maxWidth?: number; maxHeight?: number; background?: string; pixelRatio?: number }) => Promise<{ png: Uint8Array }> };

const key = (svg: string) => createHash("sha256").update(svg).digest("hex");

/** The figures of a document specification (pdf, docx) as drawn, in order, named the way the document numbers them. */
export function documentFigures(spec: any, svgs: (string | undefined)[]): DrawnFigure[] {
  const out: DrawnFigure[] = [];
  let heading = "";
  (spec?.sections || []).forEach((s: any, i: number) => {
    if (typeof s?.heading === "string" && s.heading.trim()) heading = s.heading.trim();
    const svg = svgs[i];
    if (typeof svg !== "string" || typeof s?.figure?.asset === "string") return;
    out.push({ svg, where: `Figure ${out.length + 1}${heading ? ` (in “${heading.slice(0, 60)}”)` : ""}`, figure: s.figure });
  });
  return out;
}

/** The figures not yet seen in this answer, the first `limit` of them; `seen` is updated with the ones chosen. */
export function newFigures(figures: DrawnFigure[], seen: Set<string>, limit = FIGURES_PER_RESULT) {
  const fresh: DrawnFigure[] = [], picked = new Set<string>();
  let unseen = 0;
  for (const f of figures) {
    const k = key(f.svg);
    if (seen.has(k) || picked.has(k)) continue;
    unseen++;
    if (fresh.length < limit) { fresh.push(f); picked.add(k); }
  }
  return { fresh, more: unseen - fresh.length, keys: picked };
}

/** Draws the chosen figures small, on white. A figure that cannot be drawn or is too large is skipped, never fatal. */
export async function figurePictures(figures: DrawnFigure[], seen: Set<string>, raster: Raster, limit = FIGURES_PER_RESULT) {
  const { fresh, more, keys } = newFigures(figures, seen, limit);
  const pictures: FigurePicture[] = [];
  for (const f of fresh) {
    try {
      const shot = await raster.svg(f.svg, { maxWidth: FIGURE_PIXELS, maxHeight: FIGURE_PIXELS, background: "#ffffff", pixelRatio: 1 });
      if (shot.png.byteLength > FIGURE_BYTES) continue;
      const source = f.figure?.module && f.figure?.fn ? ` — ${f.figure.module}.${f.figure.fn}` : "";
      pictures.push({ name: `${f.where}${source}`, image: shot.png });
    } catch {
      // A picture is a check, not part of the file: the file is already made.
    }
  }
  for (const k of keys) seen.add(k);
  return { pictures, more };
}

/** What the model is asked to do with the figure pictures (sent with the result that carries them). */
export function figureCheck(names: string[], more: number) {
  if (!names.length) return undefined;
  return `Pictures of the figures just drawn are attached (${names.join("; ")}). Look at each one and compare it with the source it was copied from: the problem, the person's picture or page, the netlist or data you computed with. If any connection or topology, label, value, unit or direction differs, or anything is missing or extra, correct that figure's spec and send the file again with "revise" before answering; if they all match, say nothing about this check.${more ? ` ${more} more new figure${more === 1 ? " was" : "s were"} not attached (at most ${FIGURES_PER_RESULT} per file result); they are attached the next time this file is revised.` : ""}`;
}
