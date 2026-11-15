// The window's PDF page work and Telegram's figure photos, on the VPS worker (docs/GUC-VPS-ENGINE.md "Files on the
// VPS"): worker/page-tasks.ts (the same code as the window) runs in a headless Chromium page here; this side serves it
// its script and the files' bytes, and nothing else (the page has no network).
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DrawPage, PageKind } from "../../draw-page.ts";
import type { Served } from "../../chromium-page.ts";
import type { StoredFile } from "../../../core/types.ts";
import { figureBlocks } from "../../../core/telegram/render.ts";
import { readKinetraBlock } from "../../../core/kinetra-block.ts";

export type TaskResult = { data: any; images: { name: string; data: string }[]; files: Uint8Array[] };
export type TaskFile = StoredFile & { bytes: () => Promise<Uint8Array> };
type Open = (kind: PageKind & { serve?: Served }) => Promise<DrawPage>;
const ORIGIN = "https://clem.page";

let built: Promise<string> | undefined;
/** The page's script: page-tasks.js next to the worker bundle, else (running from source: tests) built once here. */
export function pageScript(dir?: string): Promise<string> {
  const here = dir || (typeof __dirname === "string" ? __dirname : "");
  if (here && existsSync(join(here, "page-tasks.js"))) return readFile(join(here, "page-tasks.js"), "utf8");
  return built ||= (async () => {
    const { build } = await import("esbuild");
    const out = join(await mkdtemp(join(tmpdir(), "clem-page-")), "page-tasks.js");
    await build({ entryPoints: [join(process.cwd(), "worker/page-tasks.ts")], outfile: out, bundle: true, platform: "browser", format: "esm", target: "chrome120", logLevel: "error", minify: true, loader: { ".css": "empty" } });
    return readFile(out, "utf8");
  })();
}

export class PageTasks {
  private open: Open;
  private script: () => Promise<string>;
  private kinetra?: (request: unknown) => Promise<unknown>;
  constructor(o: { open: Open; script?: () => Promise<string>; kinetra?: (request: unknown) => Promise<unknown> }) { this.open = o.open; this.script = o.script || (() => pageScript()); this.kinetra = o.kinetra; }

  private async page(files: TaskFile[], bytes?: Uint8Array) {
    const script = await this.script();
    const byId = new Map(files.map((f) => [f.id, f]));
    const cache = new Map<string, Uint8Array>();
    // Bytes are read before the page asks (the serve hook answers synchronously).
    for (const f of files) cache.set(f.id, await f.bytes().catch(() => new Uint8Array()));
    const serve: Served = (url) => {
      if (!url.startsWith(ORIGIN + "/")) return undefined;
      const path = decodeURIComponent(url.slice(ORIGIN.length).split("?")[0]);
      if (path === "/" || path === "/index.html") return { body: `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module" src="/page-tasks.js"></script></body></html>`, type: "text/html" };
      if (path === "/page-tasks.js") return { body: script, type: "text/javascript" };
      if (path === "/bytes" && bytes) return { body: bytes, type: "application/octet-stream" };
      if (path.startsWith("/file/") && byId.has(path.slice(6))) return { body: cache.get(path.slice(6))!, type: byId.get(path.slice(6))!.type || "application/octet-stream" };
      return undefined;
    };
    const page = await this.open({ width: 1200, height: 900, script: true, serve });
    try {
      await page.load(ORIGIN + "/");
      for (let i = 0; i < 200 && !(await page.run<boolean>("!!globalThis.clemReady")); i++) await new Promise((r) => setTimeout(r, 50));
    } catch (e) { page.close(); throw e; }
    return page;
  }

  /** One of the window's PDF tasks (src/desktop/pdf-task-ops.ts) on these files; `args.bytes` (a document being made
   *  or edited) is served to the page. */
  async run(op: string, files: TaskFile[], args: Record<string, unknown>): Promise<TaskResult> {
    const bytes = args.bytes instanceof Uint8Array ? args.bytes : undefined;
    const page = await this.page(files, bytes);
    try {
      const metas = files.map(({ bytes: _b, ...f }) => f);
      const r = await page.run<{ data: any; images: { name: string; data: string }[]; files: string[] }>(`clemTask(${JSON.stringify(op)}, ${JSON.stringify(metas)}, ${JSON.stringify({ ...args, ...(bytes ? { bytes: "served" } : {}) })})`);
      return { data: r.data, images: r.images, files: r.files.map((b) => new Uint8Array(Buffer.from(b, "base64"))) };
    } finally { page.close(); }
  }

  /** An answer's visuals and textbook figures as PNGs, as the window draws them for Telegram (src/telegram/figure-draw.ts). */
  async figures(content: string): Promise<{ name: string; bytes: Uint8Array }[]> {
    const blocks = figureBlocks(content);
    if (!blocks.length) return [];
    // A ```kinetra figure's drawing comes from Kinetra here; the page puts it on paper.
    const svgs: string[] = [];
    for (const b of blocks.slice(0, 6)) {
      const k = b.lang === "kinetra" ? readKinetraBlock(b.body) : null;
      svgs.push(k && this.kinetra ? String(await this.kinetra({ action: "call", module: k.module, fn: k.fn, args: k.args }).catch(() => "")) : "");
    }
    const page = await this.page([]);
    try {
      const photos = await page.run<{ name: string; data: string }[]>(`clemFigures(${JSON.stringify(content)}, ${JSON.stringify(svgs)})`);
      return photos.map((p) => ({ name: p.name, bytes: new Uint8Array(Buffer.from(p.data, "base64")) }));
    } finally { page.close(); }
  }
}
