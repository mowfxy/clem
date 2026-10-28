import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GrokProvider, grokRefusal } from "../../desktop/grok.ts";

// What Grok 1.0.70 prints for a flag it does not know: its usage line repeats every flag it was given.
const refused = (flag: string) => `error: unexpected argument '${flag}' found\n\n  tip: to pass '${flag}' as a value, use '-- ${flag}'\n\nUsage: grok --prompt-file <PATH> --model <MODEL> --output-format <OUTPUT_FORMAT> --include-partial-messages --permission-mode <MODE> --no-subagents --no-plan --tools <TOOLS> --allow <RULE> [PROMPT]\n\nFor more information, try '--help'.`;
const answered = { code: 0, out: '{"type":"result","subtype":"success","is_error":false,"result":"Hello."}\n', err: "" };

test("grokRefusal is the line naming the refused flag, never the usage line", () => {
  assert.equal(grokRefusal(refused("--no-plan")), "error: unexpected argument '--no-plan' found");
  assert.doesNotMatch(grokRefusal(refused("--no-plan")), /include-partial-messages|--tools/);
  assert.equal(grokRefusal("Grok took too long"), "");
});

test("one refused flag turns off only its own feature: replies keep streaming", async () => {
  const grok: any = new GrokProvider(mkdtempSync(join(tmpdir(), "clem-grok-")), "fixture");
  grok.knownStatus = () => ({ installed: true, connected: true, models: ["grok-4.6"] });
  const runs: string[][] = [];
  grok.attempt = async (_id: string, args: string[]) => { runs.push(args); return runs.length === 1 ? { code: 2, out: "", err: refused("--no-plan") } : answered; };
  const events: any[] = [];
  await grok.run("t1", "hi", "grok:grok-4.6", (e: any) => events.push(e));
  assert.equal(runs.length, 2);
  assert.equal(grok.noToolList, true, "the refused --no-plan drops the tool list");
  assert.equal(grok.noPartial, false, "streaming stays on");
  assert.ok(runs[1].includes("--include-partial-messages"));
  assert.ok(!runs[1].includes("--no-plan"));
  assert.ok(events.some((e) => e.type === "delta" && e.text === "Hello."));
});

test("a Grok that refuses --include-partial-messages itself still answers, in one piece", async () => {
  const grok: any = new GrokProvider(mkdtempSync(join(tmpdir(), "clem-grok-")), "fixture");
  grok.knownStatus = () => ({ installed: true, connected: true, models: ["grok-4.6"] });
  const runs: string[][] = [];
  grok.attempt = async (_id: string, args: string[]) => { runs.push(args); return runs.length === 1 ? { code: 2, out: "", err: refused("--include-partial-messages") } : answered; };
  await grok.run("t1", "hi", "grok:grok-4.6", () => {});
  assert.equal(grok.noPartial, true);
  assert.equal(grok.noToolList, false);
  assert.ok(!runs[1].includes("--include-partial-messages"));
});
