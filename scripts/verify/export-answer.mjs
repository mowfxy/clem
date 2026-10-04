// Bundles scripts/verify/export-answer.ts for Electron and runs it: node scripts/verify/export-answer.mjs <out dir> [answer.md]
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const out = resolve(args.find((a) => !a.endsWith(".md")) || ".verify-export");
const bundle = join(out, ".bundle");
await mkdir(bundle, { recursive: true });
await build({ entryPoints: ["scripts/verify/export-answer.ts"], outfile: join(bundle, "run.cjs"), bundle: true, platform: "node", format: "cjs", external: ["electron"], logLevel: "warning" });
await build({ entryPoints: ["desktop/kinetra-worker.ts"], outfile: join(bundle, "kinetra-worker.cjs"), bundle: true, platform: "node", format: "cjs", logLevel: "warning" });
const electron = createRequire(import.meta.url)("electron");
const md = args.find((a) => a.endsWith(".md"));
process.exit(spawnSync(electron, [join(bundle, "run.cjs"), out, ...(md ? [resolve(md)] : [])], { stdio: "inherit" }).status ?? 1);
