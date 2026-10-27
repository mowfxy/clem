import test from "node:test";
import assert from "node:assert/strict";
import { editReview } from "../../desktop/answer-review.ts";
import { applyEdit } from "../../core/diff.ts";

const files: Record<string, string> = { "notes.md": "# Week 1\n\nForce is mass times acceleration.\n" };
const problem = async (edit: { path: string; find?: string; replace?: string; content?: string }) => {
  if (!(edit.path in files) && edit.content === undefined) return "That file is not in a linked folder for this conversation.";
  try { applyEdit(files[edit.path] ?? "", edit); } catch (error) { return (error as Error).message; }
};
const block = (json: object | string) => "```edit\n" + (typeof json === "string" ? json : JSON.stringify(json)) + "\n```";

test("edit blocks that apply pass the review", async () => {
  assert.equal(await editReview("Here:\n\n" + block({ path: "notes.md", find: "times acceleration", replace: "times acceleration (F = ma)", summary: "s" }), problem), undefined);
  assert.equal(await editReview("No changes here.", problem), undefined);
});

test("edit blocks that cannot apply go back to the model with what to do", async () => {
  const answer = [
    block({ path: "notes.md", find: "Energy is conserved.", replace: "x" }),
    block("{not json"),
    block({ path: "missing.md", find: "a", replace: "b" }),
    block({ path: "notes.md", replace: "b" }),
  ].join("\n\n");
  const sent = await editReview(answer, problem);
  assert.ok(sent);
  assert.match(sent, /Change 1 \(notes\.md\): The text to replace is not in the file/);
  assert.match(sent, /Change 2 is not strict JSON/);
  assert.match(sent, /Change 3 \(missing\.md\): That file is not in a linked folder/);
  assert.match(sent, /Change 4 \(notes\.md\) needs "find"/);
  assert.match(sent, /Read each of those files again/);
});
