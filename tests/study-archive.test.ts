import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStudy, studyRequest } from "../core/study.ts";
import {
  archiveLimits,
  packSubject,
  unpackSubject,
  type SubjectArchive,
} from "../core/subject-archive.ts";
import { zipSync, strToU8 } from "fflate";
test("study requests and quiz indices are validated", () => {
  assert.equal(studyRequest("/quiz calculus"), "quiz");
  assert.equal(studyRequest("make flashcards from this"), "flashcards");
  assert.equal(studyRequest("I took a quiz yesterday"), null);
  assert.equal(studyRequest("Create flashcards to prepare for my quiz on Friday"), "flashcards");
  assert.equal(studyRequest("Make a quiz, then flashcards"), "quiz");
  assert.throws(() =>
    parseStudy(
      '{"title":"Quiz","items":[{"question":"Q","answer":"A","choices":["A","B"],"correct":4}]}',
      "quiz",
    ),
  );
});
test("subject archive includes source bytes and rejects missing files and unsafe entries", async () => {
  const manifest: SubjectArchive = {
    format: "mowr-subject",
    version: 1,
    space: {
      id: "subject",
      kind: "subject",
      name: "Calculus",
      description: "",
      memory: "Use examples",
      sources: ["file"],
    },
    files: [
      {
        id: "file",
        name: "notes.txt",
        size: 5,
        type: "text/plain",
        created: 1,
        spaceId: "subject",
      },
    ],
    chats: [],
    studySets: [],
    edits: {},
  };
  const packed = await packSubject(manifest, { file: strToU8("hello") });
  const restored = await unpackSubject(packed);
  assert.equal(restored.manifest.space.memory, "Use examples");
  assert.deepEqual(restored.files.file, strToU8("hello"));
  await assert.rejects(packSubject(manifest, {}));
  await assert.rejects(
    unpackSubject(
      zipSync({
        "../escape": strToU8("bad"),
        "subject.json": strToU8(JSON.stringify(manifest)),
      }),
    ),
  );  // Export refuses what import would reject, with the same limits.
  const saved = { ...archiveLimits };
  try {
    archiveLimits.file = 4;
    await assert.rejects(packSubject(manifest, { file: strToU8("hello") }), /larger than/);
    Object.assign(archiveLimits, saved, { total: 100 });
    await assert.rejects(packSubject(manifest, { file: strToU8("hello") }), /more than/);
    await assert.rejects(unpackSubject(packed), /damaged|unsupported|too large/);
  } finally {
    Object.assign(archiveLimits, saved);
  }
});
