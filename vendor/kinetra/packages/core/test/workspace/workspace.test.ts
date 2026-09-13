/**
 * Workspace and artifact repository tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Workspace, loadWorkspace } from "../../src/workspace/workspace.js";
import { ArtifactRepository, findArtifact } from "../../src/workspace/artifact.js";
import { createArtifact } from "../../src/artifacts.js";

function makePdfArtifact(id: string, title: string) {
  const a = createArtifact({
    kind: "pdf",
    title,
    model: { id, pages: 1 },
  });
  a.id = id;
  return a;
}

test("Workspace: addArtifact stores entries with stable hashes", () => {
  const ws = new Workspace("course-A");
  const a = makePdfArtifact("doc-1", "Doc 1");
  const e = ws.addArtifact(a, { courseId: "course-A", topicId: "topic-1" });
  assert.equal(e.artifactId, "doc-1");
  assert.equal(e.contentHash.length, 64);
  assert.equal(ws.size(), 1);
});

test("Workspace: re-adding same artifact replaces entry", () => {
  const ws = new Workspace("A");
  const a = makePdfArtifact("doc-1", "v1");
  ws.addArtifact(a, { courseId: "c", topicId: "t" });
  const v2 = makePdfArtifact("doc-1", "v2");
  ws.addArtifact(v2, { courseId: "c", topicId: "t" });
  assert.equal(ws.size(), 1);
  assert.equal(ws.list()[0].title, "v2");
});

test("Workspace: byCourse and byTopic filter", () => {
  const ws = new Workspace("A");
  ws.addArtifact(makePdfArtifact("1", "x"), { courseId: "C1" });
  ws.addArtifact(makePdfArtifact("2", "y"), { courseId: "C1", topicId: "T1" });
  ws.addArtifact(makePdfArtifact("3", "z"), { courseId: "C2" });
  assert.equal(ws.byCourse("C1").length, 2);
  assert.equal(ws.byTopic("C1", "T1").length, 1);
});

test("Workspace: remove and clear", () => {
  const ws = new Workspace("A");
  const e = ws.addArtifact(makePdfArtifact("1", "x"), { courseId: "C1" });
  assert.equal(ws.remove(e.entryId), true);
  assert.equal(ws.size(), 0);
  ws.addArtifact(makePdfArtifact("1", "x"), { courseId: "C1" });
  ws.clear();
  assert.equal(ws.size(), 0);
});

test("Workspace: snapshot round-trips through loadWorkspace", () => {
  const ws = new Workspace("My Course");
  ws.addArtifact(makePdfArtifact("1", "Doc"), { courseId: "c1", topicId: "t1" });
  const raw = ws.toJSON();
  const reloaded = loadWorkspace(raw);
  assert.equal(reloaded.size(), 1);
  assert.equal(reloaded.list()[0].contentHash, ws.list()[0].contentHash);
});

test("ArtifactRepository: save returns duplicate=false the first time", () => {
  const repo = new ArtifactRepository({
    upsert: () => ({ duplicate: false }),
    remove: () => true,
    byKind: () => [],
  });
  const a = makePdfArtifact("a1", "A");
  const out = repo.save(a, "c1", "t1");
  assert.equal(out.duplicate, false);
});

test("ArtifactRepository: save adds entry to workspace when provided", () => {
  const ws = new Workspace("W");
  const repo = new ArtifactRepository({
    upsert: () => ({ duplicate: true }),
    remove: () => true,
    byKind: () => [],
  });
  repo.save(makePdfArtifact("a1", "A"), "c1", undefined, ws);
  assert.equal(ws.size(), 1);
});

test("findArtifact: returns matching artifact", () => {
  const list = [makePdfArtifact("a", "A"), makePdfArtifact("b", "B")];
  const found = findArtifact(list, "b");
  assert.equal(found.id, "b");
});

test("findArtifact: throws on missing", () => {
  assert.throws(() => findArtifact([], "nope"));
});
