/// <reference path="../desktop/engine/pdfjs-worker.d.ts" />
// The VPS worker's headless page (docs/GUC-VPS-ENGINE.md "Files on the VPS"): the window's own PDF page work
// (src/desktop/pdf-task-ops.ts: look, regions, crop, words, render, raster) and Telegram's figure photos
// (src/telegram/figure-draw.ts), run in headless Chromium on the server. Bundled for the browser by
// scripts/build-worker.mjs (page-tasks.js); the worker serves it and the files' bytes to the page
// (desktop/engine/vps/page-tasks.ts). The page has no network: every request goes to the worker.
import * as pdfjsLib from "pdfjs-dist";
import * as pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs";
import type { StoredFile } from "../core/types";
import { pdfTask, usePdfTaskDeps } from "../src/desktop/pdf-task-ops";
import { drawFigures } from "../src/telegram/figure-draw";

// pdf.js runs its worker in this page's thread (no worker file to load).
(globalThis as any).pdfjsWorker = pdfWorker;
usePdfTaskDeps({ blob: async (id) => { const r = await fetch("/file/" + encodeURIComponent(id)); return r.ok ? r.blob() : undefined; }, pdfjs: async () => pdfjsLib });

const base64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

(globalThis as any).clemTask = async (op: string, files: StoredFile[], args: any) => {
  if (args?.bytes === "served") args = { ...args, bytes: new Uint8Array(await (await fetch("/bytes")).arrayBuffer()) };
  const r = await pdfTask(files, op, args);
  return { data: r.data ?? null, images: r.images || [], files: (r.files || []).map(base64) };
};
(globalThis as any).clemFigures = async (content: string, svgs: string[]) => drawFigures(content, async (_block, n) => { if (!svgs[n - 1]) throw Error("No figure."); return svgs[n - 1]; });
(globalThis as any).clemReady = true;
