// Bundles scripts/verify/pdf-crops.ts for Electron and runs it: node scripts/verify/pdf-crops.mjs <dir>
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const out = resolve(process.argv[2] || ".verify-crops");
const bundle = join(out, ".bundle");
await mkdir(bundle, { recursive: true });
await build({ entryPoints: ["scripts/verify/pdf-crops.ts"], outfile: join(bundle, "run.cjs"), bundle: true, platform: "node", format: "cjs", external: ["electron"], logLevel: "warning" });
await build({ entryPoints: ["desktop/kinetra-worker.ts"], outfile: join(bundle, "kinetra-worker.cjs"), bundle: true, platform: "node", format: "cjs", logLevel: "warning" });
const electron = createRequire(import.meta.url)("electron");
const result = spawnSync(electron, [join(bundle, "run.cjs"), out], { stdio: "inherit" });
process.exit(result.status ?? 1);
