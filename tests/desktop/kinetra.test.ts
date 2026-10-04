import { test, before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { renameSync, rmSync } from "node:fs";
import { runKinetraTurn, toolRequest, toolRequests, brokenToolRequest, shownLength, MAX_CALLS } from "../../desktop/kinetra-turn.ts";
import { kinetraTool, kinetraCall } from "../../desktop/kinetra-runtime.ts";
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
  assert.match(html, /body class="layout-technical numbered eqnum accented columns-2 title-left"/);
  assert.match(html, /@page\{size:Letter;margin:18mm;/);
  assert.ok(!/@top-center/.test(html), "no running head when the design turns it off");
  assert.match(html, /body\{--accent:#0b5394\}body\{font-size:11pt;\}h2\{text-transform:uppercase\}<\/style>/);
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
  assert.match(html, /<figure id="fig-1"><img[^>]+data:image\/svg\+xml;base64,/);
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
