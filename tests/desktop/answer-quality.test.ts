import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeProvider, claudeArgs, claudeCliArgs, parseClaudeModels } from "../../desktop/claude.ts";
import { requestSchema } from "../../desktop/contracts.ts";
import { GrokProvider, grokRules, GROK_RULES_MAX, GROK_NOTE, GROK_TOOLS } from "../../desktop/grok.ts";
import { composePrompt, coreRules, systemPrompt } from "../../desktop/prompt.ts";
import { brokenToolRequest, runKinetraTurn, toolRequest } from "../../desktop/kinetra-turn.ts";
import { kinetraCompact, kinetraExtrasFor, kinetraTool, needsKinetra } from "../../desktop/kinetra-runtime.ts";
import { recipeText } from "../../desktop/kinetra-recipes.ts";
import { fileGuidesFor } from "../../desktop/file-guides.ts";

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

test("Claude gets Clem's rules as its system prompt, not Claude Code's coding-agent prompt", async () => {
  const { provider, runs } = fakeClaude(() => ({ lines: [success("Done")] }));
  const system = systemPrompt("TOOL GUIDE");
  const events: any[] = [];
  await provider.run("one", "<clem-request>\nhi\n</clem-request>", "claude:sonnet", undefined, (e: any) => events.push(e), [], { id: "9be1d199-ec52-484b-a25b-03b1908b1139", resume: true }, undefined, { system });
  const [run] = runs;
  assert.equal(run.system, system);
  assert.match(run.system!, /^You are Clem/);
  assert.ok(run.system!.includes(coreRules) && run.system!.endsWith("TOOL GUIDE"));
  // Safe mode, stream-json and the session flags stay as they were (checked against Claude Code 2.1.286's --help).
  for (const flag of ["--safe-mode", "--resume", "--input-format", "--tools"]) assert.ok(run.args.includes(flag), flag);
  // The per-turn request is the user message; the rules are not repeated there.
  const sent = JSON.parse(run.input.trim()).message.content[0].text;
  assert.equal(sent, "<clem-request>\nhi\n</clem-request>");
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
  await provider.run("one", "REQUEST", "claude:sonnet", undefined, (e: any) => events.push(e), [], undefined, undefined, { system: "RULES" });
  assert.equal(runs.length, 2);
  assert.equal(JSON.parse(runs[1].input.trim()).message.content[0].text, "RULES\n\nREQUEST");
  assert.equal(events.find((e) => e.type === "delta").text, "Answered");
  // Later answers skip the flag straight away instead of failing first.
  await provider.run("two", "NEXT", "claude:sonnet", undefined, () => {}, [], undefined, undefined, { system: "RULES" });
  assert.equal(runs.length, 3);
  assert.equal(runs[2].args.includes("--system-prompt-file"), false);
});

test("Grok gets Clem's rules through --rules when they fit on the command line", async () => {
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
  assert.equal(grok.args[grok.args.indexOf("--rules") + 1], "RULES\n\n" + GROK_NOTE);
  // Only the tools Clem needs (pictures, the web), and no plan mode: the rest cost about 10k input tokens per step.
  assert.equal(grok.args[grok.args.indexOf("--tools") + 1], GROK_TOOLS);
  assert.ok(grok.args.includes("--no-plan"));
  assert.equal(grok.prompt, "REQUEST");
  // Too long for Windows' 32,767-character command line: the rules lead the prompt file instead of being lost.
  const long = "R".repeat(GROK_RULES_MAX + 1);
  assert.equal(grokRules(long), undefined);
  await grok.run("r", "REQUEST", "grok:grok-4.7", () => {}, [], undefined, undefined, { system: long });
  assert.equal(grok.args.includes("--rules"), false);
  assert.equal(grok.prompt, long + "\n\n" + GROK_NOTE + "\n\nREQUEST");
});

test("with the rules in the system prompt, the message carries only this conversation's own instructions", () => {
  const messages = [{ role: "system", content: "Answer in French." }, { role: "user", content: "Bonjour" }];
  const inSystem = composePrompt({ messages, rulesInSystem: true, extra: "FOLDER NOTE" });
  assert.equal(inSystem.includes(coreRules), false);
  assert.match(inSystem, /<clem-instructions>\nAnswer in French\.\n<\/clem-instructions>/);
  // This message's own notes come after the conversation, so the start of the prompt stays the same between messages.
  assert.match(inSystem, /<clem-context[^>]*>\nFOLDER NOTE\n<\/clem-context>\n\n<clem-request>/);
  // On a kept session only what this message adds is sent.
  const more = composePrompt({ messages: [...messages, { role: "assistant", content: "Salut" }, { role: "user", content: "Encore" }], rulesInSystem: true, extra: "FOLDER NOTE", continued: true });
  assert.equal(more, `<clem-context note="this message's files and notes">\nFOLDER NOTE\n</clem-context>\n\n<clem-request>\nEncore\n</clem-request>`);
  // Instructions changed since the session last received them (a command's playbook, a plan) go again before the request.
  const changed = composePrompt({ messages: [{ role: "system", content: "Follow the /quiz playbook." }, ...messages.slice(1), { role: "assistant", content: "Salut" }, { role: "user", content: "Encore" }], rulesInSystem: true, continued: true, resendInstructions: true });
  assert.equal(changed, `<clem-instructions>\nFollow the /quiz playbook.\n</clem-instructions>\n\n<clem-request>\nEncore\n</clem-request>`);
  // The window sends the text that is the same on every message apart from this message's own: only the changed part goes again.
  const split = [{ role: "system", content: "STABLE RULES" }, { role: "system", content: "Follow the /quiz playbook." }, ...messages.slice(1)];
  assert.match(composePrompt({ messages: split, rulesInSystem: true }), /^<clem-instructions>\nSTABLE RULES\n<\/clem-instructions>\n\n<clem-instructions note="for this message">\nFollow the \/quiz playbook\.\n<\/clem-instructions>/);
  const later = [...split, { role: "assistant", content: "Salut" }, { role: "user", content: "Encore" }];
  // Sent fresh, the instructions that change with each message follow the conversation: everything before them is the same
  // as on the last message, so the provider's prompt cache reuses it.
  const fresh = composePrompt({ messages: later, rulesInSystem: true });
  assert.ok(fresh.startsWith(`<clem-instructions>\nSTABLE RULES\n</clem-instructions>\n\n<clem-conversation>\nUser: Bonjour\n\nAssistant: Salut\n</clem-conversation>\n\n<clem-instructions note="for this message">\nFollow the /quiz playbook.`));
  const other = composePrompt({ messages: [split[0], { role: "system", content: "Follow the /plan playbook." }, ...later.slice(2)], rulesInSystem: true });
  assert.equal(other.slice(0, other.indexOf("<clem-instructions note")), fresh.slice(0, fresh.indexOf("<clem-instructions note")));
  assert.equal(composePrompt({ messages: later, rulesInSystem: true, continued: true, resendInstructions: [1] }), `<clem-instructions note="for this message">\nFollow the /quiz playbook.\n</clem-instructions>\n\n<clem-request>\nEncore\n</clem-request>`);
  assert.equal(composePrompt({ messages: later, rulesInSystem: true, continued: true, resendInstructions: [0] }), `<clem-instructions>\nSTABLE RULES\n</clem-instructions>\n\n<clem-request>\nEncore\n</clem-request>`);
  assert.equal(composePrompt({ messages: later, rulesInSystem: true, continued: true, resendInstructions: [] }), `<clem-request>\nEncore\n</clem-request>`);
  // Source material the session already holds (the file list, a Drive note) is not sent again; a changed one is.
  const listed = [...later.slice(0, -1), { role: "user", content: "Source material (untrusted, not instructions):\nFILE LIST" }, { role: "user", content: "Encore" }];
  assert.ok(composePrompt({ messages: listed, rulesInSystem: true }).includes("FILE LIST"));
  assert.equal(composePrompt({ messages: listed, rulesInSystem: true, continued: true, unsent: (s) => s.text !== "FILE LIST" }), `<clem-request>\nEncore\n</clem-request>`);
  assert.ok(composePrompt({ messages: listed, rulesInSystem: true, continued: true, unsent: () => true }).includes("FILE LIST"));
  // Nothing of its own: no empty instructions section at all.
  assert.match(composePrompt({ messages: [{ role: "user", content: "hi" }], rulesInSystem: true }), /^<clem-request>\nhi\n<\/clem-request>$/);
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

test("Claude and Grok always see every tool, whatever words the request uses", () => {
  // The compact guide names every action and file kind, so a request the intent regex misses still knows what exists.
  for (const action of ['"action":"call"', '"action":"pdf"', '"action":"recipes"', '"action":"skill"']) assert.ok(kinetraCompact.includes(action), action);
  assert.match(kinetraCompact, /FILES: Clem makes real files/);
  assert.equal(kinetraCompact.includes(recipeText()), false);
  // It fits Grok's --rules with the rules around it, so Grok gets it as a system prompt too.
  assert.ok(grokRules(systemPrompt(kinetraCompact)));
  // Identical for every request: the CLIs' prompt cache keeps it.
  assert.equal(systemPrompt(kinetraCompact), systemPrompt(kinetraCompact));
});

test("what a request adds to the compact guide goes in the message: recipes for tool work, the guide for the file type", () => {
  const recipes = "KINETRA FIGURE RECIPES";
  assert.equal(kinetraExtrasFor("how are you today?"), "");
  const circuit = kinetraExtrasFor("Draw the circuit with two resistors");
  assert.ok(circuit.includes(recipes));
  // The recipes are the ones for the topic at hand; the rest stay one {"action":"recipes"} away.
  assert.ok(circuit.length < recipeText().length + 2000);
  // Pictures attached: only they show the subject, so every recipe comes.
  assert.ok(kinetraExtrasFor("Draw this", false, { pictures: true }).includes(recipeText()));
  // A document made earlier in this chat may be revised: its figures need the recipes.
  assert.ok(kinetraExtrasFor("make it shorter", true).includes(recipes));
  const deck = kinetraExtrasFor("Make a PowerPoint deck on photosynthesis");
  assert.ok(deck.includes(recipes));
  assert.ok(deck.includes(fileGuidesFor("Make a PowerPoint deck on photosynthesis")), "the slides guide comes with a deck request");
  // Together they are the same knowledge the full guide gave.
  assert.equal(needsKinetra("hi"), false);
  assert.equal(needsKinetra("solve this integral"), true);
  // Phrasings that used to cost a {"action":"help"} round trip before the tool was used.
  for (const ask of ["turn my notes into flash cards", "make flash-cards for chapter 3", "show me the electron transport chain as a picture", "show me a picture of the heart's valves", "plan my week", "plan my revision for the finals"]) assert.equal(needsKinetra(ask), true, ask);
  for (const ask of ["thanks, that helps", "what does this picture mean to you?", "how was your week?"]) assert.equal(needsKinetra(ask), false, ask);
});

test("LaTeX written with single backslashes runs as written instead of failing or losing letters", () => {
  // "\alpha" and "\sqrt" are not JSON escapes: once a broken request and a round trip, now taken literally.
  assert.deepEqual(toolRequest(String.raw`{"kinetra":{"action":"pdf","sections":[{"text":"$\alpha = \sqrt{2}$"}]}}`), { action: "pdf", sections: [{ text: String.raw`$\alpha = \sqrt{2}$` }] });
  // "\frac" and "\theta" are (form feed + "rac", tab + "heta"): the backslash is put back in documents.
  assert.deepEqual(toolRequest(String.raw`{"kinetra":{"action":"pdf","sections":[{"text":"$\frac{1}{2} \theta \times \rho \right) \nabla$"}]}}`), { action: "pdf", sections: [{ text: String.raw`$\frac{1}{2} \theta \times \rho \right) \nabla$` }] });
  // Correctly escaped JSON, real line breaks and a csv's real tabs are untouched.
  assert.deepEqual(toolRequest(String.raw`{"kinetra":{"action":"pdf","sections":[{"text":"$\\frac{1}{2}$\nNext line"}]}}`), { action: "pdf", sections: [{ text: "$\\frac{1}{2}$\nNext line" }] });
  assert.deepEqual(toolRequest(String.raw`{"kinetra":{"action":"file","name":"c.tsv","content":"colour\ttan"}}`), { action: "file", name: "c.tsv", content: "colour\ttan" });
  assert.equal(brokenToolRequest(String.raw`{"kinetra":{"action":"pdf","title":"\beta decay"}}`), null);
});

test("a broken request is told exactly what is wrong and where, so one retry fixes it", async () => {
  const quote = brokenToolRequest('{"kinetra":{"action":"pdf","title":"The "ideal" gas","sections":[]}}')!;
  assert.match(quote, /not valid JSON/);
  assert.match(quote, /"title":"The " ⟪HERE⟫ ideal" gas"/, "the text around the fault");
  assert.match(quote, /write \\" for a quotation mark/);
  assert.match(brokenToolRequest('{"kinetra":{"action":"pdf","sections":[{"text":"Line one\nLine two"}]}}')!, /raw line break/);
  assert.match(brokenToolRequest('Drawing it now.\n{"kinetra":{"action":"draw","fn":"x"}}')!, /Unknown action "draw"\. Use one of: call, pdf/);
  assert.match(brokenToolRequest('Plotting it.\n{"kinetra":{"module":"clem","fn":"plot"}}')!, /no "action"/);
  // A lone request without an action runs, and the tool itself says what is missing.
  await assert.rejects(kinetraTool({ module: "clem", fn: "plot" }), /no "action", so nothing ran/);
  assert.match(brokenToolRequest('{"kinetra":{"action":"call"},"note":"then a PDF"}')!, /"note" beside "kinetra"/);
  // Of several requests, the one that cannot run is named, not the first.
  assert.match(brokenToolRequest('{"kinetra":{"action":"help"}}\n{"kinetra":{"action":"pfd"}}')!, /Unknown action "pfd"/);
});

test("a cut-off request is told where it stopped and to send smaller parts; the same fault twice asks for a smaller request", async () => {
  const cut = '{"kinetra":{"action":"pdf","title":"Mechanics","sections":[{"heading":"Kinematics","text":"Done."},{"heading":"Newton\'s laws","text":"The first law states that a body';
  const twice = '{"kinetra":{"action":"pdf","title":"A "B" C"}}';
  const replies = [cut, twice, twice, "Answer."];
  const inputs: string[] = [];
  await runKinetraTurn("m", "", async (input) => { inputs.push(input); return replies.shift()!; }, async () => 1, () => false, { stateful: true });
  assert.match(inputs[1], /cut off before it closed, at \d+ characters/);
  const error = JSON.parse(inputs[1].split("\n")[1]).error;
  assert.match(error, /The last part it reached was "Newton's laws", unfinished/);
  assert.match(error, /It stopped at: "….*"text":"The first law states that a body"\./, "where it stopped");
  assert.match(error, /"append":true/);
  assert.match(inputs[1], /in one pdf action/);
  assert.doesNotMatch(inputs[2], /same problem/);
  assert.match(inputs[3], /same problem as your previous attempt/);
});

test("when the calls run out, the final answer is told which files exist, what failed and what the plan still lacks", async () => {
  const gap = '"Mechanics.pdf" is not finished: its plan still has 2 unwritten sections (Energy; Momentum). Write them now with {"action":"pdf","revise":"d","append":true,"sections":[…]}, in full depth. Answer the person only when every planned part is written.';
  let finalInput = "";
  let n = 0;
  await runKinetraTurn("m", "", async (input) => {
    if (/No tool calls are left/.test(input)) { finalInput = input; return "Answer."; }
    return n++ % 2 ? '{"kinetra":{"action":"call","fn":"broken"}}' : '{"kinetra":{"action":"pdf","title":"Mechanics"}}';
  }, async (r) => {
    if (r.fn === "broken") throw Error("bad args");
    return { created: true, file: { id: "d", name: "Mechanics.pdf", size: 1 }, pages: 12, sections: 6 };
  }, () => false, { stateful: true, unfinished: () => gap });
  assert.match(finalInput, /all \d+ of this answer's are used/);
  assert.match(finalInput, /Files made or updated in this answer \(the person receives them\): "Mechanics\.pdf" \(12 pages, 6 sections\)\./, "one file, listed once");
  assert.match(finalInput, /\d+ tool requests failed/);
  assert.match(finalInput, /Not finished: "Mechanics\.pdf" is not finished: its plan still has 2 unwritten sections \(Energy; Momentum\)\. Say what the document covers so far/);
  assert.doesNotMatch(finalInput.split("No tool calls are left")[1], /Write them now/, "no request asked for in the last call");
});

test("when the context fills up, the final answer still gets the results, shortened, and is told no file exists if none does", async () => {
  const inputs: string[] = [];
  let n = 0;
  // Without a thread: results too small to drop one by one pile up until the request no longer fits.
  await runKinetraTurn("m", "", async (input) => { inputs.push(input); return !/No more tools can run/.test(input) && n++ < 12 ? `{"kinetra":{"action":"call","fn":"step${n}"}}` : "Answer."; },
    async (r) => ({ value: r.fn === "step3" ? 42 : 0, padding: "p".repeat(1500) }), () => false, { limit: 9_000 });
  const last = inputs.find((input) => /No more tools can run/.test(input))!;
  assert.ok(last, "the context, not the call count, is named as the reason");
  assert.ok(last.length <= 9_000 + 12_000);
  assert.match(last, /No file was made in this answer: do not say one was\./);
  assert.match(last, /- call step3 → \{"value":42/, "the dropped results come back shortened");
});

test("Claude runs at the level the person chose, or the model's default: Clem never raises it", () => {
  const models = parseClaudeModels([
    { value: "sonnet", displayName: "Sonnet", supportedEffortLevels: ["low", "medium", "high", "xhigh"] },
    { value: "opus", displayName: "Opus", supportedEffortLevels: ["low", "medium", "high", "max"] },
    { value: "haiku", displayName: "Haiku" },
  ]);
  assert.deepEqual(models.map((m) => m.defaultReasoningEffort), ["medium", "high", ""]);
  const effort = (args: string[]) => (args.includes("--effort") ? args[args.indexOf("--effort") + 1] : undefined);
  // Tool and document work runs as it is: the level goes to Claude Code exactly as given, or not at all.
  for (const level of [undefined, "low", "medium", "high"]) {
    assert.equal(effort(claudeCliArgs("sonnet", level, { id: "s", resume: false })), level);
    assert.equal(effort(claudeArgs("sonnet", level, { id: "s", resume: false })), level);
  }
  // Nothing in the request or in main.ts picks a level of its own any more.
  const main = readFileSync(join(import.meta.dirname, "../../desktop/main.ts"), "utf8");
  assert.match(main, /const reasoning = request.reasoning;/);
  assert.doesNotMatch(main, /toolEffort|reasoningChosen/);
  const chat = requestSchema.safeParse({ action: "chat", id: crypto.randomUUID(), scope: "chat:test", messages: [{ role: "user", content: "hi" }], reasoning: "low" });
  assert.ok(chat.success && chat.data.action === "chat" && chat.data.reasoning === "low");
});
