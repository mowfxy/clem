import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";

/**
 * Decks are drawn in Electron (icons, art and equations need Chromium, and the review measures text with the real fonts),
 * so this runs scripts/verify/office-files.mjs on three of its context decks and reads back what it wrote.
 */
test("context decks are drawn, measured and photographed, each with its own design", { timeout: 600_000 }, () => {
  const out = mkdtempSync(join(tmpdir(), "mowr-decks-"));
  const run = spawnSync(process.execPath, ["scripts/verify/office-files.mjs", out], { encoding: "utf8", timeout: 600_000, env: { ...process.env, MOWR_ONLY: "context-(pitch|kids|report)" } });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const lines = run.stdout.split("\n").filter((l) => l.startsWith("ok context-"));
  assert.equal(lines.length, 3, run.stdout);
  const designs = lines.map((l) => JSON.parse(l.slice(l.indexOf("{"))).design);
  assert.equal(new Set(designs.map((d) => JSON.stringify([d.colors.accents[0], d.fonts.heading, d.cover]))).size, 3, "three purposes, three designs");
  assert.deepEqual(designs.map((d) => d.archetype), ["pitch", "report", "kids"]);
  for (const name of ["context-pitch-loop", "context-report-q3", "context-kids-water-cycle"]) {
    const files = unzipSync(new Uint8Array(readFileSync(join(out, name + ".pptx"))));
    const slides = Object.keys(files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    assert.ok(slides.length >= 8, name);
    assert.ok(Object.keys(files).some((f) => f.startsWith("ppt/media/")), name + " has icons or art");
    assert.ok(readdirSync(out).some((f) => f.startsWith(name + ".pptx.sheet")), name + " has contact sheets for the model");
  }
  // Money stays money on slides ("$1.2M retention…" was once read as maths).
  const report = unzipSync(new Uint8Array(readFileSync(join(out, "context-report-q3.pptx"))));
  const text = Object.entries(report).filter(([f]) => /slides\/slide\d+\.xml$/.test(f)).map(([, b]) => strFromU8(b)).join("");
  assert.match(text, /\$1\.2M retention programme for EMEA SMB/);
});
