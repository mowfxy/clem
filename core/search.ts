/** Local full-text search over everything in the workspace. Pure and synchronous so the
 *  desktop main process (linked folders) and the renderer (chats, cards, files) rank alike. */
export type SearchKind = 'chat' | 'space' | 'card' | 'file' | 'folder';
export type SearchDoc = { id: string; kind: SearchKind; title: string; text: string; meta?: string; updated?: number };
export type Snippet = { text: string; marks: [number, number][]; line?: number };
export type SearchHit = { doc: SearchDoc; score: number; snippet: Snippet };

/** Lowercases without changing string length, so match offsets map back onto the original text. */
export function fold(text: string) {
  let out = '';
  for (const c of text) { const l = c.toLowerCase(); out += l.length === c.length ? l : c; }
  return out;
}

export function queryTerms(query: string) {
  return [...new Set(fold(query).match(/[\p{L}\p{N}][\p{L}\p{N}_.'-]*/gu) || [])].filter((t) => t.length > 1 || /\p{N}/u.test(t)).slice(0, 12);
}

/** Every term must appear. Titles, whole phrases and recent items rank higher. */
export function scoreDoc(doc: SearchDoc, terms: string[], phrase: string, now = Date.now()) {
  if (!terms.length) return 0;
  const title = fold(doc.title), body = fold(doc.text), meta = fold(doc.meta || '');
  let score = 0;
  for (const term of terms) {
    const inTitle = title.includes(term), inMeta = meta.includes(term);
    const at = body.indexOf(term);
    if (!inTitle && !inMeta && at < 0) return 0;
    if (inTitle) score += title.startsWith(term) ? 14 : 10;
    if (inMeta) score += 3;
    if (at >= 0) {
      score += 4;
      // Count a few more occurrences without scanning huge documents end to end.
      let n = 0, i = at;
      while (n < 6 && (i = body.indexOf(term, i + term.length)) >= 0) n++;
      score += n * 0.6;
      if (at === 0 || /[^\p{L}\p{N}]/u.test(body[at - 1])) score += 1.5;
    }
  }
  if (terms.length > 1 && phrase.length > 3 && (title.includes(phrase) || body.includes(phrase))) score += 12;
  if (doc.updated) score += Math.max(0, 3 - (now - doc.updated) / (1000 * 60 * 60 * 24 * 30));
  return score;
}

/** A window of text around the densest cluster of matches, with the matched ranges marked. */
export function snippet(text: string, terms: string[], radius = 80): Snippet {
  const folded = fold(text);
  const hits: [number, number][] = [];
  for (const term of terms) {
    let i = folded.indexOf(term);
    for (let n = 0; i >= 0 && n < 200; n++) { hits.push([i, i + term.length]); i = folded.indexOf(term, i + term.length); }
  }
  hits.sort((a, b) => a[0] - b[0]);
  if (!hits.length) {
    const clean = text.slice(0, radius * 2).replace(/\s+/g, ' ').trim();
    return { text: clean + (text.length > radius * 2 ? '…' : ''), marks: [] };
  }
  // Choose the start that covers the most distinct terms within the window.
  let best = hits[0][0], bestCount = 0;
  for (const [start] of hits) {
    const covered = new Set(hits.filter(([s, e]) => s >= start && e <= start + radius * 2).map(([s, e]) => folded.slice(s, e)));
    if (covered.size > bestCount) { bestCount = covered.size; best = start; }
  }
  let from = Math.max(0, best - Math.floor(radius / 2));
  const to = Math.min(text.length, from + radius * 2);
  if (from > 0) { const space = text.lastIndexOf(' ', from + 12); if (space > from - 20 && space < best) from = space + 1; }
  const raw = text.slice(from, to);
  const lead = from > 0 ? '…' : '', tail = to < text.length ? '…' : '';
  // Collapse whitespace while tracking how offsets move.
  let out = lead; const map: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (/\s/.test(c)) { if (!out.endsWith(' ')) { map[i] = out.length; out += ' '; } else map[i] = out.length - 1; }
    else { map[i] = out.length; out += c; }
  }
  map[raw.length] = out.length;
  const marks = hits.filter(([s, e]) => s >= from && e <= to).map(([s, e]) => [map[s - from], map[e - from]] as [number, number]);
  const line = text.slice(0, best).split('\n').length;
  return { text: out + tail, marks: merge(marks), line };
}

function merge(marks: [number, number][]) {
  const out: [number, number][] = [];
  for (const m of marks.sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]); else out.push([...m]);
  }
  return out;
}

export function searchDocs(docs: SearchDoc[], query: string, limit = 60, now = Date.now()): SearchHit[] {
  const terms = queryTerms(query), phrase = fold(query.trim().replace(/\s+/g, ' '));
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  for (const doc of docs) {
    const score = scoreDoc(doc, terms, phrase, now);
    if (score > 0) hits.push({ doc, score, snippet: { text: '', marks: [] } });
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, limit);
  for (const hit of top) hit.snippet = snippet(hit.doc.text || hit.doc.title, terms);
  return top;
}
