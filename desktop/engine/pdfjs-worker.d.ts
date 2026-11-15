// pdfjs's worker, run in the main thread for guc.read (desktop/engine/file-text.ts); its types are not published.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
// The same worker, bundled into the VPS worker's headless page (worker/page-tasks.ts).
declare module "pdfjs-dist/build/pdf.worker.min.mjs" {
  export const WorkerMessageHandler: unknown;
}
