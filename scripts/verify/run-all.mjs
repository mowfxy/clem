// Runs every browser check in this folder, one after another, and reports each result.
// installer-download is skipped by default: it downloads the live installer from mowrai.com.
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const skip = new Set(["run-all.mjs", "fixture-docs.mjs", "fixture-local-storage.mjs", "local-power-fixture.mjs", ...(process.argv.includes("--live") ? [] : ["installer-download.mjs"])]);
const checks = (await readdir(here)).filter((f) => f.endsWith(".mjs") && !skip.has(f)).sort();
const failed = [];
for (const check of checks) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [join(here, check)], { encoding: "utf8", timeout: 240_000 });
  const ok = run.status === 0;
  if (!ok) failed.push(check);
  console.log(`${ok ? "PASS" : "FAIL"} ${check} (${Math.round((Date.now() - started) / 1000)}s)`);
  if (!ok) console.log((run.stderr || run.stdout || "").split("\n").filter((l) => !/^\s+at /.test(l)).slice(-8).join("\n"));
}
console.log(failed.length ? `${failed.length} of ${checks.length} checks failed.` : `All ${checks.length} browser checks passed.`);
process.exit(failed.length ? 1 : 0);
