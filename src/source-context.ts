import { get, set } from "idb-keyval";
import { extractFiles } from "./documents";
import { loadEdits } from "./document-state";
import { sourceExcerpts } from "../core/source-context";
import type { StoredFile } from "../core/types";
export async function localSourceContext(
  files: StoredFile[],
  query: string,
  owner: string,
  signal?: AbortSignal,
) {
  const sources = [];
  for (const file of files) {
    signal?.throwIfAborted();
    const revision = (await loadEdits(file)).revision,
      key = `mowr-source:${owner}:${file.id}`;
    const cached = await get<{ revision: number; text: string }>(key);
    const text =
      cached?.revision === revision
        ? cached.text
        : await extractFiles([file], signal);
    if (cached?.revision !== revision) await set(key, { revision, text });
    sources.push({ name: file.name, text });
  }
  return sourceExcerpts(sources, query);
}
