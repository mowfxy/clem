import { get, set } from "idb-keyval";
import { extractFiles } from "./documents";
import { OCR_PENDING } from "./desktop/ocr";
import { loadEdits } from "./document-state";
import { sourceExcerpts } from "../core/source-context";
import { distinctNames } from "../core/file-tools";
import type { StoredFile } from "../core/types";
import { contextBudget } from "../core/context-budget";
/** Reads a stored file's text once, then reuses it until the file (or its saved edits) changes.
 *  The cache is keyed on the edit revision and the file's size and update time, so any overwrite of the file refreshes it. */
export async function cachedFileText(file: StoredFile, owner: string, signal?: AbortSignal) {
  // "v2": PDFs now carry their bookmarks and keep the text of very long ones, so texts read before are read again.
  const stamp = `v2:${(await loadEdits(file)).revision}:${file.size}:${file.updated || file.created}`,
    key = `mowr-source:${owner}:${file.id}`;
  const cached = await get<{ stamp?: string; text: string }>(key);
  if (cached?.stamp === stamp) return cached.text;
  const text = await extractFiles([file], signal);
  // A scan still being read (OCR_PENDING) is not kept: the next request reads its next part.
  if (!text.includes(OCR_PENDING)) await set(key, { stamp, text });
  return text;
}
/** The text of the given files for one request. `focus` (files attached to this message or open beside the
 *  chat) get the largest share when everything cannot be sent whole, then `related` (used earlier in the chat). */
export async function localSourceContext(
  files: StoredFile[],
  query: string,
  owner: string,
  signal?: AbortSignal,
  { focus = [], related = [], budget = contextBudget().sources, library, whole = [] }: { focus?: string[]; related?: string[]; budget?: number; library?: { name: string; text: string }[]; whole?: string[] } = {},
) {
  const sources: { name: string; text: string; id: string }[] = [], skipped: string[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    // One unreadable source (a video, a scanned PDF, an oversized file) must not block the others.
    try {
      const text = await cachedFileText(file, owner, signal);
      if (!text.trim()) { skipped.push(file.name); continue; }
      sources.push({ name: file.name, text, id: file.id });
    } catch (e) {
      if (signal?.aborted) throw e;
      skipped.push(file.name);
    }
  }
  // Same-named files get distinct names, so the index, citations and file tools can tell them apart.
  const named = distinctNames(sources);
  // The whole text goes along too, so the model can read what did not fit (core/file-tools.ts).
  library?.push(...named.map(({ name, text }) => ({ name, text })));
  // PDFs sent to the model whole (`whole`) are read from the files themselves, not from excerpts of their text.
  const excerpted = named.filter((s) => !whole.includes(s.id));
  const at = (ids: string[]) => excerpted.flatMap((s, i) => (ids.includes(s.id) ? [i] : []));
  const text = sourceExcerpts(excerpted.map(({ name, text }) => ({ name, text })), query, budget, at(focus), at(related.filter((id) => !focus.includes(id))));
  return skipped.length ? `${text}\n(Could not read: ${skipped.join(", ")}.)`.trim() : text;
}
