import { test, before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { unzipSync, strFromU8 } from "fflate";
import { inflight } from "../../desktop/inflight.ts";
import { unsafeSvg } from "../../desktop/svg-safety.ts";
import { runs, strip, isMath } from "../../desktop/deck-text.ts";
import { designTheme, inferArchetype, contrast, archetypeGuide } from "../../desktop/deck-design.ts";
import { artSvg, iconSvg, iconFor, iconNames } from "../../desktop/deck-art.ts";
import { newestWithin, MAX_CHAT_CHARACTERS } from "../../src/desktop/bridge.ts";
import { requestSchema } from "../../desktop/contracts.ts";
import { excelWorkbook } from "../../desktop/xlsx-workbook.ts";
import { ReplyFiles } from "../../desktop/reply-files.ts";
import { unwritten } from "../../desktop/pdf-document.ts";
import { runKinetraTurn, SessionLost, unsupportedFlag } from "../../desktop/kinetra-turn.ts";
import { fileGuidesFor } from "../../desktop/file-guides.ts";
import { brandFont } from "../../core/print-fonts.ts";

// pptx-deck and deck-review open Chromium only when a deck is drawn: bundled with electron left out, their checks run here.
let deck: { deckProblems: (spec: any) => string[]; deckReview: (spec: any) => string[]; themes: Record<string, any>; staticFindings: (slides: any[], W: number, H: number) => { slide: number; problem: string }[]; capturePage: (contents: any, rect: any, tries?: number) => Promise<any> };
before(async () => {
  await build({
    stdin: { contents: `export {deckProblems,deckReview,themes} from "./desktop/pptx-deck.ts";export {staticFindings} from "./desktop/deck-review.ts";export {capturePage} from "./desktop/rasterize.ts";`, resolveDir: process.cwd(), loader: "ts" },
    outfile: "desktop-dist/deck-checks-test.cjs", bundle: true, platform: "node", format: "cjs", external: ["electron"], logLevel: "error",
  });
  deck = createRequire(import.meta.url)("../../desktop-dist/deck-checks-test.cjs");
});

test("a stopped answer waits for file work still running, and that work then sees it is stopped", async () => {
  const work = inflight();
  let release!: () => void, sawStop: boolean | undefined;
  const job = work.run(async (cancelled) => { await new Promise<void>((r) => (release = r)); sawStop = cancelled(); return "written"; });
  let stopped = false;
  const stopping = work.stop().then(() => { stopped = true; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stopped, false, "rollback must not start while a file is still being written");
  release();
  await stopping;
  assert.equal(await job, "written");
  assert.equal(sawStop, true);
  assert.equal(work.stopped, true);
  // A job's own cancel check still counts.
  assert.equal(await inflight().run(async (c) => c(), () => true), true);
});

test("drawings may not reach outside themselves; Kinetra-style drawings pass", () => {
  for (const ok of ['<svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#a"/><image href="data:image/png;base64,AAAA"/></svg>', '<svg><text font-family="Segoe UI">on = off</text></svg>'])
    assert.equal(unsafeSvg.test(ok), false, ok);
  for (const bad of ['<svg><image href="https://x.example/a.png"/></svg>', '<svg><image href="C:/Users/me/secret.png"/></svg>', '<svg><image xlink:href="file:///c:/a.png"/></svg>', "<svg><image href='//host/a.png'/></svg>", '<svg><style>@import url(x.css)</style></svg>', '<svg><rect style="fill:url(http://x/y)"/></svg>', '<svg onload="x()"/>', "<svg><script>1</script></svg>", "<svg><iframe/></svg>", '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///c:/a">]><svg/>'])
    assert.equal(unsafeSvg.test(bad), true, bad);
});

test("money on slides stays money; only real inline maths becomes symbols", () => {
  assert.deepEqual(runs("$1.2M retention programme for EMEA SMB").map((r) => r.text), ["$1.2M retention programme for EMEA SMB"]);
  assert.equal(strip("costs $5 and $10 a month"), "costs $5 and $10 a month");
  assert.equal(isMath("$V = IR$"), true);
  const parts = runs("Ohm: $V = IR$, **always**");
  assert.equal(parts.length, 4);
  assert.equal(parts[1].options.italic, true);
  assert.equal(parts[3].options.bold, true);
  assert.equal(strip("**Key** idea"), "Key idea");
});

test("every deck gets a design of its own: different subjects and purposes look different, and text always reads", () => {
  const lecture = designTheme({ title: "Photosynthesis: light and dark reactions", archetype: "lecture" }, deck.themes);
  const pitch = designTheme({ title: "Loop: reusable packaging", archetype: "pitch", brief: { tone: "bold" } }, deck.themes);
  const kids = designTheme({ title: "The water cycle for Year 3" }, deck.themes);
  const report = designTheme({ title: "Q3 Operations Review", brief: { purpose: "quarterly board report" } }, deck.themes);
  assert.equal(kids.archetype, "kids");
  assert.equal(report.archetype, "report");
  const looks = [lecture, pitch, kids, report].map((t) => `${t.accent}|${t.head}|${t.cover}|${t.art}`);
  assert.equal(new Set(looks).size, 4, looks.join("\n"));
  for (const t of [lecture, pitch, kids, report]) {
    assert.ok(contrast(t.text, t.bg) >= 7, "body text");
    assert.ok(contrast(t.muted, t.bg) >= 4.5, "muted text");
    assert.ok(contrast(t.accent, t.bg) >= 4.5, "accent used as small text");
    assert.ok(contrast(t.accent2, t.bg) >= 3 && contrast(t.accent3, t.bg) >= 3, "other accents");
  }
  // The same deck always gets the same design.
  assert.deepEqual(designTheme({ title: "Loop: reusable packaging", archetype: "pitch", brief: { tone: "bold" } }, deck.themes), pitch);
  // Brand colours and fonts win; Mowr's own fonts never go into a file; asked-for colours that would not read are corrected.
  const brand = designTheme({ title: "Northwind", brand: { primary: "#7B2D26", headingFont: "Rockwell", bodyFont: "Mowafy Sans" } }, deck.themes);
  assert.equal(brand.accent, "7B2D26");
  assert.equal(brand.head, "Rockwell");
  assert.notEqual(brand.body, "Mowafy Sans");
  const pale = designTheme({ title: "x", theme: { text: "#EEEEEE", background: "#FFFFFF" } }, deck.themes);
  assert.ok(contrast(pale.text, pale.bg) >= 7);
  // Presets still work as a starting point.
  assert.equal(designTheme({ title: "x", theme: { preset: "noir" } }, deck.themes).head, "Garamond");
  assert.equal(inferArchetype("PhD thesis defence: graph networks"), "defence");
  assert.equal(inferArchetype("Seed round pitch for investors"), "pitch");
  assert.equal(inferArchetype("Design thinking workshop"), "workshop");
  assert.match(archetypeGuide, /pitch \(an investor/);
});

test("icons and generated art are safe, deterministic drawings", () => {
  assert.equal(iconFor("goal"), "target");
  assert.equal(iconFor("rockets"), "rocket");
  assert.equal(iconFor("no-such-icon"), undefined);
  assert.ok(iconNames.length >= 60);
  for (const style of ["line", "solid", "badge"] as const) assert.equal(unsafeSvg.test(iconSvg("rocket", style, "0E7EC8", "FFFFFF")), false);
  const colors = { bg: "F5F9FC", accent: "0E7EC8", accent2: "B61676", accent3: "679B17", dark: false };
  for (const art of ["orbits", "waves", "blocks", "contours", "confetti", "grid", "rays", "leaves", "stripes", "none"] as const) {
    const svg = artSvg(art, 42, 480, 750, colors);
    assert.equal(unsafeSvg.test(svg), false, art);
    assert.equal(svg, artSvg(art, 42, 480, 750, colors), art + " is deterministic");
    if (art !== "none") assert.notEqual(svg, artSvg(art, 43, 480, 750, colors), art + " varies by deck");
  }
});

test("new layouts are validated, and the review speaks to the story, not only the pixels", () => {
  const ok = { title: "T", archetype: "pitch", slides: [
    { layout: "title" }, { layout: "statement", statement: "Takeaway waste is a solved problem." }, { layout: "big-number", value: "41B", label: "containers" },
    { layout: "matrix", title: "Only we are both", quadrants: [{ title: "a" }, { title: "b" }, { title: "c" }, { title: "d" }], points: [{ label: "Us", x: 0.9, y: 0.9 }] },
    { layout: "roadmap", title: "Three cities in 18 months", phases: [{ label: "Now" }, { label: "2027" }], now: 0 },
    { layout: "team", title: "A team that has done it", people: [{ name: "Sara Okafor", role: "CEO" }] },
    { layout: "icons", title: "What you get", items: [{ icon: "truck", title: "Daily delivery" }, { icon: "leaf", title: "Organic" }] },
    { layout: "before-after", title: "Delivery without waste", before: { points: ["Plastic"] }, after: { text: "Reused" } },
    { layout: "diagram", title: "A loop, not a line", diagram: { type: "cycle", items: ["Deliver", "Collect", "Wash"] } },
    { layout: "image", title: "It comes back", image: { art: true } }, { layout: "closing" },
  ] };
  assert.deepEqual(deck.deckProblems(ok), []);
  const bad = deck.deckProblems({ title: "T", archetype: "sermon", slides: [{ layout: "matrix", title: "x", quadrants: [{ title: "a" }] }, { layout: "big-number" }, { layout: "diagram", title: "d", diagram: { type: "venn", items: ["a", "b", "c", "d"] } }, { layout: "image", image: { svg: '<svg><image href="https://evil/x.png"/></svg>' } }] });
  assert.equal(bad.length, 5, bad.join("\n"));
  const notes = deck.deckReview({ title: "T", brief: { minutes: 3 }, slides: [{ layout: "bullets", title: "Results", bullets: ["a"] }, ...Array.from({ length: 8 }, () => ({ layout: "bullets", title: "Point that says something", bullets: ["a"] }))] });
  for (const expect of [/topic label/, /does not open with a title/, /stops without an ending/, /rushed/, /same layout/, /all text/]) assert.ok(notes.some((n) => expect.test(n)), String(expect));
});

test("the slide review finds low contrast, text off the slide, overlaps and crowding; turned text is checked where it really is", () => {
  const text = (k: number, x: number, y: number, w: number, h: number, words: string, o: Record<string, unknown> = {}) => ({ kind: "text", k, x, y, w, h, runs: [{ text: words }], o: { fontSize: 18, color: "111111", ...o } });
  const found = deck.staticFindings([
    { bg: "FFFFFF", items: [text(0, 1, 1, 4, 1, "pale words", { color: "DDDDDD" }), text(1, 12, 1, 3, 1, "off the edge"), text(2, 1, 3, 4, 1, "first box"), text(3, 1.5, 3.2, 4, 1, "second box"), text(4, 1, 5, 8, 2, Array.from({ length: 95 }, () => "word").join(" "))] },
    // Filled shapes count as the ground: white text on a dark panel reads.
    { bg: "FFFFFF", items: [{ kind: "shape", shape: "rect", x: 0, y: 0, w: 5, h: 2, fill: "102030", alpha: 0 }, text(0, 0.5, 0.5, 4, 1, "white on dark", { color: "FFFFFF" }), text(1, -0.6, 3, 2, 0.3, "AXIS", { rotate: 270 })] },
  ], 13.333, 7.5);
  const on = (slide: number, pattern: RegExp) => found.some((f) => f.slide === slide && pattern.test(f.problem));
  assert.ok(on(1, /pale words.*low contrast/));
  assert.ok(on(1, /off the edge.*runs off/));
  assert.ok(on(1, /first box.*overlap/));
  assert.ok(on(1, /words on one slide/));
  assert.ok(!on(2, /white on dark/), "text on a filled panel is checked against the panel");
  assert.ok(!on(2, /AXIS/), "a box turned a quarter turn is checked where it is drawn");
});

test("the whole chat goes to the main process, newest first within its limits, and the contract refuses more", () => {
  const sys = { role: "system", content: "rules" };
  const chat = [sys, ...Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i).repeat(10) }))];
  const kept = newestWithin(chat, 2000, 45);
  assert.equal(kept[0], sys);
  assert.deepEqual(kept.slice(1).map((m) => m.content[0]), ["6", "7", "8", "9"]);
  assert.equal(newestWithin(chat, 4, 1e9).length, 4);
  const request = (messages: unknown[]) => requestSchema.safeParse({ action: "chat", id: crypto.randomUUID(), scope: "chat:" + crypto.randomUUID(), messages });
  assert.equal(request(Array.from({ length: 1500 }, () => ({ role: "user", content: "a long chat" }))).success, true);
  const parsed = request(Array.from({ length: 61 }, () => ({ role: "user", content: "x".repeat(1_000_000) })));
  assert.equal(parsed.success, false);
  assert.match(JSON.stringify(parsed.error?.issues), /too large/);
  assert.ok(MAX_CHAT_CHARACTERS <= 60_000_000);
});

test("a running balance over thousands of rows is calculated, and an unknown function leaves no false error", () => {
  const rows = Array.from({ length: 6000 }, (_, i) => [i + 1, i ? "=B{row}+A{row}" : "=A{row}"]);
  // B is the running total, built from the row above.
  const sheet = { name: "Ledger", columns: [{ header: "Amount" }, { header: "Balance" }], rows: rows.map((r, i) => [r[0], i ? `=B${i + 1}+A${i + 2}` : "=A2"]) };
  const bytes = excelWorkbook({ sheets: [sheet, { name: "Odd", columns: [{ header: "x" }], rows: [["=XLOOKUP(1,A1:A2,A1:A2)"]] }] } as any);
  const files = unzipSync(bytes);
  const ledger = strFromU8(files["xl/worksheets/sheet1.xml"]), odd = strFromU8(files["xl/worksheets/sheet2.xml"]);
  assert.match(ledger, /<c r="B6001"[^>]*><f>B6000\+A6001<\/f><v>18003000<\/v><\/c>/);
  assert.doesNotMatch(odd, /#NAME\?/);
});

test("Telegram replies: an empty revise is a new file, appended parts keep their references, and a plan is finished first", async () => {
  const make = async (action: string, spec: any) => ({ bytes: new TextEncoder().encode(JSON.stringify(spec)), name: (spec.title || "Doc") + "." + action, type: "application/pdf" });
  const files = new ReplyFiles(make, unwritten);
  const a = await files.handle({ action: "pdf", revise: null, title: "Notes", plan: ["One", "Two"], sections: [{ heading: "One", text: "x" }], references: ["Ref A"] });
  assert.equal(a.id, "f1");
  assert.match(files.unfinished()!, /Notes\.pdf.*lacks 1 planned section: Two/);
  await files.handle({ action: "pdf", revise: "f1", append: true, sections: [{ heading: "Two", text: "y" }], references: ["Ref B"] });
  const spec = JSON.parse(new TextDecoder().decode(files.list()[0].bytes));
  assert.deepEqual(spec.references, ["Ref A", "Ref B"]);
  assert.equal(files.unfinished(), undefined);
  await files.handle({ action: "pptx", title: "Talk", plan: ["Intro", "Ask"], slides: [{ layout: "title", title: "Intro" }] });
  assert.match(files.unfinished()!, /Talk\.pptx.*1 planned slide: Ask/);
});

test("a provider that cannot keep sessions at all falls back on the first step, and a lost session near the end still finishes", async () => {
  const seen: { followUp: boolean; input: string }[] = [];
  let first = true;
  const answer = await runKinetraTurn("question", "INSTRUCTIONS", async (input, followUp) => {
    seen.push({ followUp, input });
    if (first) { first = false; throw new SessionLost("no sessions"); }
    return "done";
  }, async () => ({}), () => false, { stateful: true });
  assert.equal(answer, "done");
  assert.equal(seen.length, 2);
  assert.match(seen[1].input, /INSTRUCTIONS[\s\S]*question/);
  assert.equal(seen[1].followUp, false);
  assert.ok(unsupportedFlag.test("error: unknown option '--session-id'"));
  assert.ok(!unsupportedFlag.test("Rate limit exceeded"));
});

test("without a session, only the newest pictures looked at are resent", async () => {
  const sent: number[] = [];
  let step = 0;
  await runKinetraTurn<string>("q", "i", async (_input, _f, pictures) => {
    sent.push(pictures.length);
    return ++step <= 20 ? '{"kinetra":{"action":"look","file":"a.pdf","pages":[1]}}' : "answer";
  }, async () => ({ attachPictures: ["p1"] }), () => false, { stateful: false });
  assert.ok(Math.max(...sent) <= 12);
});

test("with a session, the new pictures of one reply stay within the per-message limit too", async () => {
  // One reply with five "look" requests of eight pages each used to send all forty pictures in the next message.
  const sent: string[][] = [];
  let step = 0;
  const look = '{"kinetra":{"action":"look","file":"a.pdf","pages":[1,2,3,4,5,6,7,8]}}';
  let n = 0;
  await runKinetraTurn<string>("q", "i", async (_input, _f, pictures) => {
    sent.push(pictures);
    return ++step === 1 ? Array(5).fill(look).join("\n") : "answer";
  }, async () => ({ attachPictures: Array.from({ length: 8 }, () => `p${++n}`) }), () => false, { stateful: true });
  assert.equal(sent[1].length, 12);
  // The newest are kept: the ones the model asked for last.
  assert.equal(sent[1].at(-1), "p40");
});

test("the slides skill asks for a brief, an archetype, a storyline and a review, and lists the new layouts and icons", () => {
  const skill = fileGuidesFor("make a pitch deck for investors");
  for (const want of [/BRIEF FIRST/, /ARCHETYPE/, /STORYLINE/, /big-number/, /matrix/, /roadmap/, /diagram/, /REVIEW/, /rocket/, /kids/]) assert.match(skill, want);
});

test("a capture Chromium fails once is tried again; one that keeps failing still reports the error", async () => {
  const image = { isEmpty: () => false };
  let calls = 0, invalidated = 0;
  const flaky = { capturePage: async () => { if (++calls === 1) throw Error("UnknownVizError"); return image; }, invalidate: () => invalidated++ };
  assert.equal(await deck.capturePage(flaky, { x: 0, y: 0, width: 10, height: 10 }), image);
  assert.equal(calls, 2);
  assert.equal(invalidated, 1);
  const broken = { capturePage: async () => { throw Error("UnknownVizError"); }, invalidate: () => {} };
  await assert.rejects(deck.capturePage(broken, { x: 0, y: 0, width: 10, height: 10 }), /UnknownVizError/);
});

test("Mowr's own fonts are recognised wherever they are named", () => {
  for (const name of ["Mowafy Serif", "Mowr Sans", "Kindred", "Soft Ink Serif"]) assert.ok(brandFont.test(name), name);
  assert.ok(!brandFont.test("Segoe UI"));
});
