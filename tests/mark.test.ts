import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MARK_BODY, MARK_LEAF, MARK_PATH, markOutline, tumbleKeyframes } from "../core/mark.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the pages that cannot import core/mark.ts carry the same drawing", () => {
  // public/404.html no longer draws the mark; the test below still keeps the old C and the hop out of it.
  for (const page of ["public/boot.js"]) assert.ok(read(page).includes(MARK_PATH), `${page} draws an old mark`);
});

test("the old C and hopping cursors are gone", () => {
  for (const file of ["public/boot.js", "public/404.html", "src/Icons.tsx", "src/revamp.css", "src/local/StudyPack.tsx", "desktop/browser-login.ts"]) {
    const text = read(file);
    assert.ok(!text.includes("M72.29 29.93"), `${file} still draws the C`);
    assert.ok(!text.includes("clem-hop") && !text.includes("boot-hop"), `${file} still hops`);
  }
});

test("the tumble is the same in the app and in core/mark.ts", () => {
  assert.ok(read("src/revamp.css").includes(tumbleKeyframes()));
  assert.ok(read("public/boot.js").includes(tumbleKeyframes("clem-boot-tumble")));
});

test("the mark's outlines sample into closed loops inside the 100-unit box", () => {
  for (const path of [MARK_BODY, MARK_LEAF]) {
    const points = markOutline(path), [first, last] = [points[0], points.at(-1)!];
    assert.ok(Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.01);
    assert.ok(points.every(([x, y]) => x > 0 && x < 100 && y > 0 && y < 100));
  }
});
