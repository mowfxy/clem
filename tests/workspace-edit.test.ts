import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdit, isEditAction } from "../core/workspace-edit.ts";
import type { Space, StoredFile } from "../core/types.ts";
import type { SpacePlan } from "../core/plans.ts";

let n = 0;
const uid = () => "id" + ++n;
const space = (id: string, name: string, kind: "subject" | "project" = "subject"): Space => ({ id, name, kind, description: "", memory: "", sources: [] });
const file = (id: string, name: string, spaceId: string | null): StoredFile => ({ id, name, size: 10, type: "application/pdf", created: 1, spaceId });
const plan: SpacePlan = { id: "p1", spaceId: "s1", title: "Circuits plan", tasks: [{ id: "t1", title: "Read lecture 3", due: "2026-11-20" }, { id: "t2", title: "Quiz 2", due: "2026-11-23", kind: "milestone" }], created: 1, updated: 1, history: [] } as unknown as SpacePlan;
const ws = () => ({ spaces: [space("s1", "Circuits"), space("s2", "Physics"), space("p1", "Launch", "project")], files: [file("f1", "Lecture 3.pdf", "s1"), file("f2", "notes.pdf", null)], plans: [plan], chats: [], studySets: [], memory: "", automations: [] });

test("edit actions are recognised by name and alias", () => {
  assert.ok(isEditAction("edit.file") && isEditAction("file.rename") && isEditAction("edit.subject"));
  assert.ok(!isEditAction("guc.fix") && !isEditAction("clem.remind"));
});

test("a file is renamed (keeping its extension), moved into a subject's folder (made), and deleted", () => {
  let w = ws();
  const r1 = applyEdit(w, { action: "edit.file", file: "lecture 3", rename: "Week 3 slides" }, { uid });
  assert.ok(!("error" in r1));
  w = r1.state;
  assert.equal(w.files.find((f) => f.id === "f1")!.name, "Week 3 slides.pdf");
  const r2 = applyEdit(w, { action: "edit.file", file: "notes.pdf", move: "Physics", folder: "Week 1/Notes" }, { uid });
  assert.ok(!("error" in r2), JSON.stringify(r2));
  w = r2.state;
  const moved = w.files.find((f) => f.id === "f2")!;
  assert.equal(moved.spaceId, "s2");
  const phys = w.spaces.find((s) => s.id === "s2")!;
  assert.deepEqual(phys.folders!.map((f) => f.name), ["Week 1", "Notes"]);
  assert.equal(moved.folderId, phys.folders![1].id);
  assert.match(r2.said, /Physics → Week 1\/Notes/);
  const r3 = applyEdit(w, { action: "edit.file", file: "f1", delete: true });
  assert.ok(!("error" in r3));
  assert.equal(r3.state.files.length, 1);
  assert.equal(r3.gone![0].id, "f1");
  assert.match(String((applyEdit(w, { action: "edit.file", file: "nothing here", rename: "x" }) as { error: string }).error), /No file called/);
});

test("folders: made, renamed, and removed without deleting files", () => {
  let w = ws();
  w = (applyEdit(w, { action: "edit.folder", space: "Circuits", path: "Labs" }, { uid }) as any).state;
  w = (applyEdit(w, { action: "edit.file", file: "f1", folder: "Labs" }, { uid }) as any).state;
  const r = applyEdit(w, { action: "edit.folder", space: "Circuits", path: "Labs", rename: "Lab sheets" });
  assert.ok(!("error" in r));
  const gone = applyEdit(r.state, { action: "edit.folder", space: "Circuits", path: "Lab sheets", delete: true });
  assert.ok(!("error" in gone));
  assert.equal(gone.state.files.find((f) => f.id === "f1")!.folderId, null);
  assert.equal(gone.state.files.length, 2);
});

test("subjects: renamed, exam date set and cleared, a new project made", () => {
  const r = applyEdit(ws(), { action: "edit.space", space: "circuits", rename: "Circuits II", examDate: "2026-12-20" });
  assert.ok(!("error" in r));
  assert.equal(r.state.spaces[0].name, "Circuits II");
  assert.equal(r.state.spaces[0].examDate, "2026-12-20");
  const c = applyEdit(r.state, { action: "edit.space", space: "Circuits II", examDate: "" });
  assert.equal((c as any).state.spaces[0].examDate, undefined);
  const made = applyEdit(ws(), { action: "edit.space", create: "project", rename: "Thesis" }, { uid });
  assert.ok(!("error" in made));
  assert.equal(made.state.spaces[0].name, "Thesis");
});

test("plan tasks: added, moved, done and removed by title, and a plan made when there is none", () => {
  const r = applyEdit(ws(), { action: "edit.plan", space: "Circuits", changes: [{ op: "edit", task: "Quiz 2", due: "2026-11-26", time: "16:30" }, { op: "done", task: "read lecture 3" }, { op: "add", title: "Revise KVL", due: "2026-11-25" }] }, { uid, now: 5 });
  assert.ok(!("error" in r), JSON.stringify(r));
  const tasks = r.state.plans![0].tasks;
  assert.equal(tasks.find((t) => t.title === "Quiz 2")!.due, "2026-11-26");
  assert.equal(tasks.find((t) => t.title === "Quiz 2")!.time, "16:30");
  assert.ok(tasks.find((t) => t.id === "t1")!.done);
  assert.ok(tasks.some((t) => t.title === "Revise KVL"));
  const fresh = applyEdit(ws(), { action: "edit.plan", space: "Physics", changes: [{ op: "add", title: "Lab 1", due: "2026-11-30" }] }, { uid });
  assert.ok(!("error" in fresh));
  assert.equal(fresh.state.plans!.length, 2);
  assert.match(String((applyEdit(ws(), { action: "edit.plan", space: "Physics", changes: [{ op: "done", task: "x" }] }) as any).error), /no plan yet/);
});
