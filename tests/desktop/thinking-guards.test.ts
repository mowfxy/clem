import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownSource, withMarkdownSource, checkProblems, uncheckedExamples } from "../../desktop/markdown-source.ts";
import { answerReview, calculationIntent } from "../../desktop/answer-review.ts";
import { runKinetraTurn } from "../../desktop/kinetra-turn.ts";
import { WRITERS_NOTE } from "../../desktop/claude.ts";
import { unwritten, STUB_WORDS } from "../../desktop/pdf-document.ts";
import { failureMemory } from "../../desktop/repeat-guard.ts";
import { kinetraCli, kinetraFiles } from "../../desktop/kinetra-runtime.ts";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

test("a Markdown document is checked against its plan: a missing section and a stub section are unwritten", () => {
  const md = [
    "# Lecture 3",
    "",
    "## Ohm's law",
    words(80),
    "",
    "## Worked example 3.1",
    "TODO",
    "",
    "## Exercises",
    "A few lines only.",
    "",
    "## Figure",
    "```figure",
    '{"module":"clem","fn":"solveCircuit","args":[{}]}',
    "```",
    "",
  ].join("\n");
  const plan = ["Ohm's law", "Worked example 3.1", "Exercises", "Figure", "Kirchhoff's laws"];
  const spec = withMarkdownSource({ action: "pdf", markdown: "Drafts/l3.md", plan }, md);
  assert.deepEqual(spec.plan, plan);
  // A placeholder and a section of a line or two are stubs; a figure on its own is content; a missing heading is missing.
  assert.deepEqual(unwritten(spec, { stubs: true }), ["Worked example 3.1", "Exercises", "Kirchhoff's laws"]);
  // Requests sent as JSON keep the old rule (a heading counts), so nothing changes for them.
  assert.deepEqual(unwritten(spec), ["Kirchhoff's laws"]);
  // Once written in full, nothing is left.
  const done = withMarkdownSource({ action: "pdf", markdown: "Drafts/l3.md", plan }, md.replace("TODO", words(STUB_WORDS)).replace("A few lines only.", words(STUB_WORDS + 5)) + "## Kirchhoff's laws\n" + words(60) + "\n");
  assert.deepEqual(unwritten(done, { stubs: true }), []);
  // The text after a figure counts toward the section it continues.
  const split = withMarkdownSource({ plan: ["Nodes"] }, "## Nodes\nShort intro.\n```figure\n{\"module\":\"clem\",\"fn\":\"x\",\"args\":[]}\n```\n" + words(60) + "\n");
  assert.deepEqual(unwritten(split, { stubs: true }), []);
});

test("a stated value that differs from its check refuses the file, naming the line; checks are never printed", () => {
  const md = [
    "# Circuits",                                                                      // 1
    "",                                                                                // 2
    "## Example",                                                                      // 3
    "The current is $I = V/R = 12/4 = 3$ A and the power 36 W.",                       // 4
    "```check",                                                                        // 5
    '{"checks":[',                                                                     // 6
    '{"label":"Current","expr":"V/R","vars":{"V":12,"R":4},"claimed":3,"unit":"A"},',   // 7
    '{"label":"Power","expr":"V^2/R","vars":{"V":12,"R":4},"claimed":48,"unit":"W"}',  // 8
    "]}",                                                                              // 9
    "```",                                                                             // 10
    "More text.",                                                                      // 11
  ].join("\n");
  const source = markdownSource(md);
  assert.equal(source.checks?.length, 1);
  assert.doesNotMatch(source.sections[0].text!, /check|claimed/, "the check block is left out of the printed text");
  assert.match(source.sections[0].text!, /More text\./);
  const problems = checkProblems(source.checks);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^Line 8: "Power" states 48 W, but V\^2\/R gives 36 W\.$/);
  assert.throws(() => withMarkdownSource({ action: "pdf", markdown: "Drafts/c.md" }, md), (e: Error) => /No file was made/.test(e.message) && /Line 8/.test(e.message));
  // Correct values pass, and a broken block is named by its first line.
  assert.doesNotThrow(() => withMarkdownSource({ action: "pdf" }, md.replace('"claimed":48', '"claimed":36')));
  assert.match(checkProblems(markdownSource("## A\n" + words(40) + "\n```check\n{not json\n```\n").checks)[0], /^Line 3: /);
  assert.throws(() => markdownSource("## A\n```check\n{}\n"), /check block at line 2 never closes/);
});

test("an unchanged request after a failure is refused without running", () => {
  const memory = failureMemory();
  const spec = { action: "pdf", markdown: "Drafts/c.md" };
  assert.equal(memory.repeated(spec, "text v1"), undefined);
  memory.failed(spec, "text v1", "The figure block at line 12 is not valid JSON (Unexpected token).");
  const again = memory.repeated(spec, "text v1");
  assert.match(again!, /^The file has not changed since this error: The figure block at line 12/);
  assert.match(again!, /Fix line 12 with an edit first/);
  // Once the file is edited, or the request changes, it runs again.
  assert.equal(memory.repeated(spec, "text v2"), undefined);
  assert.equal(memory.repeated({ ...spec, plan: ["A"] }, "text v1"), undefined);
  // The same for a request sent as JSON.
  const json = { action: "pptx", slides: [{ title: "x", figure: { module: "clem", fn: "nope" } }] };
  memory.failed(json, undefined, "clem.nope is not a function");
  assert.match(memory.repeated(json, undefined)!, /same as one that just failed, so it was not run again: clem\.nope is not a function\./);
  assert.equal(memory.repeated({ ...json, slides: [] }, undefined), undefined);
  // A failure that can pass on its own is not remembered.
  memory.failed(json, "t", "That took too long.");
  assert.equal(memory.repeated(json, "t"), undefined);
});

test("the guide tells every folder AI to plan first and check each worked example", () => {
  for (const guide of [kinetraCli, kinetraFiles]) {
    assert.match(guide, /"plan":\[every heading\]/);
    assert.match(guide, /Plan first: .*every topic, worked example and exercise/);
    assert.match(guide, /info string is check/);
    assert.match(guide, /clem solveCircuit with the same netlist as the figure/);
  }
});

test("a chat answer's wrong check, or a calculation nothing verified, goes back once; a verified one passes", () => {
  const answer = (claimed: number) => `The power is $P = V^2/R = 144/4 = ${claimed}$ W.\n\n\`\`\`check\n{"checks":[{"label":"Power","expr":"V^2/R","vars":{"V":12,"R":4},"claimed":${claimed},"unit":"W"}]}\n\`\`\``;
  assert.match(answerReview(answer(48), [], { calculation: false })!, /^Your answer's numbers do not all hold: "Power" states 48 W, but V\^2\/R gives 36 W\./);
  assert.equal(answerReview(answer(36), [], { calculation: true }), undefined);
  // Worked out with no tool and no check: sent back, unless a call computed it or a file (checked when made) carries it.
  const bare = "The current is $I = V/R = 12/4 = 3$ A.";
  assert.match(answerReview(bare, [], { calculation: true })!, /no Kinetra call worked out and no check verifies/);
  assert.equal(answerReview(bare, [{ request: { action: "call", module: "clem", fn: "solveCircuit" }, result: { I: 3 } }], { calculation: true }), undefined);
  assert.equal(answerReview(bare, [{ request: { action: "pdf" }, result: { created: true } }], { calculation: true }), undefined);
  assert.equal(answerReview(bare, [], { calculation: false }), undefined, "an explanation is not a calculation");
  assert.equal(answerReview("Ohm's law says V = IR.", [], { calculation: true }), undefined, "a formula alone is no result");
  assert.equal(answerReview("Reset both first:\n```python\nx = y = 0\ntotal = count = 10\n```\nThen `a = b = 1` works.", [], { calculation: true }), undefined, "code is not a calculation");
  assert.ok(calculationIntent("Calculate the current through R2"));
  assert.ok(calculationIntent("a 5 kg block on a 30° incline"));
  assert.equal(calculationIntent("Explain how a transistor works"), false);
});

test("worked examples in a draft whose results have no check are found by line", () => {
  const md = [
    "## Ohm's law",                                  // 1
    "> [!EXAMPLE] Current",                          // 2
    "> $I = V/R = 12/4 = 3$ A",                      // 3
    "",                                              // 4
    "> [!EXAMPLE] Power",                            // 5
    "> $P = VI = 12 \\times 3 = 36$ W",             // 6
    "```check",                                      // 7
    '{"checks":[{"label":"P","expr":"12*3","claimed":36}]}',
    "```",
    "> [!EXERCISE] Given R = 4 Ω and V = 8 V, find I.",
    "### Worked example 2",                          // 11
    "The drop is approximately $\\approx 2.5$ V.", // 12
    "## Next",
    "> [!EXAMPLE] Definition only",
    "> No numbers here.",
  ].join("\n");
  assert.deepEqual(uncheckedExamples(md), [2, 11]);
});

test("a final answer sent back folds the first version away and is reviewed at most once per problem", async () => {
  const replies = ["Answer v1 = 1/1 = 2", "Answer v2 = 1/1 = 2", "never asked"];
  const inputs: string[] = [];
  let folded = 0;
  const answer = await runKinetraTurn("q", "", async (input) => { inputs.push(input); return replies.shift()!; }, async () => 1, () => false, {
    stateful: true,
    review: () => "Your answer's numbers do not all hold.",
    sentBack: () => folded++,
  });
  assert.equal(answer, "Answer v2 = 1/1 = 2", "the same problem is not sent back twice");
  assert.equal(folded, 1);
  assert.match(inputs[1], /Your answer's numbers do not all hold\./);
});

test("an unfinished writer's document goes to a new writer, not to the main assistant's own reading", () => {
  assert.match(WRITERS_NOTE, /start a new clem-writer for just that: its draft file, what is missing/);
  assert.match(WRITERS_NOTE, /Never read a writer's sources yourself/);
});

test("an answer with a visual the chat cannot draw goes back with the reason", async () => {
  const { visualProblems } = await import("../../desktop/answer-review.ts");
  const broken = "Here:\n```visual\n{\"kind\":\"diagram\",\"nodes\":[]}\n```\n";
  assert.match(answerReview(broken, [], { calculation: false })!, /^Some of your visuals cannot be drawn: Visual 1: .*title/);
  assert.deepEqual(visualProblems("```visual\n{\"kind\":\"diagram\",\"title\":\"T\",\"nodes\":[{\"id\":\"a\",\"label\":\"A\"}]}\n```"), []);
});

test("a final answer goes back at most once, even for a new problem, and the screen is told why", async () => {
  const replies = ["Answer v1", "Answer v2", "never asked"];
  const why: string[] = [];
  let n = 0;
  const answer = await runKinetraTurn("q", "", async () => replies.shift()!, async () => 1, () => false, {
    stateful: true,
    review: () => `Problem ${++n}.`,
    sentBack: (reason) => why.push(reason),
  });
  assert.equal(answer, "Answer v2", "a second, different problem does not send the answer back again");
  assert.deepEqual(why, ["review"]);
});

test("an answer sent back is still the answer when its rewrite fails", async () => {
  let step = 0;
  const answer = await runKinetraTurn("q", "", async () => { if (step++) throw Error("The service failed."); return "The first answer."; }, async () => 1, () => false, {
    stateful: true,
    review: () => "Your answer's numbers do not all hold.",
    sentBack: () => {},
  });
  assert.equal(answer, "The first answer.");
  // A stop is still a stop.
  let stopped = false;
  await assert.rejects(runKinetraTurn("q", "", async () => "First.", async () => 1, () => stopped, {
    stateful: true, review: () => "Again.", sentBack: () => { stopped = true; },
  }), /cancel/i);
});

test("an answer held back for an unfinished document is taken off the screen too", async () => {
  const replies = ["Done: here is your PDF.", "Here is your finished PDF."];
  const why: string[] = [];
  let gaps = ["Section 3 is missing."];
  const answer = await runKinetraTurn("q", "", async () => { const r = replies.shift()!; if (!replies.length) gaps = []; return r; }, async () => 1, () => false, {
    stateful: true,
    unfinished: () => gaps[0],
    sentBack: (reason) => why.push(reason),
  });
  assert.equal(answer, "Here is your finished PDF.");
  assert.deepEqual(why, ["unfinished"]);
});
