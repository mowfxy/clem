import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";

/**
 * The folder a CLI works in (Claude Code, Grok Build and Codex run in it as their working directory), so each one
 * reads, searches and opens the person's files with its own tools, as it would in any project. A subject or project
 * has one folder for all its chats; a chat outside one has its own:
 *
 *   Files/        every file of the subject or project, in the folders the person made in Mowr
 *   Attachments/  files attached in the chat that are not files of the subject or project
 *   Made/         files Mowr made earlier in the chat (outside a subject or project)
 *   _text/        the text Mowr read from each document, page by page (Word, PowerPoint, Excel, PDFs, OCR of scans):
 *                 a long PDF is read from its text first and only the pages whose drawings matter are opened
 *   Drafts/       the AI's own working files (a document's Markdown source); kept between answers
 *   Outputs/      files the AI writes for the person: each new or changed one is delivered with the answer
 *
 * In a subject's or project's folder each chat has its own lane in Drafts/ and Outputs/ (Drafts/chat-1a2b3c4d/), so
 * two chats answering at once never overwrite each other's drafts or receive each other's files.
 *
 * Which of them this answer is about (attached in the chat, or chosen as the space's sources) is said in the message,
 * not by moving them, so two chats of one subject can answer at the same time. The person's files are copies: nothing
 * a CLI does here changes Mowr's own copy, and a copy it changed is copied again before the next answer. Files,
 * Attachments, Made and _text are Mowr's mirror; Drafts and Outputs belong to the AI.
 */
export const ATTACHMENTS = "Attachments", FILES = "Files", MADE = "Made", TEXT = "_text", DRAFTS = "Drafts", OUTPUTS = "Outputs";
const MANIFEST = ".mowr-mirror.json";
/** The largest file mirrored; bigger ones (and audio and video, which no CLI here can read) are left out. */
const MAX_FILE = 200_000_000;
const MEDIA = /^(audio|video)\//;

export type MirrorFile = {
  /** Path inside the workspace, with forward slashes ("Files/Lectures/Week 1.pdf"). */
  path: string;
  /** Changes whenever the file's contents may have changed (its size and time). */
  stamp: string;
  /** The bytes, read only when the copy here is missing or out of date: a file on disk to copy, or bytes to write. */
  from: { file: string } | { bytes: Uint8Array | string };
  /** One of this answer's sources (attached in the chat, or chosen as sources of the subject or project). */
  source?: boolean;
};

/** A name safe for Windows: no reserved characters, no trailing dot or space, never "..". */
export function safeName(name: string) {
  // Kept short: Windows paths past 260 characters fail in some programs, and the folder itself is already deep.
  const clean = String(name || "file").replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").replace(/[. ]+$/g, "").trim().slice(0, 100);
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
  // A drive or UNC path is never inside the workspace, on any platform.
  if (/^([a-z]:|[\\/]{2})/i.test(path.trim())) return null;
  const full = resolve(root, path.trim().replace(/^\.[\\/]+/, ""));
  return within(root, full) && resolve(full) !== resolve(root) ? full : null;
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

/**
 * Brings the mirror up to date: copies what is new or changed (or was changed here since), removes what Mowr mirrored
 * before and no longer has, keeps paths under `keep` (another chat's attachments in a shared subject folder), and never
 * touches Drafts or Outputs. Returns every path now mirrored.
 */
export async function syncMirror(root: string, files: MirrorFile[], keep: string[] = [], lane = "") {
  await mkdir(root, { recursive: true });
  await Promise.all([DRAFTS, OUTPUTS].map((d) => mkdir(join(root, d, lane), { recursive: true })));
  // Each copy is recorded as "stamp|size|mtime": a copy the AI changed no longer matches and is copied again.
  let before: Record<string, string> = {};
  try { before = JSON.parse(await readFile(join(root, MANIFEST), "utf8")); } catch { /* the first answer here */ }
  const after: Record<string, string> = {};
  const wanted = new Set(files.map((f) => f.path.toLowerCase()));
  for (const old of Object.keys(before)) {
    if (wanted.has(old.toLowerCase())) continue;
    if (keep.some((k) => old.startsWith(k + "/"))) { after[old] = before[old]; continue; }
    const full = workspacePath(root, old);
    if (full) await rm(full, { force: true }).catch(() => {});
  }
  // A few at a time: a subject may hold hundreds of files.
  const queue = [...files];
  const work = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const full = workspacePath(root, f.path);
      if (!full) continue;
      const was = before[f.path]?.split("|") || [];
      try {
        const present = was[0] === f.stamp && (await stat(full).then((s) => s.isFile() && String(s.size) === was[1] && String(Math.round(s.mtimeMs)) === was[2], () => false));
        if (!present) {
          await mkdir(dirname(full), { recursive: true });
          if ("file" in f.from) await copyFile(f.from.file, full);
          else await writeFile(full, f.from.bytes);
        }
        const copy = await stat(full);
        after[f.path] = [f.stamp, copy.size, Math.round(copy.mtimeMs)].join("|");
      } catch { /* a file missing from this PC is left out, not fatal */ }
    }
  };
  await Promise.all(Array.from({ length: 6 }, work));
  await writeFile(join(root, MANIFEST), JSON.stringify(after));
  // Folders the mirror emptied go too, so the AI does not see folders the person deleted.
  for (const top of [ATTACHMENTS, FILES, MADE, TEXT]) await pruneEmpty(join(root, top));
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
type SpaceLike = { id: string; sources?: string[]; folders?: Folder[] };
type ChatLike = { id: string; messages?: { role: string; attachments?: string[]; context?: string[] }[] };
export type WorkspaceState = { files?: Stored[]; spaces?: SpaceLike[]; chats?: ChatLike[] } | null;

/** A folder's path inside its space ("Lectures/Week 1"), from the folders the person made. */
function folderPath(folders: Folder[], id: string | null | undefined) {
  const parts: string[] = [];
  for (let at = folders.find((f) => f.id === id), guard = 0; at && guard < 20; at = folders.find((f) => f.id === at!.parentId), guard++) parts.unshift(safeName(at.name));
  return parts.join("/");
}
/** Formats every CLI here reads itself: plain text and code, PDFs and pictures. */
const readable = (name: string) => /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|swift|kt|sql|sh|ps1|bat|ya?ml|toml|ini|cfg|log|tex|bib|srt|vtt|ics|svg|pdf|png|jpe?g|gif|webp|bmp)$/i.test(name);

/** A short, stable name for an id, so the folder's path stays well inside Windows' 260-character limit. */
const short = (id: string) => createHash("sha256").update(id).digest("hex").slice(0, 12);
/** Where a conversation's folder is: one per subject or project, otherwise one per chat (or per request outside a chat). */
export function workspaceKey(scope: string, chat: string | undefined, request: string) {
  const space = /^(subject|project):([a-zA-Z0-9_-]{1,100})$/.exec(scope)?.[2];
  return space ? "space-" + short(space) : chat ? "chat-" + short(chat) : "once-" + short(request);
}
/** A chat's own lane in a shared subject or project folder ("" in a chat's own folder, where the top level is its own). */
export function workspaceLane(key: string, chat: string | undefined, request: string) {
  return key.startsWith("space-") ? "chat-" + short(chat || request).slice(0, 8) : "";
}

/**
 * Which files go where for one answer. `blob(id)` is where Mowr keeps a file's bytes on this PC. `library` is every
 * file's text as Mowr read it (OCR included); it goes to _text/ for formats the CLIs cannot open themselves, for PDFs
 * and pictures whose text came from OCR, and for files with no copy here (a Drive file read for this answer).
 * `attached`: PDFs the window sent with the request, which the saved workspace may not list yet (attached a moment ago).
 * `documents`: files Mowr made in this conversation.
 */
export function mirrorFor({ state, scope, chat, blob, library = [], attached = [], documents = [] }: {
  state: WorkspaceState;
  scope: string;
  chat?: string;
  blob: (id: string) => string;
  library?: { name: string; text: string }[];
  attached?: { name: string; data: Uint8Array }[];
  documents?: { id: string; name: string }[];
}): MirrorFile[] {
  const files = (state?.files || []).filter((f) => !f.remote && !String(f.id).startsWith("drive_"));
  const spaceId = /^(subject|project):/.test(scope) ? scope.split(":")[1] : null;
  const space = spaceId ? state?.spaces?.find((s) => s.id === spaceId) : undefined;
  const conversation = chat ? state?.chats?.find((c) => c.id === chat) : undefined;
  const sourceIds = new Set<string>([...(space?.sources || []), ...(conversation?.messages || []).filter((m) => m.role === "user").flatMap((m) => [...(m.attachments || []), ...(m.context || [])])]);
  const stamp = (f: Stored) => `${f.size}:${f.updated || f.created}`;
  const out: MirrorFile[] = [];
  const done = new Set<string>();
  const add = (f: Stored, path: string, source = false) => {
    done.add(f.id);
    if (f.size <= MAX_FILE && !MEDIA.test(f.type || "")) out.push({ path, stamp: stamp(f), from: { file: blob(f.id) }, ...(source ? { source } : {}) });
  };
  for (const f of files) {
    if (spaceId && f.spaceId === spaceId) { const folder = folderPath(space?.folders || [], f.folderId); add(f, `${FILES}/${folder ? folder + "/" : ""}${safeName(f.name)}`, sourceIds.has(f.id)); }
    else if (sourceIds.has(f.id)) add(f, `${ATTACHMENTS}/${safeName(f.name)}`, true);
  }
  for (const d of documents) {
    if (done.has(d.id)) continue;
    const f = files.find((x) => x.id === d.id);
    add(f || { id: d.id, name: d.name, size: 0, type: "", created: 0, spaceId: null }, `${MADE}/${safeName(d.name)}`);
  }
  const named = (name: string) => out.find((m) => m.path.split("/").pop()!.toLowerCase() === name.toLowerCase());
  for (const pdf of attached) {
    const name = safeName(pdf.name);
    const known = named(name);
    if (known) known.source = true;
    else out.push({ path: `${ATTACHMENTS}/${name}`, stamp: `bytes:${pdf.data.byteLength}`, from: { bytes: pdf.data }, source: true });
  }
  // Every document's text, PDFs included: reading a long PDF's text first and opening only the pages whose drawings
  // matter keeps far fewer page pictures in the conversation than opening every page.
  for (const item of library) {
    const name = safeName(item.name.split(/[\\/]/).pop() || item.name);
    const here = named(name);
    if (!item.text?.trim() || here && readable(name) && !/\.pdf$/i.test(name) && !/\bOCR\b/.test(item.text.slice(0, 4000))) continue;
    out.push({ path: `${TEXT}/${name}.txt`, stamp: `text:${item.text.length}:${hash(item.text)}`, from: { bytes: item.text } });
  }
  return distinctPaths(out);
}
/** A short fingerprint of a text, so a changed extraction is written again. */
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += Math.max(1, Math.floor(text.length / 4096))) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/**
 * What the AI is told about its folder: this answer's sources first, then the layout and the other files. A long list
 * is cut (the AI can list the folder itself), so the note stays small for a large subject.
 */
export function workspaceNote(root: string, paths: string[], sources: string[], { folders = [], lane = "" }: { folders?: { name: string; path: string }[]; lane?: string } = {}) {
  const drafts = lane ? `${DRAFTS}/${lane}/` : `${DRAFTS}/`, outputs = lane ? `${OUTPUTS}/${lane}/` : `${OUTPUTS}/`;
  const of = (top: string) => paths.filter((p) => p.startsWith(top + "/"));
  const list = (items: string[], limit: number) => items.slice(0, limit).map((p) => "- " + p).join("\n") + (items.length > limit ? `\n- … and ${items.length - limit} more (list the folder to see them)` : "");
  const files = of(FILES).filter((p) => !sources.includes(p)), made = of(MADE), text = of(TEXT);
  return [
    `YOUR WORKING FOLDER (${root}) holds the person's files as real files. Open, search and read them with your own file tools (PDFs and pictures open natively; from a long PDF read the pages you need). They are copies: changing them changes nothing for the person.`,
    sources.length ? `SOURCES OF THIS ANSWER (attached in the chat or chosen as sources); base the answer on these and cite them as [[file name, p. N]]:\n${list(sources, 80)}` : "No file is attached to this conversation.",
    files.length ? `Files/: ${sources.length ? "the other files" : "the files"} of this subject or project, in the person's folders; use them when the request needs or mentions them:\n${list(files, 120)}` : "",
    made.length ? `Made/: files Mowr made earlier in this chat:\n${list(made, 40)}` : "",
    text.length ? `_text/: the text Mowr read from ${text.length} document${text.length === 1 ? "" : "s"}, page by page ("[name, page N]" markers; scanned pages read by OCR), named after the document with .txt added. Read a PDF's text there first, then open with your file tools only the pages you need to see: circuits, diagrams, graphs, tables drawn as pictures, formulas, handwriting and scans (slides with little or no text are usually pictures). Never guess what a drawing shows from the text: open its page. Word, PowerPoint and Excel files are read only from here.` : "",
    `${drafts}: your own working files for this chat, such as a document's Markdown source; kept for later answers.`,
    `${outputs}: any file you write here (.csv, .py, .tex, .html, .txt…) is delivered to the person with your answer. Make PDF, Word, PowerPoint and Excel files with Kinetra instead, so they are typeset properly.`,
    folders.length ? `Linked folders on this PC (read only; changes to their files are proposed as edits the person applies):\n${folders.map((f) => `- ${f.name}: ${f.path}`).join("\n")}` : "",
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
