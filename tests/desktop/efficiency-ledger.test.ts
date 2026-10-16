import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeArgs, SIDE_JOB_SYSTEM } from "../../desktop/claude.ts";
import { GrokProvider } from "../../desktop/grok.ts";
import { codexTokens } from "../../desktop/codex-stream.ts";
import { addTokens, turnTimer, type AnswerEntry, type TurnStats } from "../../desktop/turn-timing.ts";
import { answerLedger, readLedger, summarizeLedger, LEDGER_FILE, LEDGER_MAX_BYTES } from "../../desktop/answer-ledger.ts";
import { memoryPrint, sourcePrint } from "../../desktop/chat-sessions.ts";
import { composePrompt } from "../../desktop/prompt.ts";

test("a Claude side job runs with no tools, one turn and Mowr's few-line prompt instead of Claude Code's own", () => {
  const args = claudeArgs("haiku", undefined, undefined, undefined, true);
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", ""]);
  assert.equal(args[args.indexOf("--max-turns") + 1], "1");
  assert.ok(!args.includes("WebSearch") && args.includes("--no-session-persistence") && args.includes("--strict-mcp-config"));
  // An answer keeps web search and its turns.
  const answer = claudeArgs("haiku", undefined, undefined);
  assert.equal(answer[answer.indexOf("--tools") + 1], "WebSearch");
  assert.ok(SIDE_JOB_SYSTEM.length < 400);
});

test("the tokens each CLI reports are tallied per answer", () => {
  const stats: TurnStats = { steps: 0, calls: 0, broken: 0 };
  addTokens(stats, { input: 10, cacheRead: 1000, cacheWrite: 200, output: 50 });
  addTokens(stats, { input: 5, cacheRead: -3, output: 7 });
  assert.deepEqual(stats.tokens, { input: 15, cacheRead: 1000, cacheWrite: 200, output: 57 });
  // Codex counts the cached and cache-written input inside its input total.
  assert.deepEqual(codexTokens({ threadId: "t", turnId: "u", tokenUsage: { last: { inputTokens: 900, cachedInputTokens: 600, cacheWriteInputTokens: 100, outputTokens: 40, reasoningOutputTokens: 10, totalTokens: 940 }, total: {} } }), { input: 200, cacheRead: 600, cacheWrite: 100, output: 40 });
  assert.equal(codexTokens({}), undefined);
});

test("Grok's own usage.json gives a session's tokens, its input counting the cached part", async () => {
  const home = mkdtempSync(join(tmpdir(), "mowr-grok-home-"));
  const id = "0123abcd-0000-4000-8000-000000000001";
  mkdirSync(join(home, "sessions", "C%3A%5Cwork", id), { recursive: true });
  writeFileSync(join(home, "sessions", "C%3A%5Cwork", id, "usage.json"), JSON.stringify({ session: { inputTokens: 33169, outputTokens: 413, cachedReadTokens: 18048, cacheCreationTokens: 0 } }));
  const grok = new GrokProvider(mkdtempSync(join(tmpdir(), "mowr-grok-")), "fixture", home);
  assert.deepEqual(await grok.sessionTokens(id), { input: 15121, cacheRead: 18048, cacheWrite: 0, output: 413 });
  assert.equal(await grok.sessionTokens("0123abcd-0000-4000-8000-000000000002"), undefined);
});

test("every answer is recorded in the ledger with counts only, and the ledger stays bounded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mowr-ledger-"));
  const ledger = answerLedger(dir);
  const recorded: AnswerEntry[] = [];
  const timer = turnTimer("claude", { model: "claude:sonnet", record: (e) => { recorded.push(e); void ledger.record(e); } });
  timer.stats.steps = 3; timer.stats.calls = 5; timer.stats.continued = true;
  addTokens(timer.stats, { input: 100, cacheRead: 9000, cacheWrite: 1000, output: 400 });
  timer.watch(() => {})({ type: "delta", text: "Hi" });
  timer.end();
  timer.end();
  await ledger.record({ at: 1, provider: "grok", outcome: "failed", totalMs: 50, steps: 1, calls: 0, broken: 1 });
  assert.equal(recorded.length, 1);
  assert.deepEqual(Object.keys(recorded[0]).sort(), ["at", "calls", "broken", "continued", "firstTextMs", "model", "outcome", "provider", "steps", "tokens", "totalMs"].sort());
  const entries = readLedger(readFileSync(join(dir, LEDGER_FILE), "utf8") + "not json\n");
  assert.equal(entries.length, 2);
  const [claude, grok] = summarizeLedger(entries);
  assert.equal(claude.provider, "claude");
  assert.equal(claude.continuedShare, 100);
  assert.equal(claude.medianInputUnits, 100 + 1250 + 900);
  assert.equal(grok.failed, 1);
  assert.equal(grok.broken, 1);
  // Past its size the ledger keeps its newer half.
  const big = { at: 2, provider: "codex", outcome: "ok" as const, totalMs: 1, steps: 1, calls: 1, broken: 0, model: "x".repeat(1000) };
  for (let i = 0; i < Math.ceil(LEDGER_MAX_BYTES / 1000) + 5; i++) void ledger.record(big);
  await ledger.record(big);
  const after = readFileSync(join(dir, LEDGER_FILE), "utf8");
  assert.ok(after.length <= LEDGER_MAX_BYTES && after.length > LEDGER_MAX_BYTES / 3);
});

test("on a kept session the memory and source excerpts go once, and again when they change", () => {
  const memories = [{ text: "Studies electrical engineering" }];
  assert.equal(memoryPrint("Sam", memories), memoryPrint("Sam", [{ text: "Studies electrical engineering" }]));
  assert.notEqual(memoryPrint("Sam", memories), memoryPrint("Sam", [...memories, { text: "Prefers SI units" }]));
  assert.notEqual(memoryPrint("Sam", memories), memoryPrint(undefined, memories));
  const source = { source: "notes.pdf", text: "Ohm's law" };
  assert.notEqual(sourcePrint(source), sourcePrint({ ...source, text: "Kirchhoff" }));
  // What the continuation leaves out is simply absent from the prompt: no empty sections.
  const prompt = composePrompt({ messages: [{ role: "user", content: "next question" }], sources: [], memories: [], continued: true, rulesInSystem: true });
  assert.equal(prompt, "<mowr-request>\nnext question\n</mowr-request>");
});
