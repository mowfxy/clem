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
    return numbered && new RegExp(`\\b${numbered[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*0*${numbered[2]}\\b`, "u").test(q) ? i : -1;
  }).filter((i) => i >= 0);
}

/** Words too common to tell files or passages apart. */
const common = new Set("the and for with that this from are was were has have had not but you your all any can will each into about make create explain fully detail detailed please write give pdf pdfs file files document lecture lectures notes summary summarise summarize every them their there what which when how why also more".split(" "));
const CHUNK = 1800, STEP = 1600;

/**
 * The text of the sources that fits the budget, organised for the model: an index of every file and how
 * much of it is included, then each file in turn.
 * - Files are sent whole whenever they fit, so the model reads every lecture rather than a few passages.
 * - When they cannot all fit, each file gets a weighted share: focus files (attached to this message, open
 *   beside the chat or named in it) the most, files used earlier in the chat next, then the rest by how
 *   well they match the request. Files smaller than their share give the remainder back.
 * - A file too long for its share is cut to its most relevant passages (rarer request words count more),
 *   spread across the whole file, in document order.
 */
export function sourceExcerpts(
  sources: { name: string; text: string }[],
  query: string,
  budget = 20000,
  focus: number[] = [],
  related: number[] = [],
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
  let open = sources.map((_, i) => i), room = whole + index <= budget ? budget : budget - index;
  while (open.length && room > 0) {
    const total = open.reduce((n, i) => n + weight(i), 0);
    const fits = open.filter((i) => sources[i].text.length + header(sources[i].name) <= (room * weight(i)) / total);
    if (!fits.length) {
      for (const i of open) allowance[i] = Math.floor((room * weight(i)) / total);
      break;
    }
    for (const i of fits) { allowance[i] = sources[i].text.length + header(sources[i].name); room -= allowance[i]; }
    open = open.filter((i) => !fits.includes(i));
  }

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
    if (limit < 400) { status.push(`${source.name}: not included (no room left; ask for it by name to read it)`); continue; }
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
    ? `[Selected excerpts only for some files (see the index). Do not claim to have reviewed those in full; when the request needs all of one, say which parts were not available and offer to work through it file by file.]\n`
    : "";
  return `[Files available (${sources.length}):\n${status.map((s, i) => `${i + 1}. ${s}`).join("\n")}]\n${notice}\n` + parts.join("\n\n");
}
