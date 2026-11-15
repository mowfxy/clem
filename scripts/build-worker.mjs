// Builds Clem's VPS worker (worker/index.ts: the engine, headless) into one folder the desktop uploads over SFTP:
// index.cjs, migrations, PGlite's files (the no-Docker path), the Dockerfile, compose file and systemd unit.
// `node scripts/build-worker.mjs [outDir]` (default worker-dist); build-desktop.mjs puts a copy in desktop-dist/worker.
import { build } from "esbuild";
import { copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function buildWorker(out = "worker-dist") {
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await build({
    entryPoints: ["worker/index.ts"], outfile: join(out, "index.cjs"), bundle: true, platform: "node", format: "cjs", target: "node22",
    external: ["pg-native", "cpu-features", "*.node", "electron", "esbuild"],
    banner: { js: 'const __importMetaUrl = require("url").pathToFileURL(__filename).href;' },
    define: { "import.meta.url": "__importMetaUrl" },
    logLevel: "warning",
  });
  for (const f of ["pglite.wasm", "pglite.data", "initdb.wasm"]) await copyFile("node_modules/@electric-sql/pglite/dist/" + f, join(out, f));
  // Files are made on the worker as the window makes them (docs/GUC-VPS-ENGINE.md "Files on the VPS"): Kinetra's
  // worker thread, KaTeX's print styles and the headless page's script (PDF pages and Telegram's figure photos).
  await build({ entryPoints: ["desktop/kinetra-worker.ts"], outfile: join(out, "kinetra-worker.cjs"), bundle: true, platform: "node", format: "cjs", target: "node22", logLevel: "warning" });
  await build({ entryPoints: ["worker/page-tasks.ts"], outfile: join(out, "page-tasks.js"), bundle: true, platform: "browser", format: "esm", target: "chrome120", minify: true, loader: { ".css": "empty" }, logLevel: "warning" });
  await mkdir(join(out, "katex", "fonts"), { recursive: true });
  await copyFile("node_modules/katex/dist/katex.min.css", join(out, "katex", "katex.min.css"));
  await cp("node_modules/katex/dist/fonts", join(out, "katex", "fonts"), { recursive: true, filter: (source) => !/\.(woff|ttf)$/.test(source) });
  await cp("desktop/engine/migrations", join(out, "migrations"), { recursive: true });
  for (const f of ["Dockerfile", "docker-compose.yml", "clem-worker.service", ".dockerignore"]) await copyFile(join("worker", f), join(out, f));
  await writeFile(join(out, "package.json"), JSON.stringify({ name: "clem-worker", private: true, main: "index.cjs" }));
  return out;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || "")).href) console.log("Built", await buildWorker(process.argv[2]));
