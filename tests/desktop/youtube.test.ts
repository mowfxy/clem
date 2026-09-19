import test from "node:test";
import assert from "node:assert/strict";
import { youtubeReference, youtubeReferences } from "../../src/youtube.ts";
test("YouTube references canonicalize supported URLs, preserve timestamps and reject foreign hosts", () => {
  assert.equal(
    youtubeReference("https://youtu.be/abcdefghijk?t=1m30s")?.start,
    90,
  );
  assert.equal(
    youtubeReference("https://www.youtube.com/shorts/abcdefghijk")?.id,
    "abcdefghijk",
  );
  for (const url of [
    "https://youtube.com.evil.test/watch?v=abcdefghijk",
    "javascript:alert(1)",
    "https://youtube.com/watch?v=bad",
    "https://user@youtube.com/watch?v=abcdefghijk",
  ])
    assert.equal(youtubeReference(url), null);
  assert.equal(
    youtubeReferences(
      "[Video](https://youtu.be/abcdefghijk). https://www.youtube.com/watch?v=abcdefghijk",
    ).length,
    1,
  );
});
