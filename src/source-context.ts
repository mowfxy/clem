import { get, set } from "idb-keyval";
import { extractFiles } from "./documents";
import { loadEdits } from "./document-state";
import { sourceExcerpts } from "../core/source-context";
import type { StoredFile } from "../core/types";
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
export async function localSourceContext(
  files: StoredFile[],
  query: string,
  owner: string,
  signal?: AbortSignal,
) {
  const sources = [], skipped: string[] = [];
  for (const file of files) {
    signal?.throwIfAborted();
    // One unreadable source (a video, a scanned PDF, an oversized file) must not block the others.
    try {
      sources.push({ name: file.name, text: await cachedFileText(file, owner, signal) });
    } catch (e) {
      if (signal?.aborted) throw e;
      skipped.push(file.name);
    }
  }
  const text = sourceExcerpts(sources, query);
  return skipped.length ? `${text}\n(Could not read: ${skipped.join(", ")}.)`.trim() : text;
}
