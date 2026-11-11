// Save rules: which CMS files of a linked course Clem keeps. This step has the shape, the kind of each file and a local
// parser for the common phrasings ("only slides", "stop saving videos", "everything except links"); anything it can't
// read goes to the AI (src/guc/setup.ts). The full natural-language converter replaces `parseSaveRules` in the next
// step behind the same signature.

export const SAVE_KINDS = ["slides", "assignments", "sheets", "videos", "links", "other"] as const;
export type SaveKind = (typeof SAVE_KINDS)[number];
export type SaveRules = { kinds: Record<SaveKind, boolean> };
export const SAVE_LABELS: Record<SaveKind, string> = { slides: "Slides", assignments: "Assignments", sheets: "Tutorials and sheets", videos: "Videos", links: "Links", other: "Other files" };

export const defaultSaveRules = (): SaveRules => ({ kinds: { slides: true, assignments: true, sheets: true, videos: false, links: false, other: true } });
const every = (on: boolean): SaveRules => ({ kinds: Object.fromEntries(SAVE_KINDS.map((k) => [k, on])) as Record<SaveKind, boolean> });

/** What kind of file a CMS material is, from its CMS type ("Lecture slides", "Assignment", "Video") and title. */
export function materialKind(m: { kind?: string; title?: string; url?: string }): SaveKind {
  const k = `${m.kind || ""} ${m.title || ""}`.toLowerCase(), url = (m.url || "").toLowerCase();
  if (/video|recording|\.mp4\b|youtube|youtu\.be/.test(k + " " + url)) return "videos";
  if (/\blink\b/.test(m.kind?.toLowerCase() || "") || (/^https?:/.test(url) && !/cms\.guc\.edu\.eg/.test(url))) return "links";
  if (/assignment|project|homework|\bhw\b|milestone/.test(k)) return "assignments";
  if (/tutorial|\btut\b|sheet|exercise|practice|problem set|lab manual|solution/.test(k)) return "sheets";
  if (/lecture|slide|presentation|notes/.test(k)) return "slides";
  return "other";
}
export const shouldSave = (m: { kind?: string; title?: string; url?: string }, rules: SaveRules) => !!rules.kinds[materialKind(m)];

/** "Slides, assignments and tutorials and sheets", "Everything", "Nothing". */
export function describeSaveRules(rules: SaveRules) {
  const on = SAVE_KINDS.filter((k) => rules.kinds[k]);
  if (on.length === SAVE_KINDS.length) return "Everything";
  if (!on.length) return "Nothing";
  const names = on.map((k, i) => (i ? SAVE_LABELS[k].toLowerCase() : SAVE_LABELS[k]));
  return names.length === 1 ? names[0] : names.slice(0, -1).join(", ") + " and " + names.at(-1);
}

const WORDS: [RegExp, SaveKind][] = [
  [/\b(lecture\s+)?(videos?|recordings?|mp4s?)\b/g, "videos"],
  [/\b(slides?|lectures?|ppts?x?|presentations?|lecture notes)\b/g, "slides"],
  [/\b(assignments?|homeworks?|hw|projects?|milestones?)\b/g, "assignments"],
  [/\b(tutorials?|tuts?|sheets?|exercises?|practice|problem sets?|labs?)\b/g, "sheets"],
  [/\b(links?|urls?|websites?)\b/g, "links"],
  [/\b(other( files)?|the rest|misc\w*)\b/g, "other"],
];
/** The kinds named in `text`, in order, once each. */
export function kindsIn(text: string): SaveKind[] {
  const found: [number, SaveKind][] = [];
  let rest = text.toLowerCase();
  for (const [re, kind] of WORDS) rest = rest.replace(re, (m, ...a) => { found.push([a.at(-2) as number, kind]); return " ".repeat(m.length); });
  return [...new Set(found.sort((a, b) => a[0] - b[0]).map(([, k]) => k))];
}

export const YES = /^(y(es|ep|eah|up)?|sure|ok(ay)?|fine|sounds good|looks good|perfect|great|do it|go ahead|that works|works for me|correct|right|👍)[\s!.]*$/i;
export const NO = /^(no(pe)?|nah|not now|later|skip( it| this)?|maybe later|no thanks?)[\s!.]*$/i;

export type RulesParse = { rules: SaveRules; summary: string };
/** The common ways of saying what to keep; `null` when the text says something this can't read (the AI's turn). */
export function parseSaveRules(text: string, current: SaveRules = defaultSaveRules()): RulesParse | null {
  const t = text.trim().toLowerCase().replace(/[’']/g, "'");
  if (!t) return null;
  const done = (rules: SaveRules) => ({ rules, summary: describeSaveRules(rules) });
  if (YES.test(t)) return done(current);
  const kinds = kindsIn(t), off = /\b(stop|don't|do not|dont|no more|never|not|without|except|but not|skip|exclude|no)\b/.test(t);
  const all = /\b(everything|all( of it| files| of them)?|every file|anything)\b/.test(t);
  if (!kinds.length) {
    if (/\b(nothing|none)\b/.test(t) || /^(no|don't save|do not save|dont save)\b/.test(t) || /\bstop saving\b/.test(t)) return done(every(false));
    if (all || /^(save )?(the )?files$/.test(t)) return done(every(true));
    return null;
  }
  // "everything except videos", "all but links"
  if (all && /\b(except|but|without|apart from|other than)\b/.test(t)) {
    const r = every(true);
    for (const k of kinds) r.kinds[k] = false;
    return done(r);
  }
  // "only slides", "just slides and sheets", or a bare list: those and nothing else.
  if (/\b(only|just)\b/.test(t) || (!off && !/\b(also|too|as well|add|include|plus|start)\b/.test(t))) {
    const r = every(false);
    for (const k of kinds) r.kinds[k] = true;
    return done(r);
  }
  const r: SaveRules = { kinds: { ...current.kinds } };
  for (const k of kinds) r.kinds[k] = !off;
  return done(r);
}
