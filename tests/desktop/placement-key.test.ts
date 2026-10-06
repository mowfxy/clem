import test from "node:test";
import assert from "node:assert/strict";
import { placementKey, type CropSpot } from "../../desktop/pdf-assets.ts";

const A4: [number, number] = [595, 842];
const spot = (over: Partial<CropSpot> = {}): CropSpot => ({ id: "crop-0000aaaa", figure: 1, page: 2, rect: [150, 300, 445, 520], sheet: A4, ...over });

test("a figure counts as moved only when its page, size or side changes, not when text above it reflows", () => {
  const key = placementKey(spot());
  // A contents list one line longer pushes everything down a little: the same placement to judge.
  assert.equal(placementKey(spot({ rect: [150, 286, 445, 506] })), key);
  // Pushed onto the next page, made narrower, or moved beside the text: shown again.
  assert.notEqual(placementKey(spot({ page: 3 })), key);
  assert.notEqual(placementKey(spot({ rect: [220, 300, 375, 520] })), key);
  assert.notEqual(placementKey(spot({ rect: [345, 300, 545, 520] })), key);
  // Starting the page (where a pushed figure leaves a gap on the page before) is part of where it sits.
  assert.notEqual(placementKey(spot({ rect: [150, 560, 445, 780] })), key);
  // Another figure on the same spot is its own placement.
  assert.notEqual(placementKey(spot({ id: "crop-0000bbbb", figure: 2 })), key);
});
