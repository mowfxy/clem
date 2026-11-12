import MiniSearch from 'minisearch';
import type { Snippet } from './context.ts';

/** Something the main thread can recall: one of its messages, a digest, a subject or project chat's summary, later GUC items. */
export type RecallDoc = { id: string; text: string; source: string; at?: number };

const STOP = new Set(['the', 'and', 'for', 'you', 'that', 'this', 'with', 'what', 'how', 'can', 'are', 'was', 'have', 'from', 'about', 'please', 'help', 'need', 'want', 'just', 'like', 'its', 'not', 'but', 'they', 'them', 'his', 'her', 'our', 'your', 'when', 'will', 'would', 'could', 'should', 'there', 'their', 'which', 'some', 'into', 'then', 'than', 'also', 'any', 'all', 'one', 'out', 'get', 'got']);

/** A small full-text index over what the main thread can recall (MiniSearch: fuzzy, prefix, no dependencies). */
export function recallIndex(docs: RecallDoc[]) {
  const index = new MiniSearch<RecallDoc>({
    fields: ['text', 'source'], storeFields: ['text', 'source', 'at'],
    processTerm: (term) => { const t = term.toLowerCase(); return t.length < 3 || STOP.has(t) ? null : t; },
    searchOptions: { boost: { source: 0.5 }, fuzzy: 0.2, prefix: true, combineWith: 'OR' },
  });
  const seen = new Set<string>();
  index.addAll(docs.filter((d) => d.text.trim() && !seen.has(d.id) && seen.add(d.id)));
  return index;
}

/**
 * The top `k` passages for a message, each quoted as the window of about `chars` characters around its best-matching
 * words. `exclude`: ids already in the request word for word. `minScore` keeps weak, one-common-word hits out.
 */
export function recall(index: MiniSearch<RecallDoc>, query: string, { k = 4, chars = 320, exclude = new Set<string>(), minScore = 2 }: { k?: number; chars?: number; exclude?: Set<string>; minScore?: number } = {}): Snippet[] {
  if (!query.trim()) return [];
  return index.search(query).filter((r) => !exclude.has(String(r.id)) && r.score >= minScore).slice(0, k)
    .map((r) => ({ id: String(r.id), source: String(r.source), text: windowOf(String(r.text), r.terms, chars) }));
}

/** The part of `text` around the first matched term, cut at word boundaries. */
export function windowOf(text: string, terms: string[], chars: number) {
  const flat = text.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
  if (flat.length <= chars) return flat;
  const low = flat.toLowerCase();
  const hit = Math.min(...terms.map((t) => low.indexOf(t.toLowerCase())).filter((i) => i >= 0), flat.length);
  const start = hit >= flat.length ? 0 : Math.max(0, Math.min(hit - Math.floor(chars / 3), flat.length - chars));
  const from = start ? flat.indexOf(' ', start) + 1 || start : 0;
  let piece = flat.slice(from, from + chars);
  if (from + chars < flat.length) piece = piece.slice(0, piece.lastIndexOf(' ') > chars / 2 ? piece.lastIndexOf(' ') : piece.length) + '…';
  return (from ? '…' : '') + piece;
}
