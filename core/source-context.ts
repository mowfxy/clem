/** Normalised for matching file names against a request: "Lecture_03.pdf" → "lecture 03". */
const plain = (text: string) => text.toLowerCase().replace(/\.[a-z0-9]{1,5}$/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Files the request is about: the ones it names (by name, or "lecture 3" for "Lecture_03.pdf"). */
export function namedSources(names: string[], query: string) {
  const q = " " + plain(query) + " ";
  return names.map((name, i) => {
    const stem = plain(name);
    if (stem.length >= 3 && q.includes(" " + stem + " ")) return i;
    // "lecture 3" names "Lecture_03" and "Lecture 3 - Enzymes".
    const numbered = stem.match(/^(.*?\p{L})\s*0*(\d+)\b/u);
    // Not \b: with the u flag it only knows ASCII letters, so "محاضرة 3" would never match.
    return numbered && new RegExp(`(?<![\\p{L}\\p{N}])${numbered[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*0*${numbered[2]}\\b`, "u").test(q) ? i : -1;
  }).filter((i) => i >= 0);
}

/**
 * The files of a request as a list, not their contents, as Claude's Cowork works: the model searches, reads and looks
 * at what the request needs with its file tools, so files nobody asked about cost nothing, and what it read is in its
 * own context once instead of in every step's request. Each line: where the file is from, its size and pages, and how
 * it begins, so the model can tell which files matter without opening them.
 */
export function fileIndex(sources: { name: string; text: string }[], focus: number[] = [], related: number[] = []) {
  if (!sources.length) return "";
  const pages = (text: string) => [...text.matchAll(/\n\[[^\n]*?, page (\d+)\]\n/g)].reduce((n, m) => Math.max(n, Number(m[1])), 0);
  const size = (n: number) => n >= 10_000 ? `${Math.round(n / 1000)}k characters` : `${n} characters`;
  const order = [...sources.keys()].sort((a, b) => Number(focus.includes(b)) - Number(focus.includes(a)) || Number(related.includes(b)) - Number(related.includes(a)));
  const lines = order.map((i, n) => {
    const { name, text } = sources[i];
    const count = pages(text);
    const start = text.replace(/\[[^\]\n]*\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
    const where = focus.includes(i) ? "attached to this request" : related.includes(i) ? "from earlier in this chat" : "in this subject, project or linked folder";
    return `${n + 1}. ${name} — ${where} · ${count ? `${count} page${count === 1 ? "" : "s"} · ` : ""}${size(text.length)}${start ? ` · begins: "${start}${text.length > 160 ? "…" : ""}"` : ""}`;
  });
  // A short file attached to this request goes along whole: reading it would cost a step of its own. Never a PDF: the
  // AI opens it itself and reads its pages as drawn, as a PDF sent to it is read, not from Mowr's text of it.
  const small = order.filter((i) => focus.includes(i) && sources[i].text.length <= SMALL_FILE && !/\.pdf$/i.test(sources[i].name)).map((i) => `[Source: ${sources[i].name}; complete file]\n${sources[i].text}`);
  return `[Files available (${sources.length}), listed, not loaded${small.length ? " (short attached files are included whole below)" : ""}: read, search and look at what this request needs with the file tools before relying on it. A file attached to this request is what the person is asking about: read it through (in parallel reads) unless only a part of it is asked about.
${lines.join("\n")}]${small.length ? "\n\n" + small.join("\n\n") : ""}`;
}
/** Characters up to which an attached file goes with the request whole instead of being listed. */
const SMALL_FILE = 8000;

/** Words too common to tell files or passages apart. */
export const common = new Set("the and for with that this from are was were has have had not but you your all any can will each into about make create explain fully detail detailed please write give pdf pdfs file files document lecture lectures notes summary summarise summarize every them their there what which when how why also more".split(" "));
const CHUNK = 1800, STEP = 1600;

/**
 * The text of the sources that fits the budget, organised for the model: an index of every file and how
 * much of it is included, then each file in turn.
 * - Focus files (attached to this message, open beside the chat or named in it) are sent whole whenever they fit.
 * - The other files (earlier in the chat, the rest of the subject) share at most `others` characters: the passages
 *   that match the request, and the index for the rest, which the model reads with its file tools when it needs
 *   them, as Claude's Cowork does. Every step of a tool loop reads the whole request again, so files nobody asked
 *   about used to fill most of every step.
 * - When they cannot all fit, each file gets a weighted share: focus files the most, files used earlier in the chat
 *   next, then the rest by how well they match the request. Files smaller than their share give the remainder back.
 * - A file too long for its share is cut to its most relevant passages (rarer request words count more),
 *   spread across the whole file, in document order.
 */
export function sourceExcerpts(
  sources: { name: string; text: string }[],
  query: string,
  budget = 20000,
  focus: number[] = [],
  related: number[] = [],
  others = Infinity,
) {
  if (!sources.length) return "";
  const terms = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].filter((t) => !common.has(t));
  const focused = new Set([...focus, ...namedSources(sources.map((s) => s.name), query)]);
  const earlier = new Set(related);
  const lower = sources.map((s) => s.text.toLowerCase());
  // Rarer words decide more: a term found in every file says little about which one matters.
  const rarity = new Map(terms.map((t) => [t, Math.log(1 + sources.length / Math.max(1, lower.filter((l) => l.includes(t)).length))]));
  const relevance = sources.map((s, i) => terms.reduce((n, t) => n + (lower[i].includes(t) || plain(s.name).includes(t) ? rarity.get(t)! : 0), 0));
  const best = Math.max(0, ...relevance);
  const weight = (i: number) => focused.has(i) ? 4 : earlier.has(i) ? 2 : best ? 0.5 + relevance[i] / best : 1;

  const header = (name: string) => name.length + 60;
  const whole = sources.reduce((n, s) => n + s.text.length + header(s.name), 0);
  // Room for the index when not everything fits.
  const index = 500 + sources.reduce((n, s) => n + s.name.length + 100, 0);
  const allowance = new Array<number>(sources.length).fill(0);
  const room = whole + index <= budget ? budget : budget - index;
  /** Shares `space` among `open` by weight; returns what is left. */
  const share = (open: number[], space: number) => {
    while (open.length && space > 0) {
      const total = open.reduce((n, i) => n + weight(i), 0);
      const fits = open.filter((i) => sources[i].text.length + header(sources[i].name) <= (space * weight(i)) / total);
      if (!fits.length) {
        for (const i of open) allowance[i] = Math.floor((space * weight(i)) / total);
        return 0;
      }
      for (const i of fits) { allowance[i] = sources[i].text.length + header(sources[i].name); space -= allowance[i]; }
      open = open.filter((i) => !fits.includes(i));
    }
    return space;
  };
  const all = [...sources.keys()];
  // Focus files first, whole when they fit; the others within what is left, at most `others`.
  if (Number.isFinite(others)) share(all.filter((i) => !focused.has(i)), Math.min(share(all.filter((i) => focused.has(i)), room), others));
  else share(all, room);

  const status: string[] = [], parts: string[] = [];
  let cut = false;
  // Focus files first, then the others in their given order (earlier in the chat, then the rest of the subject).
  const order = [...sources.keys()].sort((a, b) => Number(focused.has(b)) - Number(focused.has(a)));
  for (const file of order) {
    const source = sources[file], limit = allowance[file] - header(source.name);
    const tag = focused.has(file) ? ", this request is about it" : "";
    if (source.text.length <= limit) {
      status.push(`${source.name}: complete${tag}`);
      parts.push(`[Source: ${source.name}; complete file]\n${source.text}`);
      continue;
    }
    cut = true;
    if (limit < 400) { status.push(`${source.name}: not included (no room left in this request; read it with the file tools, or ask about it by name)`); continue; }
    const chunks: { start: number; text: string; score: number }[] = [];
    for (let start = 0; start < source.text.length; start += STEP) {
      const text = source.text.slice(start, start + CHUNK), low = text.toLowerCase();
      chunks.push({ start, text, score: terms.reduce((n, t) => n + (low.includes(t) ? rarity.get(t)! : 0), 0) });
    }
    // Equal scores are taken in a spread order (middle, quarters, eighths…), so a long file is covered end to end.
    const spread = new Map<number, number>();
    for (let step = chunks.length, rank = 0; step >= 1; step = Math.floor(step / 2))
      for (let i = Math.floor(step / 2); i < chunks.length; i += step) if (!spread.has(i)) spread.set(i, rank++);
    const ranked = chunks.map((c, i) => ({ ...c, order: spread.get(i) ?? i })).sort((a, b) => b.score - a.score || a.order - b.order);
    let used = 0;
    const picked = [];
    for (const c of ranked) {
      if (used + c.text.length + 40 > limit) continue;
      picked.push(c);
      used += c.text.length + 40;
    }
    picked.sort((a, b) => a.start - b.start);
    status.push(`${source.name}: selected excerpts, about ${Math.min(99, Math.round((100 * used) / source.text.length))}% of it${tag}`);
    parts.push(picked.map((c) => `[Source: ${source.name}; text offset ${c.start}]\n${c.text}`).join("\n\n"));
  }
  const notice = cut
    ? `[Selected excerpts only for some files (see the index). Do not claim to have reviewed those in full; when the request needs more of one, read it with the FILE TOOLS (search, read) when your instructions list them; otherwise say which parts were not available and offer to work through it file by file.]\n`
    : "";
  return `[Files available (${sources.length}):\n${status.map((s, i) => `${i + 1}. ${s}`).join("\n")}]\n${notice}\n` + parts.join("\n\n");
}
