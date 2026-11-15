import { getBlob } from "../store";
import { pdfjs } from "./page-images";
import { usePdfTaskDeps } from "./pdf-task-ops";

/**
 * The window's half of "regions" and "crop" (desktop/main.ts asks, this answers): the work itself is in
 * src/desktop/pdf-task-ops.ts, which the VPS worker's headless page runs too (worker/page-tasks.ts).
 */
usePdfTaskDeps({ blob: getBlob, pdfjs, heic: () => import("./heic") });
export { pdfTask, type TaskResult } from "./pdf-task-ops";
