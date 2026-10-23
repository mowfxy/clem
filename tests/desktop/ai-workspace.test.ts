import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, utimes, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mirrorFor, mirroredId, syncMirror, workspaceLane, workspaceNote, workspacePath, workspaceRelative, newOutputs, safeName, spaceFolders, ATTACHMENTS } from "../../desktop/ai-workspace.ts";
import { officeText } from "../../desktop/office-text.ts";
import { zipSync, strToU8 } from "fflate";
import { markdownSource, withMarkdownSource } from "../../desktop/markdown-source.ts";
import { claudeCliArgs, claudeCliSettings, claudeWriters, rulePath, CLAUDE_CLI_TOOLS, STEADY_PROMPT, WRITER, WRITERS_NOTE } from "../../desktop/claude.ts";
import { folderThread } from "../../desktop/codex-stream.ts";
import { documentsNote } from "../../core/clem-skills.ts";
import { kinetraCli, kinetraFiles, kinetraCompact, kinetraCliBrief, kinetraFilesBrief } from "../../desktop/kinetra-runtime.ts";
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
  spaces: [{ id: "s1", name: "Physics", kind: "subject", sources: ["a"], folders: [{ id: "f1", name: "Term 1", parentId: null }, { id: "f2", name: "Week: 1", parentId: "f1" }] }, { id: "s2", name: "Thesis", kind: "project" }],
  chats: [{ id: "chat1", messages: [{ role: "user", attachments: ["c"] }] }, { id: "chat2", messages: [] }],
};

test("the working folder holds every file the person keeps, organised by subject, project and folder", () => {
  const plan = mirrorFor({ state, scope: "subject:s1", chat: "chat1", lane: "chat-1", blob: (id) => `/blobs/${id}.blob`, officeText: async () => "word text", library: [{ name: "Lecture 1.pdf", text: "pdf text" }] });
  const paths = plan.files.map((f) => f.path);
  // Every subject's and project's files, not only this one's; Word text extracted here for every file.
  assert.deepEqual(paths.sort(), ["Files/photo.png", "Projects/Thesis/other.pdf", "Subjects/Physics/Notes.docx", "Subjects/Physics/Term 1/Week_ 1/Lecture 1.pdf", "_text/Subjects/Physics/Notes.docx.txt", "_text/Subjects/Physics/Term 1/Week_ 1/Lecture 1.pdf.txt"]);
  assert.deepEqual(plan.files.filter((f) => f.source).map((f) => f.path).sort(), ["Files/photo.png", "Subjects/Physics/Term 1/Week_ 1/Lecture 1.pdf"]);
  assert.equal(mirroredId(plan.files, "Projects/Thesis/other.pdf"), "e");
  assert.equal(mirroredId(plan.files, "_text/Subjects/Physics/Notes.docx.txt"), "b");
  // Claude Code and Grok open the PDF itself; a Word file still has its text.
  const native = mirrorFor({ state, scope: "workspace", chat: "chat1", lane: "chat-1", blob: (id) => id, officeText: async () => "t", library: [{ name: "Lecture 1.pdf", text: "pdf text" }], pdfText: false }).files.map((f) => f.path);
  assert.ok(native.includes("_text/Subjects/Physics/Notes.docx.txt") && !native.some((p) => p.endsWith("Lecture 1.pdf.txt")));
  // A picture's text only when Clem read it by OCR; an attachment not saved yet goes in the chat's own lane.
  assert.ok(!mirrorFor({ state, scope: "workspace", lane: "l", blob: (id) => id, library: [{ name: "photo.png", text: "words" }] }).files.some((f) => f.path.startsWith("_text/")));
  assert.ok(mirrorFor({ state, scope: "workspace", lane: "l", blob: (id) => id, library: [{ name: "photo.png", text: "[OCR] words" }] }).files.some((f) => f.path === "_text/Files/photo.png.txt"));
  assert.ok(mirrorFor({ state, scope: "workspace", lane: "l", blob: (id) => id, attached: [{ name: "new.pdf", data: new Uint8Array(3) }] }).files.some((f) => f.path === "Attachments/l/new.pdf" && f.source));
  // Other chats' lanes stay while those chats exist; a deleted chat's go; a file's OCR text stays while the file is unchanged.
  const lanes = mirrorFor({ state, scope: "workspace", chat: "chat1", lane: workspaceLane("chat1", "r"), blob: (id) => id });
  assert.equal(lanes.keep(`Attachments/${workspaceLane("chat2", "r")}/x.pdf`, "1|1|1"), true);
  assert.equal(lanes.keep(`Attachments/${workspaceLane("gone", "r")}/x.pdf`, "1|1|1"), false);
  assert.equal(lanes.keep("_text/Files/photo.png.txt", "text:5:1:5:abc|5|1"), true);
  assert.equal(lanes.keep("_text/Files/photo.png.txt", "text:4:1:5:abc|5|1"), false);
  // Two subjects of one name get their own folders.
  assert.deepEqual([...spaceFolders([{ id: "x", name: "Maths", kind: "subject" }, { id: "y", name: "Maths", kind: "subject" }]).values()], ["Subjects/Maths", "Subjects/Maths (2)"]);
  assert.match(workspaceLane("chat1", "r"), /^chat-[0-9a-f]{8}$/);
  assert.notEqual(workspaceLane("chat1", "r"), workspaceLane("chat2", "r"));
  assert.match(workspaceLane(undefined, "r"), /^once-/);
  assert.equal(workspaceRelative("C:/w", "C:/w/Subjects/a.pdf"), "Subjects/a.pdf");
  assert.equal(safeName("con.txt"), "_con.txt");
  assert.equal(safeName("a/b:c?.pdf"), "a_b_c_.pdf");
});

test("Word, PowerPoint and Excel files are read here, slide by slide and sheet by sheet", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clem-office-"));
  try {
    await writeFile(join(dir, "a.docx"), zipSync({ "word/document.xml": strToU8('<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world &amp; more</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>') }));
    assert.equal(await officeText(join(dir, "a.docx"), "a.docx"), "Hello world & more\nSecond");
    await writeFile(join(dir, "b.pptx"), zipSync({ "ppt/slides/slide2.xml": strToU8("<p:sld><a:p><a:r><a:t>Two</a:t></a:r></a:p></p:sld>"), "ppt/slides/slide1.xml": strToU8("<p:sld><a:p><a:r><a:t>One</a:t></a:r></a:p></p:sld>") }));
    assert.equal(await officeText(join(dir, "b.pptx"), "b.pptx"), "[b.pptx, slide 1]\nOne\n\n[b.pptx, slide 2]\nTwo");
    await writeFile(join(dir, "c.xlsx"), zipSync({ "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Marks" sheetId="1"/></sheets></workbook>'), "xl/sharedStrings.xml": strToU8("<sst><si><t>Name</t></si><si><t>Ali</t></si></sst>"), "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>7</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row></sheetData></worksheet>') }));
    assert.equal(await officeText(join(dir, "c.xlsx"), "c.xlsx"), '[c.xlsx, sheet "Marks"]\nName\t\t7\nAli');
    // Order and names come from presentation.xml and workbook.xml through their relationships, not from file numbers.
    const slide = (text: string) => strToU8(`<p:sld><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`);
    await writeFile(join(dir, "d.pptx"), zipSync({
      "ppt/presentation.xml": strToU8('<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>'),
      "ppt/_rels/presentation.xml.rels": strToU8('<Relationships><Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="slide" Target="/ppt/slides/slide2.xml"/></Relationships>'),
      "ppt/slides/slide1.xml": slide("Moved last"), "ppt/slides/slide2.xml": slide("Moved first"),
      "ppt/slides/_rels/slide2.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="notesSlide" Target="../notesSlides/notesSlide7.xml"/></Relationships>'),
      "ppt/notesSlides/notesSlide7.xml": slide("Say this"),
    }));
    assert.equal(await officeText(join(dir, "d.pptx"), "d.pptx"), "[d.pptx, slide 1]\nMoved first\nSpeaker notes: Say this\n\n[d.pptx, slide 2]\nMoved last");
    const sheet = (text: string) => strToU8(`<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${text}</t></is></c></row></sheetData></worksheet>`);
    await writeFile(join(dir, "e.xlsx"), zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Summary" sheetId="2" r:id="rId9"/><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Target="worksheets/sheet2.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": sheet("rows"), "xl/worksheets/sheet2.xml": sheet("totals"),
    }));
    assert.equal(await officeText(join(dir, "e.xlsx"), "e.xlsx"), '[e.xlsx, sheet "Summary"]\ntotals\n\n[e.xlsx, sheet "Data"]\nrows');
    await writeFile(join(dir, "bad.docx"), "not a zip");
    assert.match(await officeText(join(dir, "bad.docx"), "bad.docx"), /could not be read/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("syncing copies only what changed, restores copies the AI changed, removes deleted files and keeps Drafts and Outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "clem-ws-"));
  const blobs = await mkdtemp(join(tmpdir(), "clem-blobs-"));
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
    const keepOthers = (path: string) => path.startsWith(`${ATTACHMENTS}/chat-other/`);
    await syncMirror(root, [...first.slice(0, 1), { path: `${ATTACHMENTS}/chat-other/x.txt`, stamp: "1", from: { bytes: "x" } }], keepOthers);
    await syncMirror(root, first.slice(0, 1), keepOthers);
    assert.equal(await readFile(join(root, ATTACHMENTS, "chat-other", "x.txt"), "utf8"), "x");
    // Each chat's outputs are its own: another chat's lane is never delivered.
    await syncMirror(root, first.slice(0, 1), undefined, "chat-a");
    await syncMirror(root, first.slice(0, 1), undefined, "chat-b");
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

test("the note says where everything is, counts each subject's files and names the sources first", () => {
  const paths = ["Subjects/Physics/a.pdf", "Subjects/Physics/b.pdf", "Subjects/Maths/c.pdf", "Projects/Thesis/d.docx", "Files/e.png", "_text/Projects/Thesis/d.docx.txt"];
  const note = workspaceNote("C:/w", paths, ["Subjects/Physics/a.pdf"], { here: "Subjects/Physics", lane: "chat-1234abcd" });
  assert.match(note, /every file the person keeps in Clem/);
  assert.match(note, /- Subjects\/Physics\/ \(2 files\)\n- Subjects\/Maths\/ \(1 file\)|- Projects\/Thesis\/ \(1 file\)/);
  assert.match(note, /- Subjects\/Maths\/ \(1 file\)/);
  assert.match(note, /THIS CONVERSATION IS IN Subjects\/Physics\//);
  assert.match(note, /SOURCES OF THIS ANSWER[^]*- Subjects\/Physics\/a\.pdf/);
  // This subject's other files are listed; the other subjects' only by name and count.
  assert.match(note, /The other files of Subjects\/Physics\/:\n- Subjects\/Physics\/b\.pdf/);
  assert.doesNotMatch(note, /- Subjects\/Maths\/c\.pdf/);
  assert.match(note, /Drafts\/chat-1234abcd\/: your own working files/);
  assert.match(note, /Outputs\/chat-1234abcd\/: any file you write here/);
  // A large library lists this subject's files and counts the rest.
  const many = Array.from({ length: 250 }, (_, i) => `Subjects/Maths/f${i}.pdf`).concat("Subjects/Physics/a.pdf");
  const big = workspaceNote("C:/w", many, [], { here: "Subjects/Physics" });
  assert.match(big, /- Subjects\/Maths\/ \(250 files\)/);
  assert.match(big, /The files of Subjects\/Physics\/[^]*- Subjects\/Physics\/a\.pdf/);
  assert.doesNotMatch(big, /f12\.pdf/);
  // Codex, with no PDF viewer of its own, looks at a PDF's pages; its text is for searching.
  assert.match(workspaceNote("C:/w", paths, [], { nativePdf: false }), /looking at its pages/);
  assert.match(workspaceNote("C:/w", [], []), /no files in Clem yet/);
});

test("documents made from a Markdown file are listed with it, and changed by editing it", () => {
  const note = documentsNote([{ id: "d1", name: "Notes.pdf", draft: "Drafts/n.md" }, { id: "d2", name: "Deck.pptx" }]);
  assert.match(note, /id=d1 · Notes\.pdf · made from Drafts\/n\.md/);
  assert.match(note, /"markdown":"<that file>"/);
  assert.match(note, /To change any other: \{"kinetra":\{"action":"open"/);
  assert.match(documentsNote([{ id: "d2", name: "Deck.pptx" }]), /\nTo change one: \{"kinetra":\{"action":"open"/);
});

test("a document's Markdown source becomes the pdf specification, figures and references included", () => {
  const md = "# Nodal Analysis\n\nA short summary.\n\n## Basics\nText with $V=IR$.\n\n```figure\n{\"module\":\"clem\",\"fn\":\"solveCircuit\",\"args\":[{}],\"caption\":\"The circuit\",\"align\":\"wrap-right\"}\n```\nMore text after.\n\n## Code\n```python\n## not a heading\n```\n\n## References\n1. Hayt, Engineering Circuit Analysis.\n2. Nilsson, Electric Circuits.\n";
  const source = markdownSource(md);
  assert.equal(source.title, "Nodal Analysis");
  assert.equal(source.summary, "A short summary.");
  assert.deepEqual(source.references, ["Hayt, Engineering Circuit Analysis.", "Nilsson, Electric Circuits."]);
  assert.deepEqual(source.sections.map((s) => s.heading ?? null), ["Basics", null, "Code"]);
  assert.deepEqual(source.sections[0].figure, { module: "clem", fn: "solveCircuit", args: [{}], align: "wrap-right" });
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
  assert.match(writer.prompt, /^RULES\n\nYOU ARE A CLEM DOCUMENT WRITER/);
  assert.match(WRITERS_NOTE, /word for word/);
  assert.ok(!args.includes("--system-prompt-file") && !args.includes("--safe-mode"));
  // Its system prompt is the same in every chat's folder (the folder goes in the message), so the prompt cache serves them all.
  assert.ok(args.includes(STEADY_PROMPT));
  assert.ok(!claudeCliArgs("sonnet", "high", undefined, { steady: false }).includes(STEADY_PROMPT));
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
  assert.match(system, /^IN CLEM/);
  assert.doesNotMatch(system, /You have no shell, file system/);
  assert.match(system, /Run no commands or programs/);
  assert.doesNotMatch(system, /Do not execute commands/);
  assert.match(system, /Read only files in your working folder/);
  assert.match(cliSystemPrompt("", { shell: true }), /Your shell is for working with the files in your working folder/);
  assert.doesNotMatch(cliSystemPrompt("", { shell: true }), /Run no commands/);
  assert.match(kinetraCli, /not to compose the document's text before writing it/);
  assert.match(grokRules("rules", true)!, /working folder holds the person's files/);
});

test("a folder AI's system prompt carries a one-line tool note, so a plain message does not carry the whole guide", () => {
  assert.ok(cliSystemPrompt(kinetraCliBrief).length < 3000);
  assert.ok(cliSystemPrompt(kinetraCli).length > 15000);
  assert.match(kinetraCliBrief, /call kinetra with \{"action":"help"\}/);
  assert.match(kinetraFilesBrief, /reply with ONLY \{"kinetra":\{"action":"help"\}\}/);
});

test("an unchanged answer copies nothing and leaves the manifest alone", async () => {
  const { mkdtemp, stat: st, rm: remove, writeFile: write } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join: at } = await import("node:path");
  const root = await mkdtemp(at(tmpdir(), "clem-mirror-"));
  try {
    const source = at(root, "..", "src-" + Date.now() + ".txt");
    await write(source, "hello");
    const files = [{ path: "Files/a.txt", stamp: "1", from: { file: source } }];
    await syncMirror(root, files);
    const manifest = (await st(at(root, ".clem-mirror.json"))).mtimeMs, copy = (await st(at(root, "Files/a.txt"))).mtimeMs;
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(await syncMirror(root, files), ["Files/a.txt"]);
    assert.equal((await st(at(root, ".clem-mirror.json"))).mtimeMs, manifest);
    assert.equal((await st(at(root, "Files/a.txt"))).mtimeMs, copy);
    // A copy the AI changed is copied again.
    await write(at(root, "Files/a.txt"), "changed by the AI");
    await syncMirror(root, files);
    assert.equal(await (await import("node:fs/promises")).readFile(at(root, "Files/a.txt"), "utf8"), "hello");
    await remove(source, { force: true });
  } finally { await remove(root, { recursive: true, force: true }); }
});
