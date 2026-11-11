// Save rules: which CMS files of a linked course Clem keeps (docs/GUC-VPS-ENGINE.md → Save rules). A rule is the kinds of
// file (slides, assignments, …) plus optional filters: file types ("only PDFs"), weeks ("week 3 onwards"), name globs
// ("files named Lab*") and a size limit ("under 50MB"). `convertSaveRules` reads the person's own words; what it can't
// read for sure comes back as { needsAI: true } and goes to the AI, whose JSON must pass `aiSaveRules`. `matches` is
// what the check job asks before it downloads anything.
import { z } from "zod";

export const SAVE_KINDS = ["slides", "assignments", "sheets", "videos", "links", "other"] as const;
export type SaveKind = (typeof SAVE_KINDS)[number];
export const SAVE_LABELS: Record<SaveKind, string> = { slides: "Slides", assignments: "Assignments", sheets: "Tutorials and sheets", videos: "Videos", links: "Links", other: "Other files" };
export const FILE_TYPES = ["pdf", "powerpoint", "word", "excel", "image", "video", "audio", "archive", "code", "text"] as const;
export type FileType = (typeof FILE_TYPES)[number];
export const TYPE_LABELS: Record<FileType, string> = { pdf: "PDFs", powerpoint: "PowerPoint files", word: "Word files", excel: "Excel files", image: "images", video: "video files", audio: "audio files", archive: "zip files", code: "code files", text: "text files" };
const EXT: Record<FileType, string[]> = {
  pdf: ["pdf"], powerpoint: ["ppt", "pptx", "pps", "ppsx", "odp", "key"], word: ["doc", "docx", "odt", "rtf"], excel: ["xls", "xlsx", "xlsm", "csv", "ods"],
  image: ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg", "heic"], video: ["mp4", "mov", "mkv", "avi", "webm", "wmv", "m4v"], audio: ["mp3", "wav", "m4a", "ogg", "flac"],
  archive: ["zip", "rar", "7z", "tar", "gz", "tgz"], code: ["c", "h", "cpp", "hpp", "java", "py", "js", "ts", "asm", "s", "v", "vhd", "m", "ipynb", "html", "css", "sql", "json", "xml"], text: ["txt", "md"],
};

/** `kinds`: which kinds of CMS file to keep. The rest are filters every kept file must also pass; left out, they don't apply. */
export type SaveRules = {
  kinds: Record<SaveKind, boolean>;
  types?: { only?: FileType[]; except?: FileType[] };
  /** Week numbers of the course, counted from its first week on CMS. */
  weeks?: { from?: number; to?: number };
  /** Globs (* and ?) matched against the file's title and file name, ignoring case. */
  names?: { only?: string[]; except?: string[] };
  maxMB?: number;
};

export const defaultSaveRules = (): SaveRules => ({ kinds: { slides: true, assignments: true, sheets: true, videos: false, links: false, other: true } });
const every = (on: boolean): SaveRules => ({ kinds: Object.fromEntries(SAVE_KINDS.map((k) => [k, on])) as Record<SaveKind, boolean> });

// ---------- The AI's JSON (and every patch): strict, so nothing but these fields gets in ----------
const glob = z.string().trim().min(1).max(80).regex(/^[^/\\]+$/);
const list = <T extends z.ZodTypeAny>(item: T) => z.array(item).max(12);
const kindsSchema = z.object(Object.fromEntries(SAVE_KINDS.map((k) => [k, z.boolean()])) as Record<SaveKind, z.ZodBoolean>).partial().strict();
/** A change to save rules: only the kinds given change; a filter given replaces that filter, `null` removes it. */
export const aiSaveRules = z.object({
  kinds: kindsSchema.optional(),
  types: z.object({ only: list(z.enum(FILE_TYPES)).optional(), except: list(z.enum(FILE_TYPES)).optional() }).strict().nullable().optional(),
  weeks: z.object({ from: z.number().int().min(1).max(60).optional(), to: z.number().int().min(1).max(60).optional() }).strict().refine((w) => !w.from || !w.to || w.from <= w.to, "from after to").nullable().optional(),
  names: z.object({ only: list(glob).optional(), except: list(glob).optional() }).strict().nullable().optional(),
  maxMB: z.number().positive().max(100_000).nullable().optional(),
}).strict();
export type SaveRulesPatch = z.infer<typeof aiSaveRules>;
const FILTERS = ["types", "weeks", "names", "maxMB"] as const;

/** `base` with a patch applied: kinds merge, a filter given replaces (null or empty removes it). */
export function applyRules(base: SaveRules, patch: SaveRulesPatch = {}): SaveRules {
  const out: SaveRules = { kinds: { ...defaultSaveRules().kinds, ...base.kinds, ...patch.kinds } };
  for (const f of FILTERS) {
    const v = f in patch ? patch[f] : base[f];
    if (v === null || v === undefined) continue;
    if (typeof v === "object") {
      const clean = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && (!Array.isArray(x) || x.length)));
      if (Object.keys(clean).length) (out as any)[f] = clean;
    } else (out as any)[f] = v;
  }
  return out;
}
/** The patch that turns any rules into `rules` (every kind, and every filter set or cleared). */
export const rulesPatch = (rules: SaveRules): SaveRulesPatch => ({ kinds: { ...rules.kinds }, types: rules.types ?? null, weeks: rules.weeks ?? null, names: rules.names ?? null, maxMB: rules.maxMB ?? null });
export const hasFilters = (r: SaveRules) => FILTERS.some((f) => r[f] !== undefined);

// ---------- What a CMS file is ----------
export type Material = { kind?: string; title?: string; url?: string; week?: string };
/** What kind of file a CMS material is, from its CMS type ("Lecture slides", "Assignment", "Video") and title. */
export function materialKind(m: Material): SaveKind {
  const k = `${m.kind || ""} ${m.title || ""}`.toLowerCase(), url = (m.url || "").toLowerCase();
  if (/video|recording|\.mp4\b|youtube|youtu\.be/.test(k + " " + url)) return "videos";
  if (/\blink\b/.test(m.kind?.toLowerCase() || "") || (/^https?:/.test(url) && !/cms\.guc\.edu\.eg/.test(url))) return "links";
  if (/assignment|project|homework|\bhw\b|milestone/.test(k)) return "assignments";
  if (/tutorial|\btut\b|sheet|exercise|practice|problem set|lab manual|solution/.test(k)) return "sheets";
  if (/lecture|slide|presentation|notes/.test(k)) return "slides";
  return "other";
}
const extOf = (s = "") => { try { s = decodeURIComponent(new URL(s).pathname); } catch {} return /\.([a-z0-9]{1,5})$/i.exec(s.split(/[?#]/)[0])?.[1]?.toLowerCase() || ""; };
/** The file's type from its link's (or title's) extension; undefined for a web link or no extension. */
export function materialType(m: Material): FileType | undefined {
  const ext = extOf(m.url) || extOf(m.title);
  const t = FILE_TYPES.find((t) => EXT[t].includes(ext));
  if (t) return t;
  return materialKind(m) === "videos" && /youtu/.test(m.url || "") ? "video" : undefined;
}
const fileName = (m: Material) => { try { return decodeURIComponent(new URL(m.url || "").pathname.split("/").at(-1) || ""); } catch { return ""; } };
const globRe = (g: string) => new RegExp("^" + g.trim().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
const named = (m: Material, globs: string[]) => globs.some((g) => { const re = globRe(g); return [m.title || "", fileName(m), fileName(m).replace(/\.[^.]+$/, "")].some((s) => s && re.test(s.trim())); });

/** Week numbers for a course's week titles ("Week: 2026-09-26"): oldest is 1. Titles without dates keep CMS order
 *  (newest first on the page), so the last one is week 1. */
export function weekNumbers(titles: string[]): Map<string, number> {
  const uniq = [...new Set(titles)], date = (t: string) => /\d{4}-\d{2}-\d{2}/.exec(t)?.[0];
  const sorted = uniq.every(date) ? [...uniq].sort((a, b) => date(a)!.localeCompare(date(b)!)) : [...uniq].reverse();
  return new Map(sorted.map((t, i) => [t, i + 1]));
}

/** Whether a CMS file is kept. `week`: its week number; `size` in bytes once known (a size rule passes until then). */
export function matches(rules: SaveRules, m: Material, o: { week?: number; size?: number } = {}) {
  if (!rules.kinds[materialKind(m)]) return false;
  const type = materialType(m);
  if (rules.types?.only?.length && (!type || !rules.types.only.includes(type))) return false;
  if (type && rules.types?.except?.includes(type)) return false;
  if (rules.weeks && o.week !== undefined && ((rules.weeks.from && o.week < rules.weeks.from) || (rules.weeks.to && o.week > rules.weeks.to))) return false;
  if (rules.names?.only?.length && !named(m, rules.names.only)) return false;
  if (rules.names?.except?.length && named(m, rules.names.except)) return false;
  if (rules.maxMB && o.size !== undefined && o.size > rules.maxMB * 1024 * 1024) return false;
  return true;
}
/** The old name: kinds only. */
export const shouldSave = (m: Material, rules: SaveRules) => matches(rules, m);

// ---------- In words ----------
const join = (xs: string[]) => (xs.length < 2 ? xs[0] || "" : xs.slice(0, -1).join(", ") + " and " + xs.at(-1));
const mb = (n: number) => (n >= 1024 && n % 1024 === 0 ? `${n / 1024} GB` : `${n} MB`);
/** "Slides and assignments", "Everything", "Nothing"; with filters: "Everything · PDFs only · week 3 onwards · under 50 MB". */
export function describeSaveRules(rules: SaveRules) {
  const on = SAVE_KINDS.filter((k) => rules.kinds[k]);
  if (!on.length) return "Nothing (open files on demand)";
  const kinds = on.length === SAVE_KINDS.length ? "Everything" : on.length === SAVE_KINDS.length - 1 ? `Everything except ${SAVE_LABELS[SAVE_KINDS.find((k) => !rules.kinds[k])!].toLowerCase()}` : join(on.map((k, i) => (i ? SAVE_LABELS[k].toLowerCase() : SAVE_LABELS[k])));
  const w = rules.weeks, t = rules.types, n = rules.names;
  return [kinds,
    t?.only?.length ? `${join(t.only.map((x) => TYPE_LABELS[x]))} only` : "", t?.except?.length ? `no ${join(t.except.map((x) => TYPE_LABELS[x]))}` : "",
    w ? (w.from && w.to ? (w.from === w.to ? `week ${w.from} only` : `weeks ${w.from}–${w.to}`) : w.from ? `week ${w.from} onwards` : `up to week ${w.to}`) : "",
    n?.only?.length ? `named ${n.only.join(" or ")}` : "", n?.except?.length ? `not named ${n.except.join(" or ")}` : "",
    rules.maxMB ? `under ${mb(rules.maxMB)}` : "",
  ].filter(Boolean).join(" · ");
}
export const describe = describeSaveRules;

// ---------- From the person's words ----------
const KIND_WORDS: [RegExp, SaveKind][] = [
  [/\b(lecture\s+)?(videos?|recordings?|mp4s?)\b/g, "videos"],
  [/\b(lecture slides?|slides?|lectures?|presentations?|lecture notes|notes)\b/g, "slides"],
  [/\b(assignments?|homeworks?|hw|projects?|milestones?)\b/g, "assignments"],
  [/\b(tutorials?|tuts?|(?<!spread)sheets?|exercises?|practice|problem sets?|labs?)\b/g, "sheets"],
  [/\b(links?|urls?|websites?)\b/g, "links"],
  [/\b(other( files)?|the rest|misc\w*)\b/g, "other"],
];
const TYPE_WORDS: [RegExp, FileType][] = [
  [/\b(pdfs?|pdf files?)\b/g, "pdf"], [/\b(power ?points?|pptx?s?|powerpoint files?)\b/g, "powerpoint"], [/\b(word (files?|docs?|documents?)|docx?s?)\b/g, "word"],
  [/\b(excel( files?)?|xlsx?s?|spreadsheets?|csvs?)\b/g, "excel"], [/\b(images?|pictures?|photos?|pngs?|jpe?gs?)\b/g, "image"],
  [/\b(audio( files?)?|mp3s?|recordings? of audio)\b/g, "audio"], [/\b(zips?|zip files?|archives?|rars?)\b/g, "archive"],
  [/\b(code( files?)?|source( files| code)?)\b/g, "code"], [/\b(text files?|txts?)\b/g, "text"],
];
/** Things named in `text`, in order, once each; what was found is blanked out of `rest`. */
function take<T>(text: string, words: [RegExp, T][]): { found: T[]; rest: string } {
  const at: [number, T][] = [];
  let rest = text;
  for (const [re, v] of words) rest = rest.replace(re, (m, ...a) => { at.push([a.at(-2) as number, v]); return " ".repeat(m.length); });
  return { found: [...new Set(at.sort((a, b) => a[0] - b[0]).map(([, v]) => v))], rest };
}
/** The kinds named in `text`, in order, once each. */
export const kindsIn = (text: string): SaveKind[] => take(text.toLowerCase(), KIND_WORDS).found;

export const YES = /^(y(es|ep|eah|up)?|sure|ok(ay)?|fine|sounds good|looks good|perfect|great|do it|go ahead|that works|works for me|correct|right|👍)[\s!.]*$/i;
export const NO = /^(no(pe)?|nah|not now|later|maybe later|no thanks?)[\s!.]*$/i;

const NUM: Record<string, number> = { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10, eleven: 11, eleventh: 11, twelve: 12, twelfth: 12, thirteen: 13, fourteen: 14, fifteen: 15 };
const N = String.raw`(\d{1,2}|${Object.keys(NUM).join("|")})(?:st|nd|rd|th)?`;
const num = (s: string) => NUM[s] ?? Number(s);
const SIZE = String.raw`(\d+(?:\.\d+)?)\s*(kb|mb|megs?|megabytes?|gb|gigs?|gigabytes?)\b`;
const toMB = (n: string, unit: string) => { const v = Number(n), u = unit[0]; return u === "k" ? Math.max(1, Math.round(v / 1024)) : u === "g" ? v * 1024 : v; };

/** Words that carry no rule of their own; anything else left over means the text says something this can't read. */
const FILLER = new Set(("a an the and or plus also too as well please i i'll ill i'd id me my mine it them they those these that this is are be to of from in on at for with by want need would like " +
  "save saving saved keep keeping download downloading downloads get grab store copy files file stuff things everything anything all every each any only just " +
  "except but not no don't dont do does stop never without skip skipping excluding exclude include including add start more other than apart minus nothing none " +
  "course cms guc uploaded posted new ones one onwards onward week weeks and later after since starting begin beginning until till up through before " +
  "named called name names starting ending containing contain contains with that's thats whatever ok okay yes yeah sure fine great good thanks thank you " +
  "can could should will shall let lets let's open myself demand on-demand i'll when needed need").split(" "));

export type RulesParse = { rules: SaveRules; summary: string };
export type RulesResult = RulesParse | { needsAI: true };

/** The person's words as save rules, applied to `current` where they describe a change ("also videos", "stop saving
 *  links"). Anything it can't read for sure, or that contradicts itself, is { needsAI: true }. */
export function convertSaveRules(text: string, current: SaveRules = defaultSaveRules()): RulesResult {
  const ai = { needsAI: true } as const;
  // Case stays until the names are read ("files named Lab*"); everything else is read in lower case.
  let t = " " + text.trim().replace(/[’']/g, "'").replace(/[“”"]/g, '"').replace(/\s+/g, " ") + " ";
  if (!t.trim()) return ai;
  const done = (rules: SaveRules): RulesParse => ({ rules, summary: describeSaveRules(rules) });
  if (YES.test(t.trim())) return done(current);
  if (/\b(on demand|myself|when i need|i'll open|ill open|i will open)\b/i.test(t) || /^\s*(nothing|none|no files?|don't (save|download|keep) (anything|any files?)|dont save anything|save nothing|stop saving( everything| anything)?)\s*[.!]?\s*$/i.test(t))
    return done(every(false));
  if (NO.test(t.trim())) return ai;

  // Names first (their globs may hold words like "lab"), then sizes and weeks, then types and kinds.
  const names: { only: string[]; except: string[] } = { only: [], except: [] };
  t = t.replace(/\b(?:(not|no|except|but not|without|skip|excluding)\s+(?:any\s+)?(?:files?\s+|ones\s+)?)?(named|called|starting with|beginning with|ending with|ending in|containing|with names? (?:like|starting with))\s+("([^"]+)"|(\S+))/gi,
    (_m, neg, how, _q, quoted, bare) => {
      how = how.toLowerCase();
      let g = (quoted || bare).replace(/[.,;!]+$/, "");
      if (/^(starting|beginning)/.test(how) || /starting with/.test(how)) g = g.endsWith("*") ? g : g + "*";
      else if (/^ending/.test(how)) g = g.startsWith("*") ? g : "*" + g;
      else if (how === "containing") g = `*${g.replace(/^\*|\*$/g, "")}*`;
      else if (!/[*?]/.test(g)) g = g + "*";
      (neg ? names.except : names.only).push(g);
      return " ";
    });
  t = t.toLowerCase();
  let maxMB: number | undefined, sizeSeen = false;
  t = t.replace(new RegExp(String.raw`\b(?:under|below|less than|smaller than|up to|at most|max(?:imum)?(?: of)?|no (?:bigger|larger) than|not (?:bigger|larger|over) than|<=?)\s*` + SIZE, "g"), (_m, n, u) => { maxMB = toMB(n, u); sizeSeen = true; return " "; });
  t = t.replace(new RegExp(String.raw`\b(?:(?:no|skip|not|except|without|nothing|don't save|dont save|don't download)\s+(?:files?\s+|anything\s+)?)(?:over|above|bigger than|larger than|more than|greater than|>)\s*` + SIZE, "g"), (_m, n, u) => { maxMB = toMB(n, u); sizeSeen = true; return " "; });
  if (new RegExp(String.raw`\b(?:over|above|bigger than|larger than|more than)\s*` + SIZE).test(t)) return ai; // "files over 50MB" alone: keep only big ones? ask.

  let weeks: { from?: number; to?: number } | undefined;
  // "except week 1", "skip the first two weeks": only leaving out the start can be said as a range.
  let lost = false;
  t = t.replace(new RegExp(String.raw`\b(?:except|not|no|without|skip|skipping|excluding)\s+(?:the\s+)?(?:weeks?\s+${N}(?:\s*(?:-|–|to|and)\s*(?:week\s+)?${N})?|first\s+${N}\s+weeks|${N}\s+week)`, "g"), (_m, a, b, c, d) => {
    const from = a ? num(a) : c ? 1 : num(d), to = a ? (b ? num(b) : from) : c ? num(c) : from;
    if (from !== 1) lost = true; else weeks = { from: to + 1 };
    return " ";
  });
  if (lost) return ai;
  const wk = (re: string, f: (a?: number, b?: number) => { from?: number; to?: number }) => {
    t = t.replace(new RegExp(re, "g"), (_m, a, b) => { weeks = { ...weeks, ...f(a === undefined ? undefined : num(a), b === undefined ? undefined : num(b)) }; return " "; });
  };
  wk(String.raw`\bweeks?\s+${N}\s*(?:-|–|to|through|until|till)\s*(?:week\s+)?${N}`, (a, b) => ({ from: Math.min(a!, b!), to: Math.max(a!, b!) }));
  wk(String.raw`\b(?:from|since|starting(?: from| at| with)?|beginning(?: with| at)?|after)\s+(?:the\s+)?(?:week\s+${N}|${N}\s+week)(?:\s+(?:onwards?|on|and (?:later|after|beyond)))?`, (a, b) => ({ from: a ?? b }));
  wk(String.raw`\b(?:week\s+${N}|(?:the\s+)?${N}\s+week)\s+(?:onwards?|on|and (?:later|after|beyond|up)|or later|forward)`, (a, b) => ({ from: a ?? b }));
  wk(String.raw`\b(?:until|till|up to|through|before)\s+(?:the\s+)?(?:week\s+${N}|${N}\s+week)`, (a, b) => ({ to: a ?? b }));
  wk(String.raw`\b(?:only\s+)?(?:week\s+${N}|(?:the\s+)?${N}\s+week)(?:\s+only)?`, (a, b) => ({ from: a ?? b, to: a ?? b }));
  if (weeks && weeks.from && weeks.to && weeks.from > weeks.to) return ai;
  if (/\bbefore\b/.test(text.toLowerCase()) && weeks?.to) weeks.to = weeks.to - 1 || 1;

  // Which part says what to keep and which what to leave out: "slides and sheets but not videos".
  const NEG = /\b(except( for)?|but(?! (also|do|keep|save))|but not|but no|apart from|other than|excluding|exclude|without|minus|not|no|never|stop saving|stop downloading|stop|don't (save|download|keep)|dont (save|download|keep)|do not (save|download|keep)|skip)\b/;
  const POS_AFTER = /\b(but (also|do|keep|save)|and also|plus|however)\b/;
  const neg = NEG.exec(t);
  let pos = t, off = "";
  if (neg) { pos = t.slice(0, neg.index); off = t.slice(neg.index + neg[0].length); const back = POS_AFTER.exec(off); if (back) { pos += " " + off.slice(back.index + back[0].length); off = off.slice(0, back.index); } }
  const P = take(pos, TYPE_WORDS), Ns = take(off, TYPE_WORDS);
  const PK = take(P.rest, KIND_WORDS), NK = take(Ns.rest, KIND_WORDS);
  const leftover = (PK.rest + " " + NK.rest).replace(/[^a-z0-9*?' -]/g, " ").split(/\s+/).filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w));
  if (leftover.length) return ai;
  const posKinds = PK.found, negKinds = NK.found, posTypes = P.found, negTypes = Ns.found;
  // "videos" is a kind; "video files" without a kind word is still the videos kind.
  if (posKinds.some((k) => negKinds.includes(k)) || posTypes.some((x) => negTypes.includes(x))) return ai;
  const named = posKinds.length + negKinds.length + posTypes.length + negTypes.length;
  const all = /\b(everything|all( of it| files| of them| the files)?|every file|anything|the whole thing)\b/.test(pos) && !posKinds.length && !posTypes.length;
  const only = /\b(only|just|nothing but)\b/.test(t);
  const more = /\b(also|too|as well|add|include|including|plus|start saving|start downloading)\b/.test(pos);
  const filters = sizeSeen || !!weeks || names.only.length + names.except.length > 0;
  if (!named && !all && !filters) return ai;

  let r: SaveRules;
  const replace = all || (only && !more) || (!neg && !more && (posKinds.length || posTypes.length));
  if (all || (!posKinds.length && !posTypes.length && neg && named && !more && /\b(but|except|apart|other than)\b/.test(t) && all)) {
    r = every(true);
  } else if (neg && !posKinds.length && !posTypes.length && !only) {
    r = { ...current, kinds: { ...current.kinds } }; // "stop saving videos", "no links"
  } else if (more && !only) {
    r = { ...current, kinds: { ...current.kinds } }; // "also save videos"
    for (const k of posKinds) r.kinds[k] = true;
  } else if (posKinds.length) {
    r = every(false);
    for (const k of posKinds) r.kinds[k] = true;
  } else if (posTypes.length || names.only.length) {
    r = every(true); // "only PDFs", "only files named Lab*": every kind, through that filter
  } else {
    r = { ...current, kinds: { ...current.kinds } }; // filters alone: "only week 3 onwards", "under 50MB"
  }
  for (const k of negKinds) r.kinds[k] = false;
  // Filters: a new statement of what to keep starts clean; a change keeps the ones it doesn't mention.
  const keep: Partial<SaveRules> = replace && (posKinds.length || posTypes.length || all) ? {} : current;
  const types = { only: posTypes.length ? (more && !only ? [...new Set([...(current.types?.only || []), ...posTypes])] : posTypes) : more ? current.types?.only : keep.types?.only, except: [...new Set([...(neg && !replace ? current.types?.except || [] : keep.types?.except || []), ...negTypes])].filter((x) => !posTypes.includes(x)) };
  return done(applyRules({ kinds: r.kinds }, {
    types: types.only?.length || types.except.length ? types : null,
    weeks: weeks ?? keep.weeks ?? null,
    names: names.only.length || names.except.length ? { only: names.only.length ? names.only : undefined, except: names.except.length ? names.except : undefined } : keep.names ?? null,
    maxMB: maxMB ?? keep.maxMB ?? null,
  }));
}
/** The local reading only: null where the AI is needed. */
export function parseSaveRules(text: string, current: SaveRules = defaultSaveRules()): RulesParse | null {
  const r = convertSaveRules(text, current);
  return "needsAI" in r ? null : r;
}
/** The AI's JSON for a save rule, through `aiSaveRules`; null when it doesn't pass. */
export function fromAi(json: unknown, current: SaveRules = defaultSaveRules()): RulesParse | null {
  const p = aiSaveRules.safeParse(json);
  if (!p.success || !Object.keys(p.data).length) return null;
  const rules = applyRules(current, p.data);
  return { rules, summary: describeSaveRules(rules) };
}
/** For the AI's prompt: the JSON it answers with. */
export const AI_RULES_FORMAT = `{"kinds":{${SAVE_KINDS.map((k) => `"${k}":true|false`).join(",")}} (only the kinds they mention), "types":{"only":[...],"except":[...]} with ${FILE_TYPES.join("|")}, "weeks":{"from":N,"to":N}, "names":{"only":["Lab*"],"except":[...]} (globs), "maxMB":N; null removes a filter; leave out what they don't mention`;
