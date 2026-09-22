import { test, before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runKinetraTurn, toolRequest } from "../../desktop/kinetra-turn.ts";
import { kinetraTool, kinetraCall } from "../../desktop/kinetra-runtime.ts";
before(async () => {
  await build({
    entryPoints: ["desktop/kinetra-worker.ts"],
    outfile: "desktop-dist/kinetra-worker.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
  });
});
test("only exact tool envelopes are dispatched; application JSON stays final", () => {
  assert.equal(toolRequest('An example: {"kinetra":{}}'), null);
  assert.equal(toolRequest('{"title":"Quiz","items":[]}'), null);
  assert.deepEqual(toolRequest('{"kinetra":{"action":"skill"}}'), {
    action: "skill",
  });
});
test("tool loop supplies results and preserves final output", async () => {
  let count = 0;
  const result = await runKinetraTurn(
    "integrate",
    "tools",
    async (input) => {
      if (count++ === 0) return '{"kinetra":{"action":"call"}}';
      assert.match(input, /0.333/);
      return "The result is 1/3.";
    },
    async () => 1 / 3,
    () => false,
  );
  assert.equal(result, "The result is 1/3.");
  assert.equal(count, 2);
});
test("errors are data; loops are bounded and cancellation prevents another call", async () => {
  let count = 0;
  await assert.rejects(
    () =>
      runKinetraTurn(
        "",
        "",
        async () => '{"kinetra":{"action":"bad"}}',
        async () => {
          count++;
          throw Error("bad");
        },
        () => false,
      ),
    /tool limit/,
  );
  assert.equal(count, 12);
  let cancelled = false;
  await assert.rejects(
    () =>
      runKinetraTurn(
        "",
        "",
        async () => '{"kinetra":{"action":"call"}}',
        async () => {
          cancelled = true;
          return 2;
        },
        () => cancelled,
      ),
    /cancelled/,
  );
});
test("all six complete skill guides are available on demand", async () => {
  for (const name of [
    "kinetra-diagrams",
    "kinetra-circuits",
    "kinetra-kmap",
    "kinetra-assess",
    "kinetra-retrieval",
    "kinetra-study-plan",
  ]) {
    const guide = await kinetraTool({ action: "skill", name });
    assert.ok(guide.startsWith("---"));
    assert.ok(guide.length > 1500);
  }
  await assert.rejects(
    () => kinetraTool({ action: "api", module: "__proto__" }),
    /Unsupported/,
  );
});
test("real worker calculates projectile, integrates expressions and retrieves sources", async () => {
  const model = {
    initialPosition: { x: 0, y: 0 },
    initialSpeed: 15,
    launchAngleDeg: 45,
    gravity: 9.81,
    width: 640,
    height: 400,
  };
  const result = await kinetraCall({
    module: "diagram/projectile",
    fn: "projectileAnalytics",
    args: [model],
  });
  assert.ok(Math.abs(result.range.distance - 225 / 9.81) < 1e-8);
  assert.ok(
    Math.abs(
      (await kinetraCall({
        module: "mowr",
        fn: "integrateExpression",
        args: ["x^2", "x", 0, 1],
      })) -
        1 / 3,
    ) < 1e-8,
  );
  const hits = await kinetraCall({
    module: "mowr",
    fn: "retrieve",
    args: [
      [
        {
          title: "Physics",
          text: "Electrostatic forces act between charged objects. Opposite charges attract.",
        },
      ],
      "opposite charges",
    ],
  });
  assert.match(hits[0].text, /Opposite charges/);
  assert.ok(hits[0].sourceId);
});
test("worker renders textbook SVG and expression-based fields, rejects arbitrary code", async () => {
  const model = await kinetraCall({
    module: "diagram/electrostatics",
    fn: "defaultElectrostaticRods",
    args: [],
  });
  const svg = await kinetraCall({
    module: "diagram/electrostatics",
    fn: "renderElectrostaticRods",
    args: [model],
  });
  assert.match(svg, /<svg/);
  assert.match(svg, /Rubber/);
  const field = await kinetraCall({
    module: "mowr",
    fn: "vectorField",
    args: [
      {
        type: "vector",
        world: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
        width: 400,
        height: 400,
        rows: 8,
        cols: 8,
        xExpression: "-y",
        yExpression: "x",
      },
    ],
  });
  assert.match(field, /<svg/);
  await assert.rejects(
    () => kinetraCall({ module: "fs", fn: "readFile", args: ["secret"] }),
    /Unknown/,
  );
  await assert.rejects(() =>
    kinetraCall({
      module: "mowr",
      fn: "integrateExpression",
      args: ["process.exit()", "x", 0, 1],
    }),
  );
});
test("study and Boolean tools return useful structured data", async () => {
  const schedule = await kinetraCall({
    module: "mowr",
    fn: "studySchedule",
    args: [["Circuits"], "2026-09-23", [1, 3]],
  });
  assert.deepEqual(schedule[0].reviews, ["2026-09-24", "2026-09-26"]);
  const table = await kinetraCall({
    module: "dld/truth_table",
    fn: "buildTruthTable",
    args: [["A"], { type: "not", arg: { type: "var", name: "A" } }],
  });
  assert.deepEqual(
    table.rows.map((r: any) => r.output),
    [1, 0],
  );
  const kmap = await kinetraCall({
    module: "dld/kmap",
    fn: "buildKMap",
    args: [{ variables: ["A", "B"], minterms: [1, 3], form: "pos" }],
  });
  assert.ok(kmap);
});
