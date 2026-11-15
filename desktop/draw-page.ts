// The hidden page Clem draws files in (docs/GUC-VPS-ENGINE.md "Files on the VPS"): PDFs are printed from it, figures,
// equations and slides are photographed in it. On the PC it is an Electron window (desktop/electron-page.ts); on the
// VPS worker, a headless Chromium driven over its DevTools pipe (desktop/chromium-page.ts). The document makers
// (illustrated-pdf, rasterize, deck-review, text-block) only see this interface, so the same code makes the same files
// on both. No electron import here.

export type PageKind = {
  width?: number;
  height?: number;
  /** A transparent page (captures keep their alpha). */
  transparent?: boolean;
  /** Scripts allowed (only for measuring Clem's own markup). */
  script?: boolean;
  /** Drawn without a screen (Electron's offscreen rendering); Chromium is always headless. */
  offscreen?: boolean;
};
export type Rect = { x: number; y: number; width: number; height: number };
export type PrintOptions = { background?: boolean; tagged?: boolean; outline?: boolean; /** No page margins (the page's own @page rules otherwise). */ noMargins?: boolean };

export interface DrawPage {
  /** The page's viewport in CSS pixels. */
  size(width: number, height: number): Promise<void>;
  /** Loads an HTML file and waits until it is laid out. */
  load(file: string): Promise<void>;
  png(rect: Rect): Promise<Uint8Array>;
  jpeg(rect: Rect, quality: number): Promise<Uint8Array>;
  pdf(o: PrintOptions): Promise<Uint8Array>;
  /** Evaluates an expression in a script page and returns its (JSON) value. */
  run<T>(expression: string): Promise<T>;
  close(): void;
}
export type PageOpener = (kind: PageKind) => Promise<DrawPage>;

let opener: PageOpener | undefined;
/** Main sets Electron's; the VPS worker sets headless Chromium's. */
export function setPageOpener(open: PageOpener | undefined) { opener = open; }
export const hasPageOpener = () => !!opener;
export async function openPage(kind: PageKind = {}): Promise<DrawPage> {
  if (!opener) throw new NoPages("Clem can't draw pages here: no browser engine is available.");
  return opener(kind);
}
/** Drawing isn't possible on this machine (no Chromium could start): said in one plain sentence. */
export class NoPages extends Error {}
