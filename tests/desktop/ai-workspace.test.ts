import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, utimes, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mirrorFor, syncMirror, workspaceKey, workspaceLane, workspaceNote, workspacePath, newOutputs, safeName, ATTACHMENTS } from "../../desktop/ai-workspace.ts";
import { markdownSource, withMarkdownSource } from "../../desktop/markdown-source.ts";
import { claudeCliArgs, claudeCliSettings, claudeWriters, rulePath, CLAUDE_CLI_TOOLS, WRITER, WRITERS_NOTE } from "../../desktop/claude.ts";
import { folderThread } from "../../desktop/codex-stream.ts";
import { documentsNote } from "../../core/mowr-skills.ts";
import { kinetraCli, kinetraFiles, kinetraCompact } from "../../desktop/kinetra-runtime.ts";
import { cliSystemPrompt } from "../../desktop/prompt.ts";
import { GROK_FOLDER_TOOLS, grokRules } from "../../desktop/grok.ts";

const state = {
  files: [
    { id: "a", name: "Lecture 1.pdf", size: 3, type: "application/pdf", created: 1, spaceId: "s1", folderId: "f2" },
    { id: "b", name: "Notes.docx", size: 4, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", created: 1, spaceId: "s1", folderId: null },
    { id: "c", name: "photo.png", size: 5, type: "image/png", created: 1, spaceId: null },
    { id: "d", name: "talk.mp4", size: 6, type: "video/mp4", created: 1, spaceId: "s1" },
    { id: "e", name: "other.pdf", size: 7, type: "application/pdf", created: 1, spaceId: "s2" },
  ],
  spaces: [{ id: "s1", sources: ["a"], folders: [{ id: "f1", name: "Term 1", parentId: null }, { id: "f2", name: "Week: 1", parentId: "f1" }] }],
  chats: [{ id: "chat1", messages: [{ role: "user", attachments: ["c"] }] }],
};

test("the working folder mirrors the space's files in their folders, marks the sources and keeps others' files out", () => {
  const files = mirrorFor({ state, scope: "subject:s1", chat: "chat1", blob: (id) => `/blobs/${id}.blob`, library: [{ name: "Notes.docx", text: "Word text" }, { name: "Lecture 1.pdf", text: "pdf text" }] });
  const paths = files.map((f) => f.path);
  // A PDF's text is there too: it is read first, and only the pages whose drawings matter are opened.
  assert.deepEqual(paths.sort(), ["Attachments/photo.png", "Files/Notes.docx", "Files/Term 1/Week_ 1/Lecture 1.pdf", "_text/Lecture 1.pdf.txt", "_text/Notes.docx.txt"]);
  assert.deepEqual(files.filter((f) => f.source).map((f) => f.path).sort(), ["Attachments/photo.png", "Files/Term 1/Week_ 1/Lecture 1.pdf"]);
  // A text file's own text is not copied again; a picture's is only when Mowr read it by OCR.
  assert.ok(!mirrorFor({ state, scope: "subject:s1", chat: "chat1", blob: (id) => id, library: [{ name: "photo.png", text: "words" }] }).some((f) => f.path.startsWith("_text/")));
  assert.ok(mirrorFor({ state, scope: "subject:s1", chat: "chat1", blob: (id) => id, library: [{ name: "photo.png", text: "[OCR] words" }] }).some((f) => f.path === "_text/photo.png.txt"));
  // Short, stable folder names: one per subject, per chat, per request; a lane per chat only in a shared subject folder.
  assert.match(workspaceKey("subject:s1", "chat1", "r"), /^space-[0-9a-f]{12}$/);
  assert.equal(workspaceKey("subject:s1", "chat2", "r"), workspaceKey("subject:s1", "chat1", "q"));
  assert.match(workspaceKey("workspace", "chat1", "r"), /^chat-[0-9a-f]{12}$/);
  assert.match(workspaceKey("workspace", undefined, "r"), /^once-/);
  assert.match(workspaceLane(workspaceKey("subject:s1", "chat1", "r"), "chat1", "r"), /^chat-[0-9a-f]{8}$/);
  assert.notEqual(workspaceLane("space-x", "chat1", "r"), workspaceLane("space-x", "chat2", "r"));
  assert.equal(workspaceLane(workspaceKey("workspace", "chat1", "r"), "chat1", "r"), "");
  assert.equal(safeName("con.txt"), "_con.txt");
  assert.equal(safeName("a/b:c?.pdf"), "a_b_c_.pdf");
});

test("syncing copies only what changed, restores copies the AI changed, removes deleted files and keeps Drafts and Outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "mowr-ws-"));
  const blobs = await mkdtemp(join(tmpdir(), "mowr-blobs-"));
  try {
    await writeFile(join(blobs, "a"), "one");
    await writeFile(join(blobs, "b"), "two");
    const first = [{ path: "Files/a.txt", stamp: "1", from: { file: join(blobs, "a") } }, { path: "Files/sub/b.txt", stamp: "1", from: { file: join(blobs, "b") } }];
    assert.deepEqual(await syncMirror(root, first), ["Files/a.txt", "Files/sub/b.txt"]);
    await writeFile(join(root, "Drafts", "doc.md"), "# mine");
    // The AI changed its copy: it is copied again even though the person's file did not change.
    await writeFile(join(root, "Files", "a.txt"), "changed by the AI");
    await utimes(join(root, "Files", "a.txt"), new Date(), new Date(Date.now() + 5000));
    await syncMirror(root, first.slice(0, 1));
    assert.equal(await readFile(join(root, "Files", "a.txt"), "utf8"), "one");
    assert.equal(existsSync(join(root, "Files", "sub")), false, "a deleted file and its emptied folder are gone");
    assert.equal(await readFile(join(root, "Drafts", "doc.md"), "utf8"), "# mine");
    // Another chat's attachment in a shared subject folder is kept.
    await syncMirror(root, [...first.slice(0, 1), { path: `${ATTACHMENTS}/x.txt`, stamp: "1", from: { bytes: "x" } }], [ATTACHMENTS]);
    await syncMirror(root, first.slice(0, 1), [ATTACHMENTS]);
    assert.equal(await readFile(join(root, ATTACHMENTS, "x.txt"), "utf8"), "x");
    // Each chat's outputs are its own: another chat's lane is never delivered.
    await syncMirror(root, first.slice(0, 1), [], "chat-a");
    await syncMirror(root, first.slice(0, 1), [], "chat-b");
    const since = Date.now();
    await writeFile(join(root, "Outputs", "chat-a", "table.csv"), "a,b");
    await writeFile(join(root, "Outputs", "chat-b", "other.csv"), "c");
    assert.deepEqual((await newOutputs(root, since, "chat-a")).map((o) => o.name), ["table.csv"]);
    assert.equal(workspacePath(root, "../escape.txt"), null);
    assert.equal(workspacePath(root, "C:/Windows/win.ini"), null);
    assert.ok(workspacePath(root, "Drafts/doc.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(blobs, { recursive: true, force: true });
  }
});

test("the note names the sources first and lists the other files", () => {
  const note = workspaceNote("C:/w", ["Files/a.pdf", "Files/b.pdf", "_text/c.docx.txt"], ["Files/a.pdf"]);
  assert.match(note, /SOURCES OF THIS ANSWER[^]*- Files\/a\.pdf/);
  assert.match(note, /Files\/: the other files[^]*- Files\/b\.pdf/);
  assert.doesNotMatch(note.split("Files/: the other files")[1], /a\.pdf/);
  assert.match(note, /Outputs\//);
  const laned = workspaceNote("C:/w", ["_text/a.pdf.txt"], [], { lane: "chat-1234abcd" });
  assert.match(laned, /Drafts\/chat-1234abcd\/: your own working files/);
  assert.match(laned, /Outputs\/chat-1234abcd\/: any file you write here/);
  assert.match(laned, /Read a PDF's text there first/);
});

test("documents made from a Markdown file are listed with it, and changed by editing it", () => {
  const note = documentsNote([{ id: "d1", name: "Notes.pdf", draft: "Drafts/n.md" }, { id: "d2", name: "Deck.pptx" }]);
  assert.match(note, /id=d1 · Notes\.pdf · made from Drafts\/n\.md/);
  assert.match(note, /"markdown":"<that file>"/);
  assert.match(note, /To change any other: \{"kinetra":\{"action":"open"/);
  assert.match(documentsNote([{ id: "d2", name: "Deck.pptx" }]), /\nTo change one: \{"kinetra":\{"action":"open"/);
});

test("a document's Markdown source becomes the pdf specification, figures and references included", () => {
  const md = "# Nodal Analysis\n\nA short summary.\n\n## Basics\nText with $V=IR$.\n\n```figure\n{\"module\":\"mowr\",\"fn\":\"solveCircuit\",\"args\":[{}],\"caption\":\"The circuit\",\"align\":\"wrap-right\"}\n```\nMore text after.\n\n## Code\n```python\n## not a heading\n```\n\n## References\n1. Hayt, Engineering Circuit Analysis.\n2. Nilsson, Electric Circuits.\n";
  const source = markdownSource(md);
  assert.equal(source.title, "Nodal Analysis");
  assert.equal(source.summary, "A short summary.");
  assert.deepEqual(source.references, ["Hayt, Engineering Circuit Analysis.", "Nilsson, Electric Circuits."]);
  assert.deepEqual(source.sections.map((s) => s.heading ?? null), ["Basics", null, "Code"]);
  assert.deepEqual(source.sections[0].figure, { module: "mowr", fn: "solveCircuit", args: [{}], align: "wrap-right" });
  assert.equal(source.sections[0].caption, "The circuit");
  assert.equal(source.sections[1].text, "More text after.");
  assert.match(source.sections[2].text!, /## not a heading/);
  const spec = withMarkdownSource({ action: "pdf", markdown: "Drafts/n.md", kind: "notes", revise: "id1" }, md);
  assert.equal(spec.title, "Nodal Analysis");
  assert.equal(spec.revise, "id1");
  assert.equal("markdown" in spec, false);
  // The file is the whole document: parts sent beside it are ignored rather than added twice.
  const whole = withMarkdownSource({ action: "pdf", markdown: "Drafts/n.md", revise: "id1", append: true, patch: [{ at: 0 }], plan: ["x"] }, md);
  assert.equal("append" in whole || "patch" in whole, false);
  assert.deepEqual(whole.plan, ["x"], "the plan stays: the file is checked against it");
  assert.equal(whole.sections.length, source.sections.length);
  assert.throws(() => markdownSource("## A\n```figure\n{broken\n```\n"), /line 2 is not valid JSON/);
  assert.throws(() => withMarkdownSource({ action: "pdf" }, "# Only a title\n"), /no content/);
});

test("Claude runs as itself in the folder: its own prompt, file tools, no commands, linked folders read only", () => {
  const args = claudeCliArgs("sonnet", "high", { id: "s", resume: false }, { mcpConfig: "m.json", addDirs: ["D:\\Course"], settingsFile: "s.json" });
  for (const flag of ["--restricted", "--no-chrome", "--strict-mcp-config", "--mcp-config", "--settings", "--add-dir", "--session-id"]) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf("--permission-mode") + 1], "acceptEdits");
  assert.equal(args[args.indexOf("--tools") + 1], CLAUDE_CLI_TOOLS);
  for (const tool of ["Bash", "PowerShell", "Task", "Agent"]) assert.ok(!CLAUDE_CLI_TOOLS.split(",").includes(tool), tool);
  // Writers: the subagent tool only with them, and each writer has Kinetra and file tools, no commands and no subagents.
  const withWriters = claudeCliArgs("sonnet", "high", undefined, { mcpConfig: "m.json", agentsFile: "a.json" });
  assert.equal(withWriters[withWriters.indexOf("--agents") + 1], "a.json");
  assert.match(withWriters[withWriters.indexOf("--tools") + 1], /,Task,Agent$/);
  const writer = JSON.parse(claudeWriters("RULES"))[WRITER];
  assert.ok(writer.tools.includes("mcp__kinetra__kinetra") && writer.tools.includes("Write"));
  for (const tool of ["Bash", "Task", "Agent"]) assert.ok(!writer.tools.includes(tool), tool);
  assert.match(writer.prompt, /^RULES\n\nYOU ARE A MOWR DOCUMENT WRITER/);
  assert.match(WRITERS_NOTE, /word for word/);
  assert.ok(!args.includes("--system-prompt-file") && !args.includes("--safe-mode"));
  assert.equal(rulePath("D:\\Course\\Week 1\\"), "//d/Course/Week 1");
  assert.deepEqual(JSON.parse(claudeCliSettings(["D:\\Course"])).permissions.deny, ["Edit(//d/Course/**)", "Write(//d/Course/**)", "NotebookEdit(//d/Course/**)"]);
  // Grok's own names only: one unknown name makes Grok load every tool, the terminal included.
  assert.deepEqual(GROK_FOLDER_TOOLS.split(","), ["read_file", "list_dir", "grep", "search_replace", "write", "web_search", "todo_write"]);
  // Codex in its folder: its shell, writes kept to the folder (temp excluded), no network.
  const thread = folderThread({ root: "C:/w", instructions: "RULES" });
  assert.equal(thread.cwd, "C:/w");
  assert.equal(thread.sandbox, "workspace-write");
  assert.equal(thread.config["features.shell_tool"], true);
  assert.equal(thread.config["windows.sandbox"], "unelevated");
  assert.equal(thread.config["sandbox_workspace_write.network_access"], false);
  assert.equal(thread.config["sandbox_workspace_write.exclude_tmpdir_env_var"], true);
});

test("the folder guides write documents as Markdown files instead of in parts, and the rules follow the CLI's own prompt", () => {
  assert.match(kinetraCli, /"markdown":"Drafts\/…\/name\.md"/);
  assert.match(kinetraCli, /kinetra tool call/);
  assert.doesNotMatch(kinetraCli, /one reply holds only about 3–5 pages/);
  assert.match(kinetraFiles, /reply with ONLY a JSON object \{"kinetra"/);
  assert.match(kinetraFiles, /"markdown":"Drafts\/…\/name\.md"/);
  assert.match(kinetraCompact, /one reply holds only about 3–5 pages/);
  const system = cliSystemPrompt(kinetraCli);
  assert.match(system, /^IN MOWR/);
  assert.doesNotMatch(system, /You have no shell, file system/);
  assert.match(system, /Run no commands or programs/);
  assert.doesNotMatch(system, /Do not execute commands/);
  assert.match(system, /Read only files in your working folder/);
  assert.match(cliSystemPrompt("", { shell: true }), /Your shell is for working with the files in your working folder/);
  assert.doesNotMatch(cliSystemPrompt("", { shell: true }), /Run no commands/);
  assert.match(kinetraCli, /not to compose the document's text before writing it/);
  assert.match(grokRules("rules", true)!, /working folder holds the person's files/);
});
