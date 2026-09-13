/**
 * Provider layer tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mockAdapter, defaultRouter, ProviderRouter } from "../../src/providers/mock.js";
import { buildContext, extractJson, ProviderError } from "../../src/providers/types.js";

test("mockAdapter: generates a deterministic answer", async () => {
  const r = await mockAdapter.generate({
    model: "mock-1",
    messages: [{ role: "user", content: "please simplify the boolean expression" }],
  });
  assert.equal(r.model, "mock-1");
  assert.ok(r.text.length > 0);
  assert.equal(r.finishReason, "stop");
});

test("mockAdapter: embed returns normalised Float32Array per input", async () => {
  if (!mockAdapter.embed) throw new Error("embed missing");
  const a = await mockAdapter.embed(["hello", "world"]);
  assert.equal(a.length, 2);
  for (const v of a) {
    assert.equal(v.length, 32);
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
    assert.ok(Math.abs(sum - 1) < 1e-4);
  }
});

test("defaultRouter: returns the mock adapter", () => {
  const r = defaultRouter();
  assert.equal(r.activeKind(), "mock");
});

test("ProviderRouter: setPreferred / overrideActive / kinds", () => {
  const r = new ProviderRouter({ preferred: "mock" });
  assert.deepEqual(r.kinds(), ["mock"]);
  r.register({
    kind: "openai-compatible",
    capabilities: { text: true, vision: false, toolCalling: false, structuredOutput: false, contextTokens: 4096, supportsJson: false },
    generate: async () => ({ text: "", model: "x" }),
  });
  r.setPreferred("openai-compatible");
  assert.equal(r.activeKind(), "openai-compatible");
  r.overrideActive("mock");
  assert.equal(r.activeKind(), "mock");
  r.overrideActive(null);
  assert.equal(r.activeKind(), "openai-compatible");
});

test("buildContext: lists citations inline", () => {
  const out = buildContext(
    [{ sourceId: "abc", title: "Lecture 1", page: 3 }, { sourceId: "def" }],
    "the body",
  );
  assert.ok(out.includes("[1] Lecture 1 (p. 3)"));
  assert.ok(out.includes("[2] def"));
  assert.ok(out.includes("the body"));
});

test("buildContext: returns excerpt unchanged when no sources", () => {
  assert.equal(buildContext([], "body"), "body");
});

test("extractJson: pulls object out of prose", () => {
  const v = extractJson('Some prose {"a": 3} more prose');
  assert.deepEqual(v, { a: 3 });
});

test("extractJson: handles fenced JSON", () => {
  const v = extractJson('```json\n{"a": 5}\n```');
  assert.deepEqual(v, { a: 5 });
});

test("extractJson: handles nested objects and strings with braces", () => {
  const v = extractJson('noise {"x": "abc {def} ghi"} trailing');
  assert.deepEqual(v, { x: "abc {def} ghi" });
});

test("extractJson: handles arrays", () => {
  const v = extractJson("[1, 2, 3]");
  assert.deepEqual(v, [1, 2, 3]);
});

test("extractJson: throws ProviderError when no JSON present", () => {
  assert.throws(() => extractJson("plain text only"), (e) => e instanceof ProviderError);
});
