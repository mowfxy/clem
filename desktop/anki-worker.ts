import { parentPort, workerData } from "node:worker_threads";
import { readApkg } from "./anki.ts";

// Reads one Anki deck off the main thread (desktop/anki.ts), so a large deck never holds up Clem.
try {
  const result = readApkg(workerData.bytes as Uint8Array, String(workerData.name || "Anki deck"));
  parentPort!.postMessage({ result }, result.media.map((m) => m.data.buffer as ArrayBuffer));
} catch (error) {
  parentPort!.postMessage({ error: (error as { code?: string }).code === "anki" ? (error as Error).message : "This deck couldn't be read. It may be damaged." });
}
