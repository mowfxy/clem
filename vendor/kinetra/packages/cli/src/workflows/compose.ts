import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { compose } from "../../../core/src/toolkit/index.js";
import type { ComposeModel } from "../../../core/src/toolkit/index.js";

const HELP = `kinetra compose <model.json> <out.svg>
Composes a diagram from a toolkit model (docs/toolkit/engine.md). On success it
writes the SVG and <out>.report.json and prints both paths. On failure it writes
nothing, prints {"ok": false, "errors": [...]} as JSON and exits with code 1.`;

/** Render a toolkit composition; JSON inputs cannot execute code. */
export function runCompose(input?: string, output?: string): void {
  if (!input || input === "--help" || input === "-h" || !output) {
    console.log(HELP);
    if (!input || input === "--help" || input === "-h") return;
    process.exitCode = 2;
    return;
  }
  let model: ComposeModel;
  try {
    model = JSON.parse(readFileSync(resolve(input), "utf8"));
  } catch (e) {
    console.log(JSON.stringify({ ok: false, errors: [{ code: "E_SCHEMA", elements: [], message: `Cannot read ${input} as JSON: ${(e as Error).message}`, suggestion: "Check the path and the JSON syntax." }] }, null, 2));
    process.exitCode = 1;
    return;
  }
  const result = compose(model);
  if (!result.ok) {
    console.log(JSON.stringify({ ok: false, errors: result.errors, stage: result.report.stage }, null, 2));
    process.exitCode = 1;
    return;
  }
  const target = resolve(output);
  const reportPath = target.replace(/\.svg$/i, "") + ".report.json";
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, result.svg, "utf8");
  writeFileSync(reportPath, JSON.stringify(result.report, null, 2) + "\n", "utf8");
  console.log(target);
  console.log(reportPath);
}
