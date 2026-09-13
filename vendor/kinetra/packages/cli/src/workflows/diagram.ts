import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defaultElectrostaticRods, renderElectrostaticRods } from "../../../core/src/diagram/electrostatics.js";
import type { ElectrostaticRodsModel } from "../../../core/src/diagram/electrostatics.js";

/** Render a validated model; JSON inputs cannot execute code. */
export function runDiagram(input?: string, output?: string): void {
  if (input === "--help" || input === "-h") {
    console.log("kinetra diagram [charged-rods.json] [output.svg]\nWithout input, renders the built-in charged-rod apparatus to out/diagrams/charged-rods.svg.");
    return;
  }
  const model: ElectrostaticRodsModel = input ? JSON.parse(readFileSync(resolve(input), "utf8")) : defaultElectrostaticRods();
  const svg = renderElectrostaticRods(model);
  const target = resolve(output ?? "out/diagrams/charged-rods.svg");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, svg, "utf8");
  console.log(target);
}
