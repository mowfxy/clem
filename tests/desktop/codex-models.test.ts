import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Codex } from "../../desktop/codex.ts";
function fake() {
  const p: any = new EventEmitter();
  p.stdout = new PassThrough();
  p.stderr = new PassThrough();
  p.stdin = new PassThrough();
  p.kill = () => {
    p.emit("close", 0);
    return true;
  };
  return p;
}
test("Codex catalog initializes, paginates, filters hidden models and caches", async () => {
  const codex: any = new Codex("fixture", "fixture", "fixture");
  codex.status = async () => true;
  let starts = 0;
  codex.start = async () => {
    starts++;
    const p = fake();
    p.stdin.on("data", (data: Buffer) => {
      const req = JSON.parse(data.toString());
      if (!req.id) return;
      const result =
        req.method === "initialize"
          ? {}
          : {
              data: [
                {
                  model: req.params.cursor ? "model-b" : "model-a",
                  displayName: "Available",
                  supportedReasoningEfforts: [
                    { reasoningEffort: "medium", description: "Balanced" },
                  ],
                  defaultReasoningEffort: "medium",
                },
                { model: "hidden", hidden: true },
              ],
              nextCursor: req.params.cursor ? null : "next",
            };
      queueMicrotask(() =>
        p.stdout.write(JSON.stringify({ id: req.id, result }) + "\n"),
      );
    });
    return p;
  };
  const models = await codex.models();
  assert.deepEqual(
    models.map((m: any) => m.id),
    ["model-a", "model-b"],
  );
  assert.equal(models[0].reasoningEfforts[0].reasoningEffort, "medium");
  await codex.models();
  assert.equal(starts, 1);
});
test("Codex execution passes selected model and effort and rejects unsupported effort", async () => {
  const codex: any = new Codex("fixture", "fixture", "fixture");
  codex.status = async () => true;
  codex.models = async () => [
    { id: "model-a", reasoningEfforts: [{ reasoningEffort: "high" }] },
  ];
  let args: string[] = [];
  codex.start = async (a: string[]) => {
    args = a;
    const p = fake();
    p.stdin.on("finish", () => {
      p.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\n");
      setTimeout(() => p.emit("close", 0), 5);
    });
    return p;
  };
  await codex.run("id", "prompt", () => {}, [], {
    model: "model-a",
    reasoning: "high",
  });
  assert.equal(args[args.indexOf("--model") + 1], "model-a");
  assert.ok(args.includes('model_reasoning_effort="high"'));
  await assert.rejects(
    () =>
      codex.run("id", "prompt", () => {}, [], {
        model: "model-a",
        reasoning: "ultra",
      }),
    /unavailable/,
  );
});
