import { get, set } from "idb-keyval";
import { extractFiles } from "./documents";
import { loadEdits } from "./document-state";
import { sourceExcerpts } from "../core/source-context";
import { distinctNames } from "../core/file-tools";
import type { StoredFile } from "../core/types";
import { contextBudget } from "../core/context-budget";
/** Reads a stored file's text once, then reuses it until the file (or its saved edits) changes.
 *  The cache is keyed on the edit revision and the file's size and update time, so any overwrite of the file refreshes it. */
export async function cachedFileText(file: StoredFile, owner: string, signal?: AbortSignal) {
  const stamp = `${(await loadEdits(file)).revision}:${file.size}:${file.updated || file.created}`,
    key = `mowr-source:${owner}:${file.id}`;
  const cached = await get<{ stamp?: string; text: string }>(key);
  if (cached?.stamp === stamp) return cached.text;
  const text = await extractFiles([file], signal);
  await set(key, { stamp, text });
  return text;
}
/** The text of the given files for one request. `focus` (files attached to this message or open beside the
 *  chat) get the largest share when everything cannot be sent whole, then `related` (used earlier in the chat). */
export async function localSourceContext(
  files: StoredFile[],
  query: string,
  owner: string,
  signal?: AbortSignal,
  { focus = [], related = [], budget = contextBudget().sources, library }: { focus?: string[]; related?: string[]; budget?: number; library?: { name: string; text: string }[] } = {},
) {
  const sources: { name: string; text: string }[] = [], focused: number[] = [], earlier: number[] = [], skipped: string[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    // One unreadable source (a video, a scanned PDF, an oversized file) must not block the others.
    try {
      const text = await cachedFileText(file, owner, signal);
      if (!text.trim()) { skipped.push(file.name); continue; }
      if (focus.includes(file.id)) focused.push(sources.length);
      else if (related.includes(file.id)) earlier.push(sources.length);
      sources.push({ name: file.name, text });
    } catch (e) {
      if (signal?.aborted) throw e;
      skipped.push(file.name);
    }
  }
  // Same-named files get distinct names, so the index, citations and file tools can tell them apart.
  const named = distinctNames(sources);
  // The whole text goes along too, so the model can read what did not fit (core/file-tools.ts).
  library?.push(...named);
  const text = sourceExcerpts(named, query, budget, focused, earlier);
  return skipped.length ? `${text}\n(Could not read: ${skipped.join(", ")}.)`.trim() : text;
}
