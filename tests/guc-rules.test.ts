import { test } from "node:test";
import assert from "node:assert/strict";
import { aiSaveRules, applyRules, convertSaveRules, defaultSaveRules, describeSaveRules, fromAi, matches, materialType, rulesPatch, weekNumbers, type SaveRules } from "../core/guc/rules.ts";
import { readCard } from "../core/guc/cards.ts";
import { readAiReply, readReply, updatePatch, updateSummary } from "../core/guc/setup-flow.ts";
import { mergeSettings, settingsPatch } from "../core/guc/settings.ts";

const d = defaultSaveRules();
const kinds = (r: SaveRules) => Object.entries(r.kinds).filter(([, v]) => v).map(([k]) => k).sort().join(",");
type Row = [text: string, kinds: string | null, filters?: Partial<Omit<SaveRules, "kinds">>, base?: SaveRules];
const ALL = "assignments,links,other,sheets,slides,videos";
const everything = applyRules(d, { kinds: { videos: true, links: true } });

// The person's words → kinds and filters. null: the AI's turn.
const rows: Row[] = [
  ["all lecture slides", "slides"],
  ["only slides", "slides"],
  ["slides only", "slides"],
  ["just slides and assignments", "assignments,slides"],
  ["slides, sheets", "sheets,slides"],
  ["only PDFs", ALL, { types: { only: ["pdf"] } }],
  ["just the slides as pdfs", "slides", { types: { only: ["pdf"] } }],
  ["everything except videos", "assignments,links,other,sheets,slides"],
  ["everything but links", "assignments,other,sheets,slides,videos"],
  ["save everything except videos and links", "assignments,other,sheets,slides"],
  ["everything except zip files", ALL, { types: { except: ["archive"] } }],
  ["all of it", ALL],
  ["nothing, I'll open on demand", ""],
  ["nothing", ""],
  ["don't download anything", ""],
  ["slides and sheets under 50MB", "sheets,slides", { maxMB: 50 }],
  ["slides under 1.5 GB", "slides", { maxMB: 1536 }],
  ["no files over 100MB", "assignments,other,sheets,slides", { maxMB: 100 }],
  ["only week 3 onwards", "assignments,other,sheets,slides", { weeks: { from: 3 } }],
  ["from week 4", "assignments,other,sheets,slides", { weeks: { from: 4 } }],
  ["the third week onwards", "assignments,other,sheets,slides", { weeks: { from: 3 } }],
  ["weeks 2-5", "assignments,other,sheets,slides", { weeks: { from: 2, to: 5 } }],
  ["until week 6", "assignments,other,sheets,slides", { weeks: { to: 6 } }],
  ["all slides except week 1", "slides", { weeks: { from: 2 } }],
  ["PDFs from week 3", ALL, { types: { only: ["pdf"] }, weeks: { from: 3 } }],
  ["files named Lab*", ALL, { names: { only: ["Lab*"] } }],
  ["only files starting with Lecture", ALL, { names: { only: ["Lecture*"] } }],
  ['slides not named "Old*"', "slides", { names: { except: ["Old*"] } }],
  ["stop saving videos", "assignments,links,other,sheets,slides", undefined, everything],
  ["no videos", "assignments,links,other,sheets,slides", undefined, everything],
  ["don't save videos", "assignments,other,sheets,slides"],
  ["no links", "assignments,other,sheets,slides"],
  ["no PDFs", "assignments,other,sheets,slides", { types: { except: ["pdf"] } }],
  ["save the lecture recordings too", "assignments,other,sheets,slides,videos"],
  ["also save videos", "assignments,other,sheets,slides,videos"],
  ["slides and assignments but not videos", "assignments,slides"],
  ["sounds good", "assignments,other,sheets,slides"],
  ["hmm what do you think is best for an exam?", null],
  ["keep whatever matters for the final", null],
  ["only slides except slides", null],
  ["files over 50MB", null],
  ["skip week 3", null],
  ["", null],
  ["no", null],
];
test("save rules: the person's words become kinds and filters, or the AI's turn", () => {
  for (const [text, want, filters = {}, base = d] of rows) {
    const r = convertSaveRules(text, base);
    if (want === null) { assert.ok("needsAI" in r, `${text} → AI`); continue; }
    assert.ok(!("needsAI" in r), `${text} is read locally`);
    assert.equal(kinds(r.rules), want, text);
    const { kinds: _k, ...rest } = r.rules;
    assert.deepEqual(rest, filters, text);
    assert.equal(r.summary, describeSaveRules(r.rules));
  }
});

test("save rules: a change keeps the filters it doesn't mention; a new statement starts clean", () => {
  const pdfs = (convertSaveRules("PDFs from week 3") as { rules: SaveRules }).rules;
  const noVideos = convertSaveRules("stop saving videos", pdfs) as { rules: SaveRules };
  assert.deepEqual(noVideos.rules.types, { only: ["pdf"] });
  assert.deepEqual(noVideos.rules.weeks, { from: 3 });
  const fresh = convertSaveRules("only slides", pdfs) as { rules: SaveRules };
  assert.equal(fresh.rules.types, undefined);
  assert.equal(fresh.rules.weeks, undefined);
  const under = convertSaveRules("under 20mb", pdfs) as { rules: SaveRules };
  assert.deepEqual([under.rules.maxMB, under.rules.types?.only], [20, ["pdf"]], "a filter alone adds to what's there");
});

test("save rules in words for the card", () => {
  assert.equal(describeSaveRules(d), "Slides, assignments, tutorials and sheets and other files");
  assert.equal(describeSaveRules(applyRules(d, { kinds: { slides: false, assignments: false, sheets: false, other: false } })), "Nothing (open files on demand)");
  assert.equal(describeSaveRules(everything), "Everything");
  assert.equal(describeSaveRules(applyRules(everything, { kinds: { videos: false } })), "Everything except videos");
  assert.equal(describeSaveRules(applyRules(d, { types: { only: ["pdf", "powerpoint"] }, weeks: { from: 2, to: 2 }, names: { except: ["Old*"] }, maxMB: 2048 })),
    "Slides, assignments, tutorials and sheets and other files · PDFs and PowerPoint files only · week 2 only · not named Old* · under 2 GB");
});

const pdf = (title: string, kind = "Lecture slides", file = title.toLowerCase().replace(/\s+/g, "-") + ".pdf") => ({ title, kind, url: "https://cms.guc.edu.eg/Uploads/1/2/" + file });
// Rule × material × week/size → kept?
const cases: [rules: string, m: ReturnType<typeof pdf>, o: { week?: number; size?: number }, kept: boolean][] = [
  ["only slides", pdf("Lecture 3"), {}, true],
  ["only slides", pdf("Tutorial 3", "Assignment"), {}, false],
  ["only PDFs", pdf("Lab 2", "File", "lab2.zip"), {}, false],
  ["only PDFs", pdf("Lab 2", "File"), {}, true],
  ["everything except zip files", pdf("Code", "File", "code.zip"), {}, false],
  ["everything except videos", { title: "Recorded lecture", kind: "Video", url: "https://cms.guc.edu.eg/Uploads/1/2/rec.mp4" }, {}, false],
  ["week 3 onwards", pdf("Lecture 1"), { week: 1 }, false],
  ["week 3 onwards", pdf("Lecture 3"), { week: 3 }, true],
  ["week 3 onwards", pdf("Lecture 3"), {}, true],
  ["weeks 2-4", pdf("Lecture 5"), { week: 5 }, false],
  ["files named Lab*", pdf("lab 4 sheet", "File"), {}, true],
  ["files named Lab*", pdf("Final notes", "File", "LAB-final.pdf"), {}, true],
  ["files named Lab*", pdf("Lecture 1"), {}, false],
  ["slides under 50MB", pdf("Lecture 1"), { size: 49 * 1024 * 1024 }, true],
  ["slides under 50MB", pdf("Lecture 1"), { size: 51 * 1024 * 1024 }, false],
  ["slides under 50MB", pdf("Lecture 1"), {}, true],
  ["nothing", pdf("Lecture 1"), {}, false],
];
test("matches: what a rule keeps", () => {
  for (const [words, m, o, kept] of cases) {
    const r = convertSaveRules(words) as { rules: SaveRules };
    assert.equal(matches(r.rules, m, o), kept, `${words} · ${m.title} ${JSON.stringify(o)}`);
  }
  assert.equal(materialType({ url: "https://cms.guc.edu.eg/a/b/Slides%20v2.PPTX" }), "powerpoint");
  assert.equal(materialType({ title: "Course site", kind: "Link", url: "https://example.com" }), undefined);
});

test("week numbers count from the oldest week; undated weeks keep CMS order (newest first)", () => {
  assert.deepEqual([...weekNumbers(["Week: 2026-11-07", "Week: 2026-10-31", "Week: 2026-11-07", "Week: 2026-10-24"])], [["Week: 2026-10-24", 1], ["Week: 2026-10-31", 2], ["Week: 2026-11-07", 3]]);
  assert.deepEqual(["Week 3", "Week 1"].map((w) => weekNumbers(["Week 3", "Week 2", "Week 1"]).get(w)), [3, 1]);
});

test("the AI's save rules pass a strict schema", () => {
  assert.equal(aiSaveRules.safeParse({ kinds: { slides: true }, types: { only: ["pdf"] }, weeks: { from: 3 }, names: { only: ["Lab*"] }, maxMB: 50 }).success, true);
  for (const bad of [{ kinds: { everything: true } }, { types: { only: ["exe"] } }, { weeks: { from: 5, to: 2 } }, { maxMB: -1 }, { names: { only: ["../x"] } }, { owner: "x" }, { kinds: { slides: "yes" } }])
    assert.equal(aiSaveRules.safeParse(bad).success, false, JSON.stringify(bad));
  assert.deepEqual(fromAi({ kinds: { videos: true }, maxMB: null }, applyRules(d, { maxMB: 10 }))?.rules, applyRules(d, { kinds: { videos: true } }), "null removes a filter");
  assert.equal(fromAi({ bogus: 1 }), null);
  assert.deepEqual(readAiReply("save", { action: "set", rules: { types: { only: ["pdf"] } } }, []), { kind: "settings", patch: { save: { types: { only: ["pdf"] } } } });
  assert.deepEqual(readAiReply("save", { action: "set", rules: { types: { only: ["exe"] } } }, []), { kind: "unknown" });
});

test("typed replies and settings patches go through the same converter", () => {
  const rc = { courses: [], save: d, suggested: [] };
  const r = readReply("save", "only PDFs from week 3", rc);
  assert.equal(r.kind, "settings");
  const patch = (r as { patch: any }).patch;
  assert.equal(settingsPatch.safeParse(patch).success, true);
  const merged = mergeSettings(undefined, patch);
  assert.deepEqual([merged.save.types, merged.save.weeks], [{ only: ["pdf"] }, { from: 3 }]);
  assert.equal(mergeSettings(merged, { save: rulesPatch(d) }).save.types, undefined, "a full rule replaces the filters");
  assert.equal(mergeSettings(merged, { save: { kinds: { videos: true } } }).save.weeks?.from, 3, "a kinds change keeps them");
  assert.equal(readReply("save", "keep whatever matters for the final", rc).kind, "unknown");
});

test("the AI's settings_update: words through the converters, structure through the schemas", () => {
  const words = readCard('{"type":"settings_update","saveText":"only PDFs from week 3","checkText":"every 2 hours on weekdays 8am-10pm"}');
  assert.ok(words?.type === "settings_update");
  const p = updatePatch(words, { save: d });
  assert.deepEqual(p.save?.types, { only: ["pdf"] });
  assert.equal(p.check?.every?.minutes, 120);
  assert.deepEqual(p.check?.every?.days, [0, 1, 2, 3, 4, 6]);
  assert.equal(settingsPatch.safeParse(p).success, true);
  assert.equal(updateSummary(words), "Save rules updated · Checks updated");
  const unread = readCard('{"type":"settings_update","saveText":"whatever matters"}');
  assert.ok(unread?.type === "settings_update");
  assert.deepEqual(updatePatch(unread, { save: d }), {}, "words the converter can't read change nothing");
  const structured = readCard('{"type":"settings_update","rules":{"maxMB":20},"save":{"videos":true}}');
  assert.ok(structured?.type === "settings_update");
  assert.deepEqual(updatePatch(structured).save, { maxMB: 20, kinds: { videos: true } });
  assert.equal(readCard('{"type":"settings_update","rules":{"types":{"only":["exe"]}}}'), null, "the strict schema refuses");
  assert.equal(readCard('{"type":"settings_update","check":{"mode":"custom","times":[],"every":{"minutes":5,"from":"08:00","to":"22:00","days":[0]}}}'), null, "never more often than 30 minutes");
});
