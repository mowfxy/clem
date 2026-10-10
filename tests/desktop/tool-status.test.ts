import test from "node:test";
import assert from "node:assert/strict";
import { describeTool, shortPath } from "../../desktop/tool-status.ts";
import { claudeStatus } from "../../desktop/claude.ts";
import { grokStatus } from "../../desktop/grok.ts";

test("file tools name the file, without Mowr's own folders", () => {
  assert.equal(describeTool("Read", { file_path: "C:\\Users\\me\\AppData\\mowr\\space-1\\Files\\Lectures\\Week 3.pdf" }), "Reading Lectures/Week 3.pdf…");
  assert.equal(describeTool("Read", { file_path: "C:/w/_text/Week 3.pdf.txt" }), "Reading Week 3.pdf…");
  assert.equal(describeTool("Write", { file_path: "C:/w/Outputs/chat-1a2b3c4d/results.csv" }), "Writing results.csv…");
  assert.equal(describeTool("Grep", { pattern: "Thevenin" }), "Searching the files for “Thevenin”…");
  assert.equal(describeTool("read_file", { path: "Files/notes.md" }), "Reading Files/notes.md…".replace("Files/", ""));
  assert.equal(describeTool("WebFetch", { url: "https://www.example.com/a" }), "Reading example.com…");
  assert.equal(describeTool("SomethingNew", {}), null);
  assert.ok(shortPath("x".repeat(100) + ".pdf").length <= 60);
});

test("Kinetra calls say what is being made", () => {
  assert.equal(describeTool("mcp__kinetra__kinetra", { action: "pdf", title: "Week 3 worksheet" }), "Typesetting “Week 3 worksheet”…");
  assert.equal(describeTool("kinetra", { kinetra: { action: "call" } }), "Working it out with Kinetra…");
  assert.equal(describeTool("kinetra", { action: "look", file: "Files/handout.pdf" }), "Looking at handout.pdf…");
});

test("Claude and Grok status lines use them", () => {
  assert.equal(claudeStatus({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "C:/w/Files/a.pdf" } }] } }), "Reading a.pdf…");
  assert.equal(grokStatus({ type: "assistant", message: { content: [{ type: "tool_use", name: "read_file", input: { path: "C:/w/Attachments/b.png" } }] } }), "Reading b.png…");
  assert.equal(grokStatus({ type: "assistant", message: { content: [{ type: "tool_use", name: "mystery", input: {} }] } }), "Using a tool…");
});
