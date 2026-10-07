import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownSource, withMarkdownSource, checkProblems } from "../../desktop/markdown-source.ts";
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
    '{"module":"mowr","fn":"solveCircuit","args":[{}]}',
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
  const split = withMarkdownSource({ plan: ["Nodes"] }, "## Nodes\nShort intro.\n```figure\n{\"module\":\"mowr\",\"fn\":\"x\",\"args\":[]}\n```\n" + words(60) + "\n");
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
  const json = { action: "pptx", slides: [{ title: "x", figure: { module: "mowr", fn: "nope" } }] };
  memory.failed(json, undefined, "mowr.nope is not a function");
  assert.match(memory.repeated(json, undefined)!, /same as one that just failed, so it was not run again: mowr\.nope is not a function\./);
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
    assert.match(guide, /mowr solveCircuit with the same netlist as the figure/);
  }
});
