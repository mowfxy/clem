import { test, before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { renameSync, rmSync } from "node:fs";
import { runKinetraTurn, closedRequest, toolRequest, toolRequests, brokenToolRequest, requestLead, shownLength, MAX_CALLS, MAX_BROKEN, MAX_PARALLEL } from "../../desktop/kinetra-turn.ts";
import { kinetraTool, kinetraCall, kinetraPool } from "../../desktop/kinetra-runtime.ts";
import { kinetraRecipes } from "../../desktop/kinetra-recipes.ts";
before(async () => {
  // Built beside and renamed into place: another test file builds the same worker at the same time.
  const tmp = `desktop-dist/kinetra-worker.${process.pid}.tmp`;
  await build({ entryPoints: ["desktop/kinetra-worker.ts"], outfile: tmp, bundle: true, platform: "node", format: "cjs" });
  // If the other file renamed its (identical) build first, Windows refuses this rename; that build is already in place.
  try { renameSync(tmp, "desktop-dist/kinetra-worker.cjs"); } catch { rmSync(tmp, { force: true }); }
});
test("only exact tool envelopes are dispatched; application JSON stays final", () => {
  assert.equal(toolRequest('An example: {"kinetra":{}}'), null);
  assert.equal(toolRequest('{"title":"Quiz","items":[]}'), null);
  assert.deepEqual(toolRequest('{"kinetra":{"action":"skill"}}'), {
    action: "skill",
  });
});
test("a malformed tool envelope goes back for correction instead of becoming the answer", async () => {
  const broken = '{"kinetra":{"action":"call","module":"math/eval","fn":"evalMatrix","args":[{"rows":[[1]]]}, {"vars":{}}]}}';
  assert.ok(brokenToolRequest(broken));
  assert.equal(brokenToolRequest('{"kinetra":{"action":"help"}}'), null);
  assert.equal(brokenToolRequest("The answer is {x}."), null);
  const replies = [broken, '{"kinetra":{"action":"call"}}', "Done."];
  const inputs: string[] = [];
  let calls = 0;
  const result = await runKinetraTurn("m", "", async (input) => { inputs.push(input); return replies.shift()!; }, async () => { calls++; return 1; }, () => false);
  assert.equal(result, "Done.");
  assert.equal(calls, 1);
  assert.match(inputs[1], /not valid JSON/);
});
test("a lead-in sentence or several envelopes in one reply still run; quoted examples do not", async () => {
  assert.deepEqual(toolRequests('Let me calculate that.\n{"kinetra":{"action":"call","fn":"a"}}'), [{ action: "call", fn: "a" }]);
  assert.deepEqual(toolRequests('{"kinetra":{"action":"pdf","title":"A {x}"}}\n```json\n{"kinetra":{"action":"pdf","title":"B"}}\n```'), [{ action: "pdf", title: "A {x}" }, { action: "pdf", title: "B" }]);
  assert.deepEqual(toolRequests('I will read the lecture first.\n{"kinetra":{"action":"read","file":"L3.pdf"}}'), [{ action: "read", file: "L3.pdf" }]);
  // An agent that narrates each of its steps leads with several notes; the request at the end still runs.
  const notes = "I'll start by reading the assignment pages so the circuit diagrams are taken from the figures, then solve each question and put the work in a PDF.The diagrams are in. Next I'll load the circuit solver API and compute each problem so the PDF uses verified numbers.I'll load the circuit module API so the numbers in the solutions match a real solver.Next I'll read the circuit solver's exact argument shapes so each assignment number is computed, not estimated.";
  assert.deepEqual(toolRequests(notes + '{"kinetra":{"action":"api","module":"circuit/circuit"}}'), [{ action: "api", module: "circuit/circuit" }]);
  // However long the lead-in, and even when it quotes the format itself, a request that ends the reply runs.
  const pages = "Working through the circuit step by step. ".repeat(400);
  assert.deepEqual(toolRequests(pages + '{"kinetra":{"action":"call","fn":"a"}}'), [{ action: "call", fn: "a" }]);
  assert.deepEqual(toolRequests('Requests look like {"kinetra":{"action":"help"}} in general. ' + pages + '```json\n{"kinetra":{"action":"read","file":"A.pdf"}}\n```'), [{ action: "read", file: "A.pdf" }]);
  // After a long lead-in, a cut-off or unknown request is sent back to be fixed, never shown; a quoted one with prose after it is prose.
  assert.ok(brokenToolRequest(pages + '{"kinetra":{"action":"pdf","sections":[{"heading":"Q1"'));
  assert.ok(brokenToolRequest(pages + '{"kinetra":{"action":"nope"}}'));
  assert.equal(brokenToolRequest(pages + 'A request looks like {"kinetra":{"action":"help"}} and then Mowr runs it.'), null);
  assert.equal(toolRequests(pages + 'A request looks like {"kinetra":{"action":"help"}} and then Mowr runs it.'), null);
  assert.equal(toolRequests('An example: {"kinetra":{}}'), null);
  assert.equal(toolRequests('Use {"kinetra":{"action":"call"}} and then read the result.'), null);
  assert.equal(shownLength('Let me check.\n{"kinetra":{"act'), 'Let me check.\n'.length);
  assert.equal(shownLength('Let me check.\n{"kin'), 'Let me check.\n'.length);
  assert.equal(shownLength("Plain answer."), "Plain answer.".length);
  const ran: any[] = [];
  const replies = ['One PDF per lecture.\n{"kinetra":{"action":"pdf","title":"L1"}}\n{"kinetra":{"action":"pdf","title":"L2"}}', "Both made."];
  const inputs: string[] = [];
  const result = await runKinetraTurn("m", "", async (input) => { inputs.push(input); return replies.shift()!; }, async (r) => { ran.push(r.title); return { created: true }; }, () => false, { stateful: true });
  assert.equal(result, "Both made.");
  assert.deepEqual(ran, ["L1", "L2"]);
  assert.match(inputs[1], /L1[\s\S]*L2/);
});
test("running out of tool calls asks for the final answer instead of discarding the work", async () => {
  let calls = 0;
  const result = await runKinetraTurn("m", "", async (input) => (/No tool calls are left/.test(input) ? "The document covers parts 1-40; ask to continue." : '{"kinetra":{"action":"pdf"}}'), async () => { calls++; return { created: true }; }, () => false, { stateful: true });
  assert.equal(calls, MAX_CALLS);
  assert.match(result, /ask to continue/);
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
  assert.equal(count, MAX_CALLS);
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
    assert.match(guide, /---\r?\nname: /);
    assert.match(guide, /action":"call"/);
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

test("a document already made is replayed as its outline, a failed one in full", async () => {
  const inputs: string[] = [];
  const long = "Detailed explanation. ".repeat(5000);
  const spec = { action: "pdf", title: "Lecture 1", sections: [{ heading: "Enzymes", text: long }] };
  const replies = [JSON.stringify({ kinetra: spec }), JSON.stringify({ kinetra: { ...spec, title: "Lecture 2" } }), "Both documents are ready."];
  let created = 0;
  await runKinetraTurn("Make a PDF for each lecture.", "", async (input) => { inputs.push(input); return replies.shift()!; },
    async (request) => (request.title === "Lecture 1" ? { created: true, file: { id: "a" } } : (created++, { error: "figure failed" })), () => false);
  assert.equal(created, 1);
  assert.ok(!inputs[1].includes(long) && inputs[1].includes("Enzymes"));
  assert.ok(inputs[2].includes(long));
});
test("without a thread, old file passages are dropped to stay within the model's window, newest kept", async () => {
  const inputs: string[] = [];
  let n = 0;
  const result = await runKinetraTurn("m", "", async (input) => { inputs.push(input); return n++ < 3 ? `{"kinetra":{"action":"read","file":"f${n}"}}` : "Done."; },
    async (r) => ({ file: r.file, from: 0, to: 30_000, text: r.file + ":" + "x".repeat(30_000) }), () => false, { limit: 70_000 });
  assert.equal(result, "Done.");
  assert.ok(inputs.every((input) => input.length <= 70_000), "every request fits");
  assert.match(inputs[3], /f3:x/, "the newest passage is kept");
  assert.match(inputs[3], /dropped to keep the request/);
  assert.doesNotMatch(inputs[3], /No tool calls are left/, "dropping old text does not end the turn");
});
test("a model that asks for another tool after none are left still gives the answer it wrote", async () => {
  const result = await runKinetraTurn("m", "", async (input) => (/No tool calls are left/.test(input) ? 'The document covers parts 1-40.\n{"kinetra":{"action":"pdf"}}' : '{"kinetra":{"action":"pdf"}}'), async () => ({ created: true }), () => false, { stateful: true });
  assert.equal(result, "The document covers parts 1-40.");
});

test("a planned document is finished before the answer is accepted, without the person asking for more", async () => {
  const { unwritten } = await import("../../desktop/pdf-document.ts");
  const plan = ["Introduction", "Kinematics", "Dynamics", "Energy", "Conclusions"];
  let sections: { heading: string; text?: string }[] = [];
  const replies = [
    '{"kinetra":{"action":"pdf","title":"Mechanics","plan":["Introduction","Kinematics","Dynamics","Energy","Conclusions"],"sections":[{"heading":"Introduction"},{"heading":"Kinematics"}]}}',
    "Here is your document.",
    '{"kinetra":{"action":"pdf","revise":"d","append":true,"sections":[{"heading":"3. Dynamics","text":"### Energy\\nWork."}]}}',
    "Done now?",
    '{"kinetra":{"action":"pdf","revise":"d","append":true,"sections":[{"heading":"Conclusions"}]}}',
    "The document is complete.",
  ];
  const inputs: string[] = [];
  const result = await runKinetraTurn("Explain mechanics as a PDF", "", async (input) => { inputs.push(input); return replies.shift()!; },
    async (request) => { sections = [...sections, ...request.sections]; return { created: true, remaining: unwritten({ plan, sections }) }; }, () => false,
    { stateful: true, unfinished: () => { const missing = unwritten({ plan, sections }); return missing.length ? "still missing: " + missing.join(", ") : undefined; } });
  assert.equal(result, "The document is complete.");
  assert.match(inputs[2], /still missing: Dynamics, Energy, Conclusions/);
  assert.match(inputs[4], /still missing: Conclusions/, "a ### subheading counts as written");
  // No progress twice in a row: the answer goes through rather than looping.
  const stuck = ["Answer A", "Answer B", "Answer C"];
  assert.equal(await runKinetraTurn("m", "", async () => stuck.shift()!, async () => 1, () => false, { unfinished: () => "missing X" }), "Answer C");
});

test("a described design is built on top of the layout, and the defaults apply only without one", async () => {
  const { documentHtml, renderFigures, designProblems, cleanCss } = await import("../../desktop/pdf-document.ts");
  const spec = { kind: "report", title: "T", design: { accent: "#0b5394", columns: 2 as const, pageSize: "Letter" as const, margin: 18, fontSize: 11, titleAlign: "left" as const, runningHead: false, css: "h2{text-transform:uppercase}" }, sections: ["A", "B", "C", "D"].map((heading) => ({ heading, text: "x" })) };
  const html = documentHtml(spec, await renderFigures(spec));
  assert.match(html, /body class="layout-technical numbered eqnum accented columns-2 title-left t-(?:ruled|center|left) h-accent"/);
  // "margin" sets the sides; the top and bottom keep room for the running head and folio.
  assert.match(html, /@page\{size:Letter;margin:25mm 18mm 23mm;/);
  assert.ok(!/@top-center/.test(html), "no running head when the design turns it off");
  assert.match(html, /body\{--accent:#0b5394\}body\{font-size:11pt;line-height:[\d.]+\}h2\{text-transform:uppercase\}<\/style>/);
  const plain = documentHtml({ title: "T", design: { numbered: false, contents: true }, sections: [{ heading: "A", text: "x" }, { heading: "B", text: "y" }] }, []);
  assert.match(plain, /class="doc-toc"/);
  assert.ok(!/<span class="num">/.test(plain));
  assert.deepEqual(designProblems({ accent: "blue", columns: 3, colour: 1 }).length, 3);
  assert.equal(cleanCss("@import url(x.css); h1{font-family:'Mowafy Serif';color:red} body{background:url(http://x)}</style>"), " h1{color:red} body{background:none}");
});

test("a chat visual goes into a PDF unchanged: through mowr.visual, and in an exported answer where it stood", async () => {
  const { markdownDocument, renderFigures, documentHtml } = await import("../../desktop/pdf-document.ts");
  const chart = { kind: "chart", title: "Sales", caption: "Quarterly sales in units", chart: { type: "bar", labels: ["Q1", "Q2"], series: [{ name: "2026", values: [3, 5] }] } };
  const svg = await kinetraCall({ module: "mowr", fn: "visual", args: [chart] });
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  assert.match(String(await kinetraTool({ action: "help" })), /"fn":"visual"/);
  const answer = "# Sales review\n\n## Results\nSales grew.\n```visual\n" + JSON.stringify(chart) + "\n```\nThe second quarter was stronger.\n```visual\n{broken\n```\n## Outlook\nSteady.";
  const spec = markdownDocument(answer);
  assert.equal(spec.title, "Sales review");
  assert.deepEqual(spec.sections.map((s) => [s.heading, !!s.figure]), [["Results", true], [undefined, false], ["Outlook", false]]);
  assert.equal(spec.sections[0].caption, "Quarterly sales in units");
  assert.match(spec.sections[1].text!, /second quarter/);
  assert.ok(!JSON.stringify(spec).includes("broken"), "an unreadable visual is left out");
  const html = documentHtml(spec, await renderFigures(spec, { checkVoice: false }));
  assert.match(html, /<figure id="fig-1"><a class="figure-slot"[^>]*><img[^>]+data:image\/svg\+xml;base64,/);
  assert.match(html, /Figure&#160;1:<\/span> Quarterly sales in units/);
  // An answer whose visual cannot be drawn still exports, without that figure; a document the AI writes is refused instead.
  const bad = markdownDocument("Text\n```visual\n" + JSON.stringify({ kind: "chart", title: "x" }) + "\n```");
  assert.equal((await renderFigures(bad, { checkVoice: false })).filter(Boolean).length, 0);
  await assert.rejects(renderFigures({ title: "T", sections: [{ text: "This report shows a chart.", figure: { module: "mowr", fn: "visual", args: [{ kind: "chart", title: "x" }] } }] }), /needs labels and series/);
});

test("a lost provider session falls back to resending everything, and a session saves most of what a long document task sends", async () => {
  const { SessionLost } = await import("../../desktop/kinetra-turn.ts");
  // A 12-part document: every part is a tool call carrying its text; each reply asks for the next part.
  const part = (n: number) => `{"kinetra":{"action":"pdf","revise":"d","append":true,"sections":[{"heading":"Part ${n}","text":"${"w".repeat(4000)}"}]}}`;
  const run = async (stateful: boolean, lose = -1) => {
    let step = 0, characters = 0;
    const answer = await runKinetraTurn("m", "INSTRUCTIONS " + "i".repeat(20000), async (input, followUp) => {
      if (followUp && step === lose) throw new SessionLost("gone");
      characters += input.length;
      return ++step <= 12 ? part(step) : "Finished.";
    }, async () => ({ created: true, file: { id: "d", name: "d.pdf", size: 1 } }), () => false, { stateful });
    return { answer, characters, step };
  };
  const without = await run(false), withSession = await run(true), lost = await run(true, 6);
  console.log(`characters sent on a 12-part document task: no session ${without.characters}, session ${withSession.characters} (${(without.characters / withSession.characters).toFixed(1)}× fewer), session lost at step 6 ${lost.characters}`);
  assert.equal(withSession.answer, "Finished.");
  assert.ok(withSession.characters * 3 < without.characters);
  // Losing the session costs one full resend, then the rest of the turn is stateless, and the answer still arrives.
  assert.equal(lost.answer, "Finished.");
  assert.ok(lost.characters > withSession.characters && lost.step === 13);
});
test("an example request in a ```text block is shown as part of the answer, never run", async () => {
  const example = 'Send this to look something up:\n```text\n{"kinetra":{"action":"help"}}\n```';
  assert.equal(toolRequests(example), null);
  assert.equal(brokenToolRequest(example), null);
  assert.equal(toolRequests('Unclosed example:\n```text\n{"kinetra":{"action":"help"}}'), null);
  assert.equal(brokenToolRequest('Broken example:\n```text\n{"kinetra":{"action":"pdf"\n```'), null);
  // A real request after an example still runs.
  assert.deepEqual(toolRequests(example + '\nNow I will check.\n```json\n{"kinetra":{"action":"call","fn":"a"}}\n```'), [{ action: "call", fn: "a" }]);
  let ran = 0;
  const result = await runKinetraTurn("m", "", async () => example, async () => { ran++; return 1; }, () => false);
  assert.equal(result, example);
  assert.equal(ran, 0);
});
test("a model that keeps sending broken requests stops after a few: its text is the answer, or a clear error", async () => {
  const broken = 'Here is the summary of the circuit.\n{"kinetra":{"action":"pdf","sections":[{"heading":"Q1"';
  let replies = 0;
  const result = await runKinetraTurn("m", "", async () => { replies++; return broken; }, async () => 1, () => false);
  assert.equal(result, "Here is the summary of the circuit.");
  assert.equal(replies, MAX_BROKEN);
  replies = 0;
  await assert.rejects(() => runKinetraTurn("m", "", async () => { replies++; return '{"kinetra":{"action":"pdf"'; }, async () => 1, () => false), new RegExp(`${MAX_BROKEN} tool requests in a row that could not run`));
  assert.equal(replies, MAX_BROKEN);
  // A request that runs resets the count.
  const sequence = [broken, broken, '{"kinetra":{"action":"call"}}', broken, broken, "Done."];
  let calls = 0;
  // The timing log counts every step, the call that ran and each broken request sent back.
  const stats = { steps: 0, calls: 0, broken: 0 };
  assert.equal(await runKinetraTurn("m", "", async () => sequence.shift()!, async () => { calls++; return 1; }, () => false, { stats }), "Done.");
  assert.equal(calls, 1);
  assert.deepEqual(stats, { steps: 6, calls: 1, broken: 4 });
});
test("streaming keeps showing an example quoted earlier and holds only the request that may end the reply", () => {
  const quoted = 'A request looks like {"kinetra":{"action":"help"}} and Mowr runs it. ';
  assert.equal(shownLength(quoted + "More prose."), (quoted + "More prose.").length);
  assert.equal(shownLength(quoted + 'Let me check.\n{"kinetra":{"act'), (quoted + "Let me check.\n").length);
  assert.equal(shownLength(quoted + 'Now:\n```json\n{"kinetra":{"action":"call"}}\n```\n{"kinetra":{"act'), (quoted + "Now:\n").length);
  assert.equal(shownLength(quoted + 'Now {"kinetra"'), (quoted + "Now ").length);
  assert.equal(shownLength(quoted + "Now {"), (quoted + "Now ").length);
  assert.equal(shownLength('Example:\n```text\n{"kinetra":{"action":"help"}}\n```\nThat is all.'), 'Example:\n```text\n{"kinetra":{"action":"help"}}\n```\nThat is all.'.length);
});
test("a request with a note after it still runs, and its JSON is never shown as the note", async () => {
  const reply = 'Last three planned sections: Questions 7 and 8, then the answer summary.{"kinetra":{"action":"pdf","revise":"d","append":true,"sections":[{"heading":"Question 7"}]}}\nThen Question 8 follows.';
  assert.deepEqual(toolRequests(reply), [{ action: "pdf", revise: "d", append: true, sections: [{ heading: "Question 7" }] }]);
  assert.equal(brokenToolRequest(reply), null);
  assert.equal(requestLead(reply), "Last three planned sections: Questions 7 and 8, then the answer summary.");
  assert.equal(shownLength(reply), reply.indexOf("{"));
  // Two requests with a note between them both run.
  assert.deepEqual(toolRequests('First:\n{"kinetra":{"action":"call","fn":"a"}}\nNow the second.\n{"kinetra":{"action":"call","fn":"b"}}'), [{ action: "call", fn: "a" }, { action: "call", fn: "b" }]);
  // A broken one is held back from the note too.
  const cut = 'Next part.{"kinetra":{"action":"pdf","sections":[{"heading":"Q7","text":"Find';
  assert.equal(requestLead(cut), "Next part.");
  // A cut-off request is sent back with the advice to split it.
  const sent: string[] = [];
  await runKinetraTurn("m", "", async (input) => { sent.push(input); return sent.length === 1 ? cut : "Done."; }, async () => 1, () => false);
  assert.match(sent[1], /cut off before it closed/);
});

test("independent requests in one reply run side by side; file making and look keep their order; results keep the request order", async () => {
  const reply = ["a", "b", "c"].map((fn) => JSON.stringify({ kinetra: { action: "call", fn } })).join("\n") + "\n" + JSON.stringify({ kinetra: { action: "pdf", title: "T" } }) + "\n" + JSON.stringify({ kinetra: { action: "call", fn: "d" } });
  const log: string[] = [];
  let active = 0, most = 0;
  // "a" is the slowest, so it finishes last of the three.
  const delay: Record<string, number> = { a: 60, b: 10, c: 30, d: 5 };
  const sent: string[] = [];
  const result = await runKinetraTurn("m", "", async (input) => { sent.push(input); return sent.length === 1 ? reply : "Done."; }, async (request) => {
    const name = request.fn || request.action;
    active++; most = Math.max(most, active); log.push("start " + name);
    await new Promise((resolve) => setTimeout(resolve, delay[name] ?? 5));
    active--; log.push("end " + name);
    return name + " ok";
  }, () => false);
  assert.equal(result, "Done.");
  assert.equal(most, Math.min(3, MAX_PARALLEL), "a, b and c ran at the same time");
  // The PDF waits for every call before it, and the call after it waits for the PDF.
  assert.ok(log.indexOf("start pdf") > log.indexOf("end a"));
  assert.ok(log.indexOf("start d") > log.indexOf("end pdf"));
  const results = [...sent[1].matchAll(/"result":"(\w+) ok"/g)].map((m) => m[1]);
  assert.deepEqual(results, ["a", "b", "c", "pdf", "d"]);
});

test("Kinetra calls share a few warm workers; one that times out or stops is replaced", async () => {
  const integral = { module: "mowr", fn: "integrateExpression", args: ["x^2", "x", 0, 1] };
  assert.ok(Math.abs((await kinetraCall(integral)) - 1 / 3) < 1e-8);
  const [warm] = kinetraPool.workers();
  // Later calls reuse the loaded worker instead of starting one each time.
  for (let i = 0; i < 5; i++) await kinetraCall(integral);
  assert.equal(kinetraPool.workers()[0], warm);
  // Many at once are spread over at most MAX_PARALLEL workers and all answered.
  const many = await Promise.all(Array.from({ length: 12 }, () => kinetraCall(integral)));
  assert.equal(many.length, 12);
  assert.ok(kinetraPool.workers().length <= MAX_PARALLEL);
  // A call over the time limit fails as before, and its worker is thrown away.
  const pulley = (kinetraRecipes as any[]).find((r) => r.figure.fn === "renderPulley").figure;
  const before = kinetraPool.workers().length;
  kinetraPool.callMs = 1;
  try {
    await assert.rejects(kinetraCall(pulley), /timed out/);
  } finally {
    kinetraPool.callMs = 30_000;
  }
  assert.equal(kinetraPool.workers().length, before - 1);
  // Workers that stop mid-call (a crash) fail that call; they leave the pool and the next call gets a fresh worker.
  const running = kinetraCall(pulley);
  const stopped = kinetraPool.workers();
  const exits = stopped.map((worker) => worker.terminate());
  await assert.rejects(running, /stopped without a result/);
  await Promise.all(exits);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(!kinetraPool.workers().some((worker) => stopped.includes(worker)));
  assert.ok(Math.abs((await kinetraCall(integral)) - 1 / 3) < 1e-8);
});

test("a request that only lacks its closing brackets runs at once, and its result says it was closed", async () => {
  // Grok dropped the final "}" of a whole PDF request: it used to be sent back as "cut off" and then written one section per step.
  const reply = 'Writing the notes now.\n{"kinetra":{"action":"pdf","kind":"notes","title":"Assignment 1","sections":[{"heading":"Question 1","text":"$V=IR$ gives \\(V=12\\,\\mathrm{V}\\)."},{"figure":{"asset":"crop-1","source":true},"caption":"Figure 1."}]}';
  assert.ok(brokenToolRequest(reply));
  assert.ok(closedRequest(reply));
  const ran: any[] = [], sent: string[] = [];
  const answer = await runKinetraTurn("m", "", async (input) => { sent.push(input); return sent.length === 1 ? reply : "Done."; }, async (r) => { ran.push(r); return { created: true }; }, () => false, { stateful: true });
  assert.equal(answer, "Done.");
  assert.equal(ran.length, 1);
  assert.equal(ran[0].sections.length, 2);
  assert.match(sent[1], /missing its closing brackets; Mowr closed it/);
  assert.doesNotMatch(sent[1], /cut off/);
  // Cut off inside a string, after a key or a comma, or right after a bare value may be a real cut-off: not closed.
  assert.equal(closedRequest('{"kinetra":{"action":"pdf","sections":[{"heading":"Q7","text":"Find'), null);
  assert.equal(closedRequest('{"kinetra":{"action":"pdf","sections":[{"heading":"Q7",'), null);
  assert.equal(closedRequest('{"kinetra":{"action":"pdf","sections":[{"heading"'), null);
  assert.equal(closedRequest('{"kinetra":{"action":"pdf","sections":[{"heading":"Q1"'), null);
  // A complete request or prose is left alone.
  assert.equal(closedRequest('{"kinetra":{"action":"help"}}'), null);
  assert.equal(closedRequest("Just an answer."), null);
  // Several requests, the last one unclosed: all of them run.
  assert.deepEqual(toolRequests(closedRequest('{"kinetra":{"action":"call","fn":"a"}}\n{"kinetra":{"action":"call","fn":"b","args":[1]}')!), [{ action: "call", fn: "a" }, { action: "call", fn: "b", args: [1] }]);
});

test("each step asks for every request already known in one reply", async () => {
  const sent: string[] = [];
  await runKinetraTurn("m", "", async (input) => { sent.push(input); return sent.length === 1 ? '{"kinetra":{"action":"call","fn":"a"}}' : "Done."; }, async () => 1, () => false, { stateful: true });
  assert.match(sent[1], /every one you already know you need, together in this reply/);
});
