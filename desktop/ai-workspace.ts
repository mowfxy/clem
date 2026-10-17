import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";

/**
 * The folder every CLI works in (Claude Code, Grok Build and Codex run in it as their working directory): every file
 * the person keeps in Mowr, organised as they are in Mowr, so the AI lists, searches, reads and opens any of them with
 * its own tools, as in any project, whichever chat it answers in. One folder per person:
 *
 *   Subjects/<subject>/…   each subject's files, in the folders the person made in it
 *   Projects/<project>/…   each project's files, the same way
 *   Files/                 files in no subject or project
 *   _text/                 the text of files no CLI here opens itself, at the file's own path with .txt added: Word,
 *                          PowerPoint and Excel files (read here, desktop/office-text.ts), scans read by OCR, and PDFs
 *                          for Codex, which has no PDF viewer (Claude Code and Grok open PDFs themselves)
 *   Attachments/<chat>/    files a chat sent that are not saved in Mowr yet (attached a moment ago)
 *   Made/<chat>/           files Mowr made earlier in a chat that are not among the person's files
 *   Drafts/<chat>/         the AI's own working files for a chat (a document's Markdown source); kept between answers
 *   Outputs/<chat>/        files the AI writes for the person: each new or changed one is delivered with the answer
 *
 * Every chat has its own lane (<chat>) in Attachments, Made, Drafts and Outputs, so chats answering at once never
 * overwrite each other's drafts or receive each other's files. Which files an answer is about (attached in the chat,
 * or chosen as the space's sources) is said in the message, not by moving them. The person's files are copies:
 * nothing a CLI does here changes Mowr's own copy, and a copy it changed is copied again before the next answer.
 */
export const SUBJECTS = "Subjects", PROJECTS = "Projects", FILES = "Files", ATTACHMENTS = "Attachments", MADE = "Made", TEXT = "_text", DRAFTS = "Drafts", OUTPUTS = "Outputs";
/** The folders that hold the person's own files (Mowr's mirror; the AI reads them and never changes them). */
export const LIBRARY = [SUBJECTS, PROJECTS, FILES];
const MANIFEST = ".mowr-mirror.json";
/** The largest file mirrored; bigger ones (and audio and video, which no CLI here can read) are left out. */
const MAX_FILE = 200_000_000;
const MEDIA = /^(audio|video)\//;
const OFFICE = /\.(docx|pptx|xlsx)$/i;

export type MirrorFile = {
  /** Path inside the workspace, with forward slashes ("Subjects/Physics/Lectures/Week 1.pdf"). */
  path: string;
  /** Changes whenever the file's contents may have changed (its size and time). No "|". */
  stamp: string;
  /** The bytes, read only when the copy here is missing or out of date: a file on disk to copy, bytes to write, or
   *  bytes made on demand (an Office file's text, extracted only when the file is new or changed). */
  from: { file: string } | { bytes: Uint8Array | string } | { make: () => Promise<Uint8Array | string> };
  /** One of this answer's sources (attached in the chat, or chosen as sources of the subject or project). */
  source?: boolean;
  /** The Mowr file it is a copy of, so a tool request naming its path reaches that file. */
  id?: string;
};
/** What one answer brings up to date: the files it needs, and which other recorded copies stay (other chats' lanes). */
export type MirrorPlan = { files: MirrorFile[]; keep: (path: string, recorded: string) => boolean };

/** A name safe for Windows: no reserved characters, no trailing dot or space, never "..". */
export function safeName(name: string, max = 100) {
  // Kept short: Windows paths past 260 characters fail in some programs, and the folder itself is already deep.
  const clean = String(name || "file").replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").trim().slice(0, max).replace(/[. ]+$/g, "").trim();
  return !clean || /^\.+$/.test(clean) ? "file" : /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(clean) ? "_" + clean : clean;
}

/** Whether `path` is `root` or inside it. */
export function within(root: string, path: string) {
  const r = resolve(root), p = resolve(path);
  return p === r || p.toLowerCase().startsWith((r.endsWith(sep) ? r : r + sep).toLowerCase());
}

/** A path the AI named, resolved inside the workspace (forward or back slashes, absolute or relative); null outside it. */
export function workspacePath(root: string, path: unknown) {
  if (typeof path !== "string" || !path.trim()) return null;
  const named = path.trim();
  // An absolute path is the AI naming a file by its full path: inside the workspace it is that file, anywhere else nothing.
  if (/^([a-z]:|[\\/]{2})/i.test(named)) {
    const full = resolve(named);
    return within(root, full) && full !== resolve(root) ? full : null;
  }
  const full = resolve(root, named.replace(/^\.[\\/]+/, ""));
  return within(root, full) && resolve(full) !== resolve(root) ? full : null;
}
/** The workspace path ("Subjects/Physics/a.pdf") of a path the AI named, or null outside it. */
export function workspaceRelative(root: string, path: unknown) {
  const full = workspacePath(root, path);
  return full ? relative(resolve(root), full).split(sep).join("/") : null;
}

/** Gives every file its own path: a second "notes.pdf" in the same folder becomes "notes (2).pdf". */
export function distinctPaths<T extends { path: string }>(files: T[]) {
  const seen = new Set<string>();
  return files.map((f) => {
    let path = f.path, n = 1;
    const dot = path.lastIndexOf("."), slash = path.lastIndexOf("/");
    const [stem, ext] = dot > slash + 1 ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
    while (seen.has(path.toLowerCase())) path = `${stem} (${++n})${ext}`;
    seen.add(path.toLowerCase());
    return { ...f, path };
  });
}

/** One sync at a time per folder: chats share it, and two answers starting together must not copy over each other. */
const syncing = new Map<string, Promise<unknown>>();

/**
 * Brings the mirror up to date: copies what is new or changed (or was changed here since), removes what Mowr mirrored
 * before and no longer has unless `keep` says it stays (another chat's attachments), and never touches Drafts or
 * Outputs. Returns every path now mirrored.
 */
export function syncMirror(root: string, files: MirrorFile[], keep: MirrorPlan["keep"] = () => false, lane = "") {
  const key = resolve(root).toLowerCase();
  const run = (syncing.get(key) || Promise.resolve()).catch(() => {}).then(() => syncNow(root, files, keep, lane));
  syncing.set(key, run);
  void run.finally(() => { if (syncing.get(key) === run) syncing.delete(key); }).catch(() => {});
  return run;
}
async function syncNow(root: string, files: MirrorFile[], keep: MirrorPlan["keep"], lane: string) {
  await mkdir(root, { recursive: true });
  await Promise.all([DRAFTS, OUTPUTS].map((d) => mkdir(join(root, d, lane), { recursive: true })));
  // Each copy is recorded as "stamp|size|mtime": a copy the AI changed no longer matches and is copied again.
  let before: Record<string, string> = {}, first = false;
  try { before = JSON.parse(await readFile(join(root, MANIFEST), "utf8")); } catch { first = true; /* the first answer here */ }
  const after: Record<string, string> = {};
  const wanted = new Set(files.map((f) => f.path.toLowerCase()));
  const gone: string[] = [];
  for (const old of Object.keys(before)) {
    if (wanted.has(old.toLowerCase())) continue;
    if (keep(old, before[old])) { after[old] = before[old]; continue; }
    const full = workspacePath(root, old);
    if (full) gone.push(full);
  }
  await Promise.all(gone.map((full) => rm(full, { force: true }).catch(() => {})));
  // A few at a time: the person may keep hundreds of files.
  const queue = [...files];
  const work = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const full = workspacePath(root, f.path);
      if (!full) continue;
      const was = before[f.path]?.split("|") || [];
      try {
        // A copy that is still as Mowr left it is not read again: one stat per file on an unchanged answer.
        const here = was[0] === f.stamp ? await stat(full).catch(() => null) : null;
        const present = !!here && here.isFile() && String(here.size) === was[1] && String(Math.round(here.mtimeMs)) === was[2];
        if (present) { after[f.path] = before[f.path]; continue; }
        await mkdir(dirname(full), { recursive: true });
        if ("file" in f.from) await copyFile(f.from.file, full);
        else await writeFile(full, "bytes" in f.from ? f.from.bytes : await f.from.make());
        const copy = await stat(full);
        after[f.path] = [f.stamp, copy.size, Math.round(copy.mtimeMs)].join("|");
      } catch { /* a file missing from this PC is left out, not fatal */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, work));
  const sorted = (m: Record<string, string>) => JSON.stringify(Object.keys(m).sort().map((k) => [k, m[k]]));
  if (first || sorted(after) !== sorted(before)) await writeFile(join(root, MANIFEST), JSON.stringify(after));
  // Folders the mirror emptied go too, so the AI does not see folders the person deleted. Only removals empty a
  // folder, so an answer that removed nothing skips walking the tree.
  if (first || gone.length) for (const top of [...LIBRARY, ATTACHMENTS, MADE, TEXT]) await pruneEmpty(join(root, top));
  return Object.keys(after).sort((a, b) => a.localeCompare(b));
}
async function pruneEmpty(folder: string): Promise<boolean> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => null);
  if (!entries) return false;
  let empty = true;
  for (const e of entries) if (!e.isDirectory() || !(await pruneEmpty(join(folder, e.name)))) empty = false;
  if (empty) await rm(folder, { recursive: true, force: true }).catch(() => {});
  return empty;
}

/** What the files of a Mowr workspace look like to this module (core/types.ts StoredFile, Space and Chat, in part). */
type Stored = { id: string; name: string; size: number; type: string; created: number; updated?: number; spaceId: string | null; folderId?: string | null; remote?: boolean };
type Folder = { id: string; name: string; parentId: string | null };
type SpaceLike = { id: string; name?: string; kind?: string; sources?: string[]; folders?: Folder[] };
type ChatLike = { id: string; temporary?: boolean; messages?: { role: string; attachments?: string[]; context?: string[] }[] };
export type WorkspaceState = { files?: Stored[]; spaces?: SpaceLike[]; chats?: ChatLike[] } | null;

/** A folder's path inside its space ("Lectures/Week 1"), from the folders the person made. */
function folderPath(folders: Folder[], id: string | null | undefined) {
  const parts: string[] = [];
  for (let at = folders.find((f) => f.id === id), guard = 0; at && guard < 20; at = folders.find((f) => f.id === at!.parentId), guard++) parts.unshift(safeName(at.name, 60));
  return parts.join("/");
}
/** Each subject's and project's folder ("Subjects/Physics"); two of the same name get "(2)". */
export function spaceFolders(spaces: SpaceLike[] = []) {
  const out = new Map<string, string>(), seen = new Set<string>();
  for (const s of spaces) {
    const top = s.kind === "project" ? PROJECTS : SUBJECTS, base = `${top}/${safeName(s.name || (s.kind === "project" ? "Project" : "Subject"), 60)}`;
    let path = base, n = 1;
    while (seen.has(path.toLowerCase())) path = `${base} (${++n})`;
    seen.add(path.toLowerCase());
    out.set(s.id, path);
  }
  return out;
}
/** Formats every CLI here reads itself: plain text and code, PDFs and pictures. */
const readable = (name: string) => /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|swift|kt|sql|sh|ps1|bat|ya?ml|toml|ini|cfg|log|tex|bib|srt|vtt|ics|svg|pdf|png|jpe?g|gif|webp|bmp)$/i.test(name);

/** A short, stable name for an id, so paths stay well inside Windows' 260-character limit. */
const short = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 12);
/** A chat's own lane in the shared folder ("chat-1a2b3c4d"); a request outside any chat (or a temporary chat) gets a
 *  lane of its own ("once-…") that goes with its answer. */
export function workspaceLane(chat: string | undefined, request: string) {
  return chat ? "chat-" + short(chat).slice(0, 8) : "once-" + short(request).slice(0, 8);
}
/** The folders of one lane, removed with an answer outside any chat. */
export const laneFolders = (root: string, lane: string) => [DRAFTS, OUTPUTS, ATTACHMENTS, MADE, `${TEXT}/${ATTACHMENTS}`].map((top) => join(root, top, lane));

/**
 * Which files go where for one answer. `blob(id)` is where Mowr keeps a file's bytes on this PC; `officeText(path,
 * name)` reads an Office file's text (desktop/office-text.ts). `library` is the text the window read from this
 * conversation's files (OCR included): it goes to _text/ for PDFs and pictures whose text came from OCR, PDFs for a CLI
 * without a PDF viewer, and files with no copy here (a Drive file read for this answer). `attached`: PDFs the window
 * sent with the request, which the saved workspace may not list yet. `documents`: files Mowr made in this conversation.
 */
export function mirrorFor({ state, scope, chat, lane, blob, officeText, library = [], attached = [], documents = [], pdfText = true, running }: {
  state: WorkspaceState;
  scope: string;
  chat?: string;
  lane: string;
  blob: (id: string) => string;
  officeText?: (path: string, name: string) => Promise<string>;
  library?: { name: string; text: string }[];
  attached?: { name: string; data: Uint8Array }[];
  documents?: { id: string; name: string }[];
  /** Whether a PDF here also gets its text in _text/. Off for Claude Code and Grok, which open PDFs natively (every page
   *  as drawn, with its text); on for Codex, which cannot. */
  pdfText?: boolean;
  /** Lanes of answers still running (a temporary chat's, a request's outside any chat): their files stay too. */
  running?: { has(lane: string): boolean };
}): MirrorPlan {
  const files = (state?.files || []).filter((f) => !f.remote && !String(f.id).startsWith("drive_"));
  const spaces = state?.spaces || [];
  const places = spaceFolders(spaces);
  const spaceId = /^(subject|project):/.test(scope) ? scope.split(":")[1] : null;
  const space = spaceId ? spaces.find((s) => s.id === spaceId) : undefined;
  const conversation = chat ? state?.chats?.find((c) => c.id === chat) : undefined;
  const sourceIds = new Set<string>([...(space?.sources || []), ...(conversation?.messages || []).filter((m) => m.role === "user").flatMap((m) => [...(m.attachments || []), ...(m.context || [])])]);
  const stamp = (f: Stored) => `${f.size}:${f.updated || f.created}`;
  const out: MirrorFile[] = [];
  const done = new Set<string>();
  // Every file the person keeps, where it is in Mowr.
  for (const f of files) {
    if (f.size > MAX_FILE || MEDIA.test(f.type || "")) continue;
    const place = f.spaceId ? places.get(f.spaceId) : undefined;
    const folder = place ? folderPath(spaces.find((s) => s.id === f.spaceId)?.folders || [], f.folderId) : "";
    done.add(f.id);
    out.push({ path: `${place || FILES}/${folder ? folder + "/" : ""}${safeName(f.name)}`, stamp: stamp(f), from: { file: blob(f.id) }, id: f.id, ...(sourceIds.has(f.id) ? { source: true } : {}) });
  }
  for (const d of documents) {
    if (done.has(d.id)) continue;
    done.add(d.id);
    out.push({ path: `${MADE}/${lane}/${safeName(d.name)}`, stamp: "made:" + d.id, from: { file: blob(d.id) }, id: d.id });
  }
  const mirrored = distinctPaths(out);
  const byName = (name: string) => {
    const all = mirrored.filter((m) => m.path.split("/").pop()!.toLowerCase() === name.toLowerCase());
    const here = space ? places.get(space.id) + "/" : undefined;
    return all.find((m) => m.source) || all.find((m) => here && m.path.startsWith(here)) || all[0];
  };
  for (const pdf of attached) {
    const name = safeName(pdf.name);
    const known = byName(name);
    if (known) known.source = true;
    else mirrored.push({ path: `${ATTACHMENTS}/${lane}/${name}`, stamp: `bytes:${pdf.data.byteLength}`, from: { bytes: pdf.data }, source: true });
  }
  // Text of the files no CLI opens itself, at the file's own path: Office files read here, for every file.
  const texts = new Map<string, MirrorFile>();
  if (officeText) for (const m of mirrored) {
    const f = m.id ? files.find((x) => x.id === m.id) : undefined;
    if (f && OFFICE.test(f.name) && !m.path.startsWith(MADE + "/")) texts.set(`${TEXT}/${m.path}.txt`.toLowerCase(), { path: `${TEXT}/${m.path}.txt`, stamp: "office:" + stamp(f), from: { make: () => officeText(blob(f.id), f.name) } });
  }
  // The window's own reading of this conversation's files: scans read by OCR, and PDFs for a CLI without a PDF viewer.
  // Its stamp carries the file's, so the text stays for other chats until the file changes (keep, below).
  for (const item of library) {
    const name = safeName(item.name.split(/[\\/]/).pop() || item.name);
    const here = byName(name);
    const pdf = /\.pdf$/i.test(name), ocr = /\bOCR\b|text read from the scanned page/.test(item.text.slice(0, 20000));
    if (!item.text?.trim()) continue;
    if (here) {
      const f = here.id ? files.find((x) => x.id === here.id) : undefined;
      if (OFFICE.test(name) && officeText) continue;
      if (pdf ? !pdfText && !ocr : readable(name) && !ocr) continue;
      const path = `${TEXT}/${here.path}.txt`;
      texts.set(path.toLowerCase(), { path, stamp: `text:${f ? stamp(f) : here.stamp.replace(/[|:]/g, "_")}:${item.text.length}:${hash(item.text)}`, from: { bytes: item.text } });
    } else {
      const path = `${TEXT}/${ATTACHMENTS}/${lane}/${name}.txt`;
      texts.set(path.toLowerCase(), { path, stamp: `text:${item.text.length}:${hash(item.text)}`, from: { bytes: item.text } });
    }
  }
  const all = distinctPaths([...mirrored, ...texts.values()]);
  // Lanes of the chats that still exist and of answers still running: their attachments and made files stay; a deleted chat's go.
  const lanes = new Set((state?.chats || []).filter((c) => !c.temporary).map((c) => workspaceLane(c.id, "")));
  const stamps = new Map(mirrored.filter((m) => m.id).map((m) => [m.path.toLowerCase(), m.stamp]));
  const keep = (path: string, recorded: string) => {
    const laned = new RegExp(`^(?:${ATTACHMENTS}|${MADE}|${TEXT}/${ATTACHMENTS})/([^/]+)/`).exec(path);
    if (laned) return laned[1] !== lane && (lanes.has(laned[1]) || !!running?.has(laned[1]));
    // A file's text the window read in another chat stays while the file is as it was then.
    if (path.startsWith(TEXT + "/") && recorded.startsWith("text:")) {
      const of = stamps.get(path.slice(TEXT.length + 1, -4).toLowerCase());
      return !!of && recorded.startsWith(`text:${of}:`);
    }
    return false;
  };
  return { files: all, keep };
}
/** A short fingerprint of a text, so a changed extraction is written again. */
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += Math.max(1, Math.floor(text.length / 4096))) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** The Mowr file id a path in the working folder is a copy of (or its text in _text/), for tool requests that name one. */
export function mirroredId(files: MirrorFile[], path: string) {
  const wanted = path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  const plain = wanted.startsWith(TEXT + "/") ? wanted.slice(TEXT.length + 1).replace(/\.txt$/, "") : wanted;
  return files.find((f) => f.id && f.path.toLowerCase() === plain)?.id;
}

/**
 * What the AI is told about its folder: where everything is, which subjects and projects there are (with how many
 * files each holds), this answer's sources, then the files of this conversation's subject or project. The others' files
 * are not listed (the AI lists those folders itself), so the note stays small for a large library.
 */
export function workspaceNote(root: string, paths: string[], sources: string[], { folders = [], otherFolders = [], lane = "", here = "", nativePdf = true }: {
  /** Linked PC folders of this conversation's subject or project (edits to them are proposed). */
  folders?: { name: string; path: string }[];
  /** Linked PC folders of the person's other subjects and projects (read only). */
  otherFolders?: { name: string; path: string; of: string }[];
  lane?: string;
  /** This conversation's subject or project folder ("Subjects/Physics"); "" outside one. */
  here?: string;
  /** The CLI opens PDFs itself (Claude Code, Grok); Codex has no PDF viewer, so it looks at a PDF's pages through Kinetra
   *  and has the text in _text/ to search. */
  nativePdf?: boolean;
} = {}) {
  const lanePath = (top: string) => lane ? `${top}/${lane}/` : `${top}/`;
  const list = (items: string[], limit: number) => items.slice(0, limit).map((p) => "- " + p).join("\n") + (items.length > limit ? `\n- … and ${items.length - limit} more (list the folder to see them)` : "");
  const library = paths.filter((p) => LIBRARY.some((top) => p.startsWith(top + "/")));
  // Each subject and project with its file count, so the AI knows what there is before listing anything.
  const counts = new Map<string, number>();
  for (const p of library) { const [top, name] = p.split("/"); const key = top === FILES ? FILES + "/" : `${top}/${name}/`; counts.set(key, (counts.get(key) || 0) + 1); }
  const overview = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `- ${k} (${n} file${n === 1 ? "" : "s"})`);
  const others = library.filter((p) => !sources.includes(p));
  // This conversation's subject or project file by file; the others by name and count (overview), listed when needed.
  const shown = here ? others.filter((p) => p.startsWith(here + "/")) : [];
  const attachments = paths.filter((p) => p.startsWith(`${ATTACHMENTS}/${lane}/`)), made = paths.filter((p) => p.startsWith(`${MADE}/${lane}/`));
  const text = paths.filter((p) => p.startsWith(TEXT + "/"));
  return [
    `YOUR WORKING FOLDER (${root}) holds every file the person keeps in Mowr, as real files, organised as in Mowr: Subjects/<subject>/ and Projects/<project>/ (each with the folders the person made in it) and Files/ (files in no subject or project). Find, list, search, read and open them with your own file tools (${nativePdf ? "PDFs and pictures open natively, every page as drawn with its text; from a long PDF open the pages you need, several ranges at once" : "pictures open natively; PDFs as below"}). This is the complete set: when the person asks about their files, subjects or projects, answer from these folders (list them; never guess, never say you cannot see them). They are copies kept in step with Mowr: read them, never change them (a change here changes nothing for the person).`,
    here ? `THIS CONVERSATION IS IN ${here}/: start there, and use the other subjects' and projects' files whenever the request needs or mentions them.` : "This conversation is in no subject or project; every subject's and project's files are still here for you to use.",
    overview.length ? `What is here (list or search a folder to see its files):\n${overview.join("\n")}` : "The person has no files in Mowr yet.",
    sources.length ? `SOURCES OF THIS ANSWER (attached in the chat or chosen as sources); base the answer on these and cite them as [[file name, p. N]]:\n${list(sources, 80)}` : "No file is attached to this conversation.",
    shown.length ? `${sources.length ? "The other files" : "The files"} of ${here}/:\n${list(shown, 200)}` : "",
    attachments.length ? `${lanePath(ATTACHMENTS)}: files attached in this chat that are not saved in Mowr yet:\n${list(attachments, 40)}` : "",
    made.length ? `${lanePath(MADE)}: files Mowr made earlier in this chat:\n${list(made, 40)}` : "",
    text.length ? `${TEXT}/: text Mowr read from files your tools cannot open, at each file's own path with .txt added (the text of Subjects/X/notes.docx is ${TEXT}/Subjects/X/notes.docx.txt): every Word, PowerPoint and Excel file (read them only from here)${nativePdf ? "" : ", PDFs"} and scanned pages read by OCR. Pages and slides are marked "[name, page N]" or "[name, slide N]".` : "",
    nativePdf ? "" : `PDFs: you have no PDF viewer of your own, so read a PDF as drawn by looking at its pages with Kinetra's look (up to 8 pages a call; ask for every page you need at once, as parallel calls or one batch), the way a PDF sent to a chat is seen. Name the PDF by its path here. Its text in ${TEXT}/, where there is one, is for searching and quoting; never take a page's drawings, tables, formulas or layout from the text alone.`,
    `${lanePath(DRAFTS)}: your own working files for this chat, such as a document's Markdown source; kept for later answers. Write nowhere else but here and ${lanePath(OUTPUTS)}.`,
    `${lanePath(OUTPUTS)}: any file you write here (.csv, .py, .tex, .html, .txt…) is delivered to the person with your answer. Make PDF, Word, PowerPoint and Excel files with Kinetra instead, so they are typeset properly.`,
    folders.length ? `Linked folders on this PC (read only; changes to their files are proposed as edits the person applies):\n${folders.map((f) => `- ${f.name}: ${f.path}`).join("\n")}` : "",
    otherFolders.length ? `PC folders linked to the person's other subjects and projects (read only; open them by these paths when the request needs them):\n${otherFolders.map((f) => `- ${f.name} (${f.of}): ${f.path}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Files in this chat's Outputs/ that are new or changed since `since` (ms), for delivery with the answer. */
export async function newOutputs(root: string, since: number, lane = "") {
  const base = join(root, OUTPUTS, lane);
  const found: { path: string; name: string; size: number }[] = [];
  const walk = async (folder: string, depth: number) => {
    for (const e of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const full = join(folder, e.name);
      if (e.isDirectory()) { if (depth < 4) await walk(full, depth + 1); continue; }
      const s = await stat(full).catch(() => null);
      if (s?.isFile() && s.mtimeMs >= since - 1000 && s.size > 0 && s.size <= MAX_FILE) found.push({ path: full, name: relative(base, full).split(sep).join("/"), size: s.size });
    }
  };
  await walk(base, 0);
  return found.slice(0, 40);
}

/** The per-subject and per-chat folders earlier versions made; each held its own copy of the files, now in one folder. */
export async function removeOldFolders(work: string) {
  for (const e of await readdir(work, { withFileTypes: true }).catch(() => []))
    if (e.isDirectory() && /^(space|chat|once)-[0-9a-f]{12}$/.test(e.name)) await rm(join(work, e.name), { recursive: true, force: true }).catch(() => {});
}
