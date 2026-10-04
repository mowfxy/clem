/**
 * Makes PDFs, Word documents and decks that reuse crops, in Electron (PDFs are printed by Chromium), from the crops a
 * test cut and saved in <dir> (crop-…-meta, -png, -pdf) and the jobs it wrote (jobs.json: [action, file name, spec]).
 * Run with: node scripts/verify/pdf-crops.mjs <dir>
 */
import { app } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeFile } from "../../desktop/file-maker.ts";
import { readAsset, type AssetIo } from "../../desktop/pdf-assets.ts";

const dir = process.argv.at(-1)!;
const io: AssetIo = {
  read: async (k) => { try { return new Uint8Array(await readFile(join(dir, k))); } catch { return null; } },
  write: async () => {},
  remove: async () => {},
};

app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const jobs: [string, string, any][] = JSON.parse(await readFile(join(dir, "jobs.json"), "utf8"));
  for (const [action, name, spec] of jobs) {
    try {
      // Edits read their files from the folder by name (the window does it in the app).
      const edit = { load: async (ref: string) => ({ bytes: (await io.read(ref))!, source: "src-00000000-0000-0000-0000-000000000000", name: ref }), words: async () => [], crop: (id: string) => readAsset(io, id) };
      const made = await makeFile(action, spec, { assets: (id) => readAsset(io, id), edit });
      await writeFile(join(dir, name), made.bytes);
      console.log("ok", name, made.bytes.length, JSON.stringify({ name: made.name, info: made.info, spec: made.spec }));
    } catch (error) {
      console.log("FAIL", name, (error as Error).message);
    }
  }
  app.quit();
});
