import { desktop } from "../desktop/bridge";
import { searchDocs, type SearchDoc } from "../../core/search";
import { driveFolder, isGoogleFormat } from "../drive/drive";
import type { Space, StoredFile } from "../../core/types";

/**
 * The AI finding the person's files on its own: every file saved in Clem (each subject, project and the workspace, not
 * only this chat's) and their Google Drive, by name and by what they say. A file it then attaches is read into this
 * answer, so search, read, look and crop work on it as on any attached file. Runs here, where the files are; the
 * desktop app asks for it through the conversation's window tasks (desktop/main.ts "find" and "attach").
 */
export type Finder = {
  files: () => StoredFile[];
  spaces: () => Space[];
  /** A file's text, read once and kept (src/source-context.ts cachedFileText). */
  text: (file: StoredFile) => Promise<string>;
  /** Files attached during this answer, so look and crop can open them too. */
  opened: StoredFile[];
  /** Drive files this answer's searches found, by id, so they can be attached. */
  found: Map<string, { name: string; mimeType: string; size?: number }>;
  /** Google Drive folders linked to subjects and projects (this chat's own first): searched file by file, so a file
   *  in one is found even when Drive's search of the whole Drive ranks others first. */
  driveFolders?: () => { id: string; name: string; where: string }[];
  signal?: AbortSignal;
};

/** How long a search may spend reading files it has not read before; the rest are still found by name. */
const READ_MS = 15_000;
const MAX_TEXT_FILE = 60_000_000;

const where = (finder: Finder, file: StoredFile) => {
  const space = file.spaceId ? finder.spaces().find((s) => s.id === file.spaceId) : undefined;
  return space ? `${space.kind} "${space.name}"` : "Files (no subject or project)";
};
const pagesOf = (text: string) => [...text.matchAll(/\n\[[^\n]*?, page (\d+)\]\n/g)].reduce((n, m) => Math.max(n, Number(m[1])), 0);

export async function findTask(finder: Finder, op: string, args: any): Promise<{ data?: unknown; files?: Uint8Array[] }> {
  if (op === "find") return { data: await find(finder, String(args?.query || "").slice(0, 300), !!args?.driveOnly) };
  if (op === "attach") return attach(finder, String(args?.file || "").slice(0, 400));
  throw Error(`Unknown task "${op}".`);
}

/** `driveOnly`: the AI already has every Clem file in its working folder (desktop/ai-workspace.ts), so only Drive is searched. */
async function find(finder: Finder, query: string, driveOnly = false) {
  if (!query.trim()) return { error: 'Give "query": words from the file\'s name or from what it says.' };
  const files = driveOnly ? [] : finder.files().filter((f) => !f.remote);
  const until = Date.now() + READ_MS;
  const docs: SearchDoc[] = [];
  let unread = 0;
  for (const file of files) {
    finder.signal?.throwIfAborted();
    let text = "";
    // Images are found by name; a file read before costs nothing, others are read while time allows.
    if (!file.type.startsWith("image/") && file.size <= MAX_TEXT_FILE) {
      if (Date.now() < until) text = await finder.text(file).catch(() => "");
      else unread++;
    }
    docs.push({ id: file.id, kind: "file", title: file.name, text, meta: where(finder, file), updated: file.updated || file.created });
  }
  const hits = searchDocs(docs, query, 10).map((h) => {
    const file = files.find((f) => f.id === h.doc.id)!;
    const pages = pagesOf(h.doc.text);
    return { file: file.name, id: file.id, where: h.doc.meta, ...(pages ? { pages } : {}), excerpt: h.snippet.text.slice(0, 400) };
  });
  // The linked Drive folders, every file in them: by name and path here, by what they say through Drive's own index.
  const linked: { file: string; id: string; where: string }[] = [];
  const add = (f: { id: string; name: string; mimeType: string; size?: number }, place: string) => {
    if (/^(video|audio|image)\//.test(f.mimeType) || linked.some((x) => x.id === "drive:" + f.id)) return;
    finder.found.set(f.id, { name: f.name, mimeType: f.mimeType, size: f.size });
    linked.push({ file: f.name, id: "drive:" + f.id, where: place });
  };
  await Promise.all((finder.driveFolders?.() || []).slice(0, 8).map(async (folder) => {
    try {
      const found = await driveFolder(folder.id, query, false, 20);
      const files = found.items.filter((i) => !i.folder);
      const named = searchDocs(files.map((f) => ({ id: f.id, kind: "file", title: f.name, text: f.path || "", meta: "", updated: Date.parse(f.modified || "") || 0 })), query, 20).map((h) => files.find((f) => f.id === h.doc.id)!);
      for (const f of [...named, ...found.hits]) add(f, `Google Drive folder "${folder.name}"${"path" in f && f.path ? " / " + f.path : ""} (linked to ${folder.where})`);
    } catch { /* a folder that cannot be listed now is left out; Drive's own search below still runs */ }
  }));
  // Google Drive, when it is connected: its own search, by name and content.
  let drive: unknown[] = [], driveNote: string | undefined;
  try {
    const found = await desktop!.invoke({ action: "driveSearch", query });
    if (found?.connected) drive = (found.files || []).filter((f: { id: string; mimeType: string }) => !/^(video|audio|image)\//.test(f.mimeType) && !linked.some((x) => x.id === "drive:" + f.id)).slice(0, 8).map((f: { id: string; name: string; mimeType: string; size?: number }) => {
      finder.found.set(f.id, { name: f.name, mimeType: f.mimeType, size: f.size });
      return { file: f.name, id: "drive:" + f.id, where: "Google Drive" };
    });
    else driveNote = "Google Drive is not connected, so only files saved in Clem were searched.";
  } catch { driveNote = "Google Drive could not be searched right now."; }
  drive = [...linked.slice(0, 20), ...drive];
  return {
    query,
    results: [...hits, ...drive],
    ...(hits.length + drive.length ? { next: 'Attach the ones you need with {"action":"attach","file":"its id"}; then read, search, look and crop work on them.' } : { note: "Nothing matches. Try other words, or part of the file's name." }),
    ...(unread ? { unread: `${unread} files were found by name only (not read yet); search again to read more of them.` } : {}),
    ...(driveNote ? { drive: driveNote } : {}),
  };
}

async function attach(finder: Finder, wanted: string) {
  let file: StoredFile | undefined;
  if (/^drive:[\w-]{10,200}$/.test(wanted)) {
    // A Drive file is read live, never saved here; Google Docs and Slides come as PDF.
    const id = wanted.slice(6), ref = finder.found.get(id);
    if (!ref) throw Error("Find the Drive file first with {\"action\":\"find\"}, then attach it by the id given.");
    file = { id: "drive_" + id, name: ref.name, size: ref.size || 0, type: isGoogleFormat(ref.mimeType) ? "application/pdf" : ref.mimeType, created: Date.now(), spaceId: null };
  } else {
    const all = finder.files().filter((f) => !f.remote);
    file = all.find((f) => f.id === wanted) || all.find((f) => f.name.toLowerCase() === wanted.toLowerCase());
  }
  if (!file) throw Error(`No file "${wanted}". Use an id from {"action":"find"}.`);
  const text = await finder.text(file);
  if (!finder.opened.some((f) => f.id === file!.id)) finder.opened.push(file);
  const pages = pagesOf(text);
  return {
    data: { attached: file.name, id: file.id, where: file.id.startsWith("drive_") ? "Google Drive" : where(finder, file), characters: text.length, ...(pages ? { pages } : {}), start: text.slice(0, 4000) },
    files: [new TextEncoder().encode(text)],
  };
}
