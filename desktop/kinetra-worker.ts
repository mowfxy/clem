import { parentPort, workerData } from "node:worker_threads";
import * as m0 from "../vendor/kinetra/packages/core/src/diagram/freebody";
import * as m1 from "../vendor/kinetra/packages/core/src/diagram/electrostatics";
import * as m2 from "../vendor/kinetra/packages/core/src/diagram/projectile";
import * as m3 from "../vendor/kinetra/packages/core/src/diagram/pulley";
import * as m4 from "../vendor/kinetra/packages/core/src/diagram/optics";
import * as m5 from "../vendor/kinetra/packages/core/src/diagram/circuit_schematic";
import * as m6 from "../vendor/kinetra/packages/core/src/diagram/logic_schematic";
import * as m7 from "../vendor/kinetra/packages/core/src/diagram/fields";
import * as m8 from "../vendor/kinetra/packages/core/src/graph/render_svg";
import * as m9 from "../vendor/kinetra/packages/core/src/circuit/circuit";
import * as m10 from "../vendor/kinetra/packages/core/src/circuit/spice";
import * as m11 from "../vendor/kinetra/packages/core/src/dld/kmap";
import * as m12 from "../vendor/kinetra/packages/core/src/dld/expression";
import * as m13 from "../vendor/kinetra/packages/core/src/dld/truth_table";
import * as m14 from "../vendor/kinetra/packages/core/src/dld/simplify";
import * as m15 from "../vendor/kinetra/packages/core/src/assessment/quiz";
import * as m16 from "../vendor/kinetra/packages/core/src/assessment/exam";
import * as m17 from "../vendor/kinetra/packages/core/src/assessment/grading";
import * as m18 from "../vendor/kinetra/packages/core/src/assessment/flashcards";
import * as m19 from "../vendor/kinetra/packages/core/src/assessment/mastery_rules";
import * as m20 from "../vendor/kinetra/packages/core/src/retrieval/hybrid";
import * as m21 from "../vendor/kinetra/packages/core/src/ingest/chunk";
import * as m22 from "../vendor/kinetra/packages/core/src/math/algebra";
import * as m23 from "../vendor/kinetra/packages/core/src/math/calculus";
import * as m24 from "../vendor/kinetra/packages/core/src/math/linear";

import * as adapters from "./kinetra-adapters";
import * as expression from "../vendor/kinetra/packages/core/src/math/expression";
import * as symbolic from "../vendor/kinetra/packages/core/src/math/symbolic";
import * as numeric from "../vendor/kinetra/packages/core/src/math/eval";
const modules: Record<string, any> = {
  mowr: adapters,
  "math/expression": expression,
  "math/symbolic": symbolic,
  "math/eval": numeric,
  "diagram/freebody": m0,
  "diagram/electrostatics": m1,
  "diagram/projectile": m2,
  "diagram/pulley": m3,
  "diagram/optics": m4,
  "diagram/circuit_schematic": m5,
  "diagram/logic_schematic": m6,
  "diagram/fields": m7,
  "graph/render_svg": m8,
  "circuit/circuit": m9,
  "circuit/spice": m10,
  "dld/kmap": m11,
  "dld/expression": m12,
  "dld/truth_table": m13,
  "dld/simplify": m14,
  "assessment/quiz": m15,
  "assessment/exam": m16,
  "assessment/grading": m17,
  "assessment/flashcards": m18,
  "assessment/mastery_rules": m19,
  "retrieval/hybrid": m20,
  "ingest/chunk": m21,
  "math/algebra": m22,
  "math/calculus": m23,
  "math/linear": m24,
};
try {
  const { module: moduleName, fn, args } = workerData;
  if (
    !Object.hasOwn(modules, moduleName) ||
    !Object.hasOwn(modules[moduleName], fn) ||
    typeof modules[moduleName][fn] !== "function" ||
    !Array.isArray(args)
  )
    throw Error("Unknown Kinetra operation");
  if (moduleName === "assessment/flashcards") {
    const index =
      fn === "dueCards" ? 1 : ["review", "applyReviews"].includes(fn) ? 2 : -1;
    if (index >= 0 && args[index] !== undefined) {
      args[index] = new Date(args[index]);
      if (!Number.isFinite(args[index].getTime()))
        throw Error("Invalid review date");
    }
  }
  const result = modules[moduleName][fn](...args);
  const json = JSON.stringify(result, (_, v) =>
    typeof v === "bigint"
      ? v.toString()
      : v instanceof Map
        ? Object.fromEntries(v)
        : v instanceof Set
          ? [...v]
          : v,
  );
  if (json && json.length > 2000000) throw Error("Kinetra result is too large");
  parentPort!.postMessage({ result: json ? JSON.parse(json) : null });
} catch (e) {
  parentPort!.postMessage({ error: (e as Error).message });
}
