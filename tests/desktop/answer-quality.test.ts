import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeProvider } from "../../desktop/claude.ts";
import { GrokProvider, grokRules, GROK_RULES_MAX } from "../../desktop/grok.ts";
import { composePrompt, coreRules, systemPrompt } from "../../desktop/prompt.ts";
import { runKinetraTurn } from "../../desktop/kinetra-turn.ts";

/** A fake CLI child: records what it was given and answers with `lines` once its input ends. */
function fakeChild(lines: () => string[], code = 0) {
  const child: any = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  child.input = "";
  child.stdin.on("data", (part: Buffer) => (child.input += part.toString()));
  child.stdin.on("finish", () => queueMicrotask(() => { for (const line of lines()) child.stdout.write(line + "\n"); child.emit("close", code); }));
  return child;
}
const success = (result: string) => JSON.stringify({ type: "result", subtype: "success", result, is_error: false });

function fakeClaude(reply: (args: string[], system: string | undefined) => { lines: string[]; code?: number }) {
  const provider: any = new ClaudeProvider("fixture", mkdtempSync(join(tmpdir(), "claude-")));
  provider.status = async () => ({ connected: true });
  const runs: { args: string[]; input: string; system?: string; file?: string }[] = [];
  provider.start = async (args: string[]) => {
    const at = args.indexOf("--system-prompt-file"), file = at >= 0 ? args[at + 1] : undefined;
    const system = file ? readFileSync(file, "utf8") : undefined;
    const { lines, code = 0 } = reply(args, system);
    const child = fakeChild(() => lines, code);
    const run = { args, input: "", system, file };
    child.stdin.on("finish", () => (run.input = child.input));
    runs.push(run);
    return child;
  };
  return { provider, runs };
}

test("Claude gets Mowr's rules as its system prompt, not Claude Code's coding-agent prompt", async () => {
  const { provider, runs } = fakeClaude(() => ({ lines: [success("Done")] }));
  const system = systemPrompt("TOOL GUIDE");
  const events: any[] = [];
  await provider.run("one", "<mowr-request>\nhi\n</mowr-request>", "claude:sonnet", undefined, (e: any) => events.push(e), [], { id: "9be1d199-ec52-484b-a25b-03b1908b1139", resume: true }, { system });
  const [run] = runs;
  assert.equal(run.system, system);
  assert.match(run.system!, /^You are Mowr/);
  assert.ok(run.system!.includes(coreRules) && run.system!.endsWith("TOOL GUIDE"));
  // Safe mode, stream-json and the session flags stay as they were (checked against Claude Code 2.1.286's --help).
  for (const flag of ["--safe-mode", "--resume", "--input-format", "--tools"]) assert.ok(run.args.includes(flag), flag);
  // The per-turn request is the user message; the rules are not repeated there.
  const sent = JSON.parse(run.input.trim()).message.content[0].text;
  assert.equal(sent, "<mowr-request>\nhi\n</mowr-request>");
  // The system prompt file is removed when the answer ends.
  assert.equal(existsSync(run.file!), false);
  assert.equal(events.at(-1).type, "done");
});

test("a Claude Code without --system-prompt-file gets the rules in the message, once, and keeps them there", async () => {
  const { provider, runs } = fakeClaude((args) =>
    args.includes("--system-prompt-file")
      ? { lines: [JSON.stringify({ type: "result", subtype: "error", is_error: true, result: "error: unknown option '--system-prompt-file'" })], code: 1 }
      : { lines: [success("Answered")] });
  const events: any[] = [];
  await provider.run("one", "REQUEST", "claude:sonnet", undefined, (e: any) => events.push(e), [], undefined, { system: "RULES" });
  assert.equal(runs.length, 2);
  assert.equal(JSON.parse(runs[1].input.trim()).message.content[0].text, "RULES\n\nREQUEST");
  assert.equal(events.find((e) => e.type === "delta").text, "Answered");
  // Later answers skip the flag straight away instead of failing first.
  await provider.run("two", "NEXT", "claude:sonnet", undefined, () => {}, [], undefined, { system: "RULES" });
  assert.equal(runs.length, 3);
  assert.equal(runs[2].args.includes("--system-prompt-file"), false);
});

test("Grok gets Mowr's rules through --rules when they fit on the command line", async () => {
  class Recording extends GrokProvider {
    args: string[] = []; prompt = "";
    constructor() { super(mkdtempSync(join(tmpdir(), "grok-"))); }
    async status() { return { installed: true, connected: true, models: ["grok-4.7"] } as any; }
    async start(args: string[]) {
      this.args = args;
      const file = args[args.indexOf("--prompt-file") + 1];
      if (file) this.prompt = readFileSync(file, "utf8");
      return fakeChild(() => [JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Canberra" })]);
    }
  }
  const grok = new Recording();
  await grok.run("r", "REQUEST", "grok:grok-4.7", () => {}, [], undefined, undefined, { system: "RULES" });
  assert.equal(grok.args[grok.args.indexOf("--rules") + 1], "RULES");
  assert.equal(grok.prompt, "REQUEST");
  // Too long for Windows' 32,767-character command line: the rules lead the prompt file instead of being lost.
  const long = "R".repeat(GROK_RULES_MAX + 1);
  assert.equal(grokRules(long), undefined);
  await grok.run("r", "REQUEST", "grok:grok-4.7", () => {}, [], undefined, undefined, { system: long });
  assert.equal(grok.args.includes("--rules"), false);
  assert.equal(grok.prompt, long + "\n\nREQUEST");
});

test("with the rules in the system prompt, the message carries only this conversation's own instructions", () => {
  const messages = [{ role: "system", content: "Answer in French." }, { role: "user", content: "Bonjour" }];
  const inSystem = composePrompt({ messages, rulesInSystem: true, extra: "FOLDER NOTE" });
  assert.equal(inSystem.includes(coreRules), false);
  assert.match(inSystem, /<mowr-instructions>\nFOLDER NOTE\n\nAnswer in French\.\n<\/mowr-instructions>/);
  // Nothing of its own: no empty instructions section at all.
  assert.match(composePrompt({ messages: [{ role: "user", content: "hi" }], rulesInSystem: true }), /^<mowr-request>\nhi\n<\/mowr-request>$/);
  // Codex still reads the rules in the message.
  assert.ok(composePrompt({ messages }).includes(coreRules));
});

test("the tool loop sends only the request when the instructions travel in the system prompt", async () => {
  const inputs: string[] = [];
  await runKinetraTurn("REQUEST", "", async (input) => { inputs.push(input); return "Answer"; }, async () => 1, () => false);
  assert.equal(inputs[0], "Original request and context:\nREQUEST");
  await runKinetraTurn("REQUEST", "NOTES", async (input) => { inputs.push(input); return "Answer"; }, async () => 1, () => false);
  assert.equal(inputs[1], "NOTES\n\nOriginal request and context:\nREQUEST");
});
