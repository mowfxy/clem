import { randomUUID } from "node:crypto";
export type MemoryKind = "fact" | "preference" | "inference" | "temporary";
export type Memory = {
  id: string;
  scope: string;
  key: string;
  text: string;
  kind: MemoryKind;
  confirmed: boolean;
  confidence: number;
  source: { id: string; locator: string; at: string };
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  supersededBy?: string;
  derivedFrom: string[];
  sharedWith: string[];
  embedding?: number[];
};
export type MemoryState = { enabled: boolean; records: Memory[] };
export function putMemory(
  state: MemoryState,
  input: Omit<Memory, "id" | "createdAt" | "updatedAt" | "supersededBy">,
  now = new Date().toISOString(),
) {
  if (!state.enabled) throw Error("Memory is disabled.");
  if (
    !input.source.id ||
    !input.source.locator ||
    !Number.isFinite(Date.parse(input.source.at))
  )
    throw Error("Memory needs a source and timestamp.");
  if (
    !input.text.trim() ||
    input.text.length > 2000 ||
    input.confidence < 0 ||
    input.confidence > 1
  )
    throw Error("Invalid memory.");
  if (
    !input.confirmed &&
    input.kind !== "inference" &&
    input.kind !== "temporary"
  )
    throw Error("Facts and preferences require explicit confirmation.");
  if (input.kind === "temporary" && !input.expiresAt)
    throw Error("Temporary memory must expire.");
  const duplicate = state.records.find(
    (m) =>
      m.scope === input.scope &&
      m.key === input.key &&
      m.text === input.text &&
      m.kind === input.kind &&
      JSON.stringify([...m.sharedWith].sort()) === JSON.stringify([...input.sharedWith].sort()) &&
      !m.supersededBy,
  );
  if (duplicate) return state;
  const record: Memory = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  const records = state.records.map((m) =>
    m.scope === input.scope &&
    m.key === input.key &&
    !m.supersededBy &&
    input.confirmed
      ? { ...m, supersededBy: record.id, updatedAt: now }
      : m,
  );
  return { ...state, records: [...records, record] };
}
/** Deletion propagates through derived records. Retrieval uses the same canonical store, with no stale cache. */
export function forgetMemory(state: MemoryState, ids: string[]) {
  const deleted = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of state.records)
      if (!deleted.has(m.id) && m.derivedFrom.some((id) => deleted.has(id))) {
        deleted.add(m.id);
        changed = true;
      }
  }
  return {
    ...state,
    records: state.records
      .filter((m) => !deleted.has(m.id))
      .map((m) =>
        m.supersededBy && deleted.has(m.supersededBy)
          ? { ...m, supersededBy: "forgotten" }
          : m,
      ),
  };
}
export function forgetSource(state: MemoryState, sourceId: string) {
  return forgetMemory(
    state,
    state.records.filter((m) => m.source.id === sourceId).map((m) => m.id),
  );
}
/** Facts about the person themselves (name, role, level, preferences) apply in every chat and space. */
export const PROFILE_SCOPE = "user:me";
const STOP = new Set("the a an and or but of to in on for with at by from is are was were be been it this that these those what which who how why when where can could would should do does did i me my you your we our they them their he she his her its as if then than so not no yes please about into over under up down out just also very more most some any all each".split(" "));
/** Crude stemming: "explanations"/"explaining" and "explain" should meet. */
const stem = (w: string) => w.replace(/(?:ations?|ings?|ers?|ies|es|s|ed|ly|ment)$/u, "") || w;
const terms = (text: string) => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []).filter((t) => !STOP.has(t)).map(stem).filter((t) => t.length > 1))];
/** Share of meaningful words two sentences have in common (0 to 1). */
export function similarity(a: string, b: string) {
  const x = new Set(terms(a)), y = new Set(terms(b));
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}
function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) return 0;
  const dot = a.reduce((sum, x, i) => sum + x * b[i], 0),
    norm = Math.hypot(...a) * Math.hypot(...b);
  return norm ? dot / norm : 0;
}
/**
 * Memory for one request. Profile facts and confirmed preferences always apply (they describe
 * the person, not the topic); other records rank by overlap, recency and confirmation.
 */
export function retrieveMemory(
  state: MemoryState,
  scope: string,
  query: string,
  {
    budget = 6000,
    now = Date.now(),
    embedding,
  }: { budget?: number; now?: number; embedding?: number[] } = {},
) {
  if (!state.enabled) return [];
  const wanted = terms(query);
  const live = (m: Memory) => !m.supersededBy && (!m.expiresAt || Date.parse(m.expiresAt) > now);
  const ranked = state.records
    .filter((m) => live(m) && (m.scope === scope || m.sharedWith.includes(scope) || m.scope === PROFILE_SCOPE))
    .map((m) => {
      const words = terms(m.text + " " + m.key);
      const overlap = wanted.reduce((n, t) => n + (words.some((w) => w === t || (t.length > 3 && (w.startsWith(t) || t.startsWith(w)))) ? 1 : 0), 0);
      const always = m.scope === PROFILE_SCOPE || isPreference(m);
      const ageDays = (now - Date.parse(m.updatedAt)) / 86_400_000;
      const score =
        (always ? 2 : 0) + overlap * 1.5 + (m.confirmed ? 0.5 : 0) + Math.max(0, 0.5 - ageDays / 120) +
        (embedding && m.embedding ? Math.max(0, cosine(embedding, m.embedding)) * 3 : 0);
      return { memory: m, score, relevant: always || overlap > 0 || (embedding && m.embedding ? cosine(embedding, m.embedding) > 0.3 : false) };
    })
    .filter((m) => m.relevant)
    .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt));
  let used = 0;
  const seen = new Set<string>();
  return ranked.flatMap(({ memory }) => {
    const text = memory.text.trim().toLowerCase();
    if (seen.has(text) || used + memory.text.length > budget) return [];
    used += memory.text.length;
    seen.add(text);
    const { embedding, ...record } = memory;
    return [record];
  });
}
/** How the person wants answers: a confirmed preference, or one learned from what they asked for or corrected. */
export const isPreference = (m: Pick<Memory, "kind" | "key">) => m.kind === "preference" || m.key.startsWith("pref:");
/**
 * Compact lines for the model, preferences first: how the user wants answers matters on every
 * turn, while facts matter when they are relevant. Far fewer tokens than records.
 */
export function memoryLines(records: Omit<Memory, "embedding">[]) {
  const line = (m: Omit<Memory, "embedding">) => `- ${m.text.trim()} (${m.scope === PROFILE_SCOPE ? "about the user" : "this space"}; ${m.confirmed ? "confirmed" : "learned from conversation"}; ${m.updatedAt.slice(0, 10)}${m.expiresAt ? "; until " + m.expiresAt.slice(0, 10) : ""})`;
  const prefs = records.filter(isPreference), facts = records.filter((m) => !isPreference(m));
  return [
    prefs.length ? "How the user wants answers (follow these every time unless they ask otherwise now):\n" + prefs.map(line).join("\n") : "",
    facts.length ? (prefs.length ? "About the user and their work:\n" : "") + facts.map(line).join("\n") : "",
  ].filter(Boolean).join("\n");
}
/** Cheap gate: only messages where the person says something about themselves are worth a memory pass. */
export function mentionsSelf(text: string) {
  return correctsStyle(text) || /\b(i am|i'm|im|i work|i study|i teach|i live|i moved|my (?:name|job|role|major|degree|course|class|classes|exams?|goal|goals|level|company|team|field|background|school|university|college|teacher|professor|boss|thesis|project|research|students?|kids?|business|startup|native language|first language)|i have (?:a|an|my|to)|i need (?:this|it) for|i'?m (?:from|based in|in (?:year|grade|my))|i speak|i'?d (?:like|rather|prefer)|i would (?:like|rather|prefer)|i want (?:you|answers|replies)|i run|i own|i graduated|i'?m (?:taking|doing|writing|building|applying)|i prefer|i like|i love|i hate|i dislike|i don'?t like|i usually|i always|i never|i struggle|call me|remember|from now on|going forward|i'?ve been|i'?m (?:a|an|studying|learning|preparing|working))\b/i.test(text);
}
/** Corrections and standing instructions about answers ("shorter please", "stop using bullet points", "answer in Arabic"). */
export function correctsStyle(text: string) {
  return /\b(?:(?:too|way too|much too) (?:long|short|wordy|vague|technical|simple|basic|formal|casual)|(?:shorter|longer|simpler|briefer|more concise|more detailed?|less detail|more examples|fewer (?:words|bullets|emojis)) (?:please|next time|answers?|replies|responses)|(?:stop|don'?t|do not|never|avoid) (?:using|use|saying|say|adding|add|writing|write|including|include|giving|give)\b|(?:always|please always|from now on) (?:use|answer|reply|write|respond|include|give|explain|show|cite|keep)|(?:answer|reply|respond|write|explain) (?:in|using) (?:arabic|english|french|german|spanish|italian|turkish|urdu|hindi|chinese|japanese|korean|portuguese|russian|dutch|british english|american english|simple english|plain english|metric|imperial|si units|latex|markdown|bullet points|tables?|steps)|i (?:only )?(?:want|need|like) (?:short|long|detailed|brief|simple|step[- ]by[- ]step|concise)|my (?:deadline|exam|test|thesis|dissertation|assignment|teacher|professor|supervisor|boss|manager|client|interview|presentation|course|curriculum|syllabus) (?:is|are|was|will|on|in|at)|(?:due|deadline) (?:on|by|is)\b)/i.test(text);
}
/**
 * The person's own "remember that…" as a memory, used when extraction returns nothing: their words,
 * lightly cleaned, about them. Preferences ("I prefer…", "always…") keep answering in that style.
 */
export function rememberedWords(text: string): Learned[] {
  const words = text.replace(/^\s*(?:please\s+)?(?:remember|note|keep in mind)(?:\s+that)?[\s:,-]*/i, "").replace(/\s+/g, " ").trim().replace(/[.!]*$/, "");
  if (words.length < 3 || words.length > 400) return [];
  const preference = /\b(prefer|like|want|always|never|don'?t|please|answer|reply|explain|write|use)\b/i.test(words);
  const key = (preference ? "pref:" : "note:") + (words.toLowerCase().match(/[a-z0-9]+/g) || ["note"]).slice(0, 5).join("-");
  return [{ key: key.slice(0, 60), text: words[0].toUpperCase() + words.slice(1) + ".", kind: preference ? "preference" : "fact", about: "user" }];
}
export function explicitRemember(text: string) {
  return /^\s*(?:please\s+)?(?:remember|note|keep in mind)(?: that)?\b/i.test(text) || /\bfrom now on\b/i.test(text);
}
export const extractionInstructions = `You maintain a private memory of durable facts about the user, so future answers fit them. From the user's latest message, extract only lasting information about the USER: identity (name, role, field, level, school/company), goals and deadlines, and stable preferences about how they want answers (length, tone, language, format, units, level of detail, words or styles to avoid). A correction of the previous answer ("too long", "stop using bullet points", "answer in Arabic") is a preference when it reads as a standing wish rather than a one-off edit. The previous answer is given only so corrections make sense; never store anything the assistant said. Ignore the topic of the question itself and one-off requests. Never store secrets, passwords, health, financial, or other sensitive details unless the user explicitly asked you to remember them.
Return ONLY JSON: {"memories":[{"key":"short-stable-key","text":"one sentence in third person, e.g. The user is a second-year physics student.","kind":"fact"|"preference","about":"user"|"space","until":"YYYY-MM-DD (optional)"}]}. "about":"space" only for facts tied to the current project or subject. For time-bound facts (an exam, a deadline, a trip) set "until" to the day after it ends; leave it out for lasting facts. Reuse an existing key when the new information updates or contradicts it. Return {"memories":[]} when there is nothing durable. At most 5 items.`;
export type Learned = { key: string; text: string; kind: "fact" | "preference"; about: "user" | "space"; until?: string };
export function parseExtraction(raw: string): Learned[] {
  const json = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: any;
  try { value = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(value?.memories)) return [];
  return value.memories.slice(0, 5).flatMap((m: any) =>
    typeof m?.text === "string" && m.text.trim().length > 5 && m.text.length <= 400 && typeof m.key === "string" && /^[\w .:-]{1,60}$/.test(m.key) &&
    ["fact", "preference"].includes(m.kind) && ["user", "space"].includes(m.about)
      ? [{ key: m.key.trim().toLowerCase().replace(/\s+/g, "-"), text: m.text.trim(), kind: m.kind, about: m.about,
          ...(typeof m.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.until) && Number.isFinite(Date.parse(m.until)) ? { until: m.until } : {}) }]
      : [],
  );
}
/**
 * Stores what a conversation revealed. Learned items are unconfirmed ("inference") until the
 * person keeps them; an explicit "remember that…" is the person's own instruction and is confirmed.
 * A new item with the same key replaces the older learned one, so memory tracks change.
 */
export function learnMemories(state: MemoryState, items: Learned[], context: { scope: string; sourceId: string; explicit: boolean; now?: string }) {
  if (!state.enabled) return state;
  const now = context.now || new Date().toISOString();
  for (const item of items) {
    const scope = item.about === "user" ? PROFILE_SCOPE : context.scope;
    // Learned preferences keep a "pref:" key so they apply on every turn before the person confirms them.
    const key = item.kind === "preference" && !item.key.startsWith("pref:") ? ("pref:" + item.key).slice(0, 100) : item.key;
    const expiresAt = item.until && Date.parse(item.until) > Date.parse(now) ? new Date(item.until).toISOString() : undefined;
    const live = state.records.filter((m) => m.scope === scope && !m.supersededBy && (!m.expiresAt || Date.parse(m.expiresAt) > Date.parse(now)));
    if (live.some((m) => m.key === key && m.text.trim().toLowerCase() === item.text.toLowerCase())) continue;
    // The same thing said differently under another key updates that memory instead of sitting beside it.
    const similar = live.find((m) => m.key !== key && !m.confirmed && isPreference(m) === (item.kind === "preference") && similarity(m.text, item.text) >= 0.6);
    state = { ...state, records: state.records.filter((m) => !(m.scope === scope && m.key === key && !m.confirmed && !m.supersededBy)) };
    state = putMemory(state, {
      scope,
      key,
      text: item.text,
      kind: context.explicit ? item.kind : expiresAt ? "temporary" : "inference",
      confirmed: context.explicit,
      confidence: context.explicit ? 1 : 0.7,
      source: { id: context.sourceId, locator: context.explicit ? "You asked Mowr to remember this in a chat" : "Learned from your message in a chat", at: now },
      ...(expiresAt ? { expiresAt } : {}),
      derivedFrom: [],
      sharedWith: [],
    }, now);
    const added = state.records.at(-1)!;
    if (similar && added.text === item.text)
      state = { ...state, records: state.records.map((m) => (m.id === similar.id ? { ...m, supersededBy: added.id, updatedAt: now } : m)) };
  }
  // Keep learned memory bounded: the oldest unconfirmed items go first.
  const learned = state.records.filter((m) => !m.confirmed).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  if (learned.length > 200) {
    const drop = new Set(learned.slice(0, learned.length - 200).map((m) => m.id));
    state = { ...state, records: state.records.filter((m) => !drop.has(m.id)) };
  }
  return state;
}
/** Keeping a learned item makes it a confirmed fact or preference. */
export function confirmMemory(state: MemoryState, id: string, now = new Date().toISOString()) {
  const record = state.records.find((m) => m.id === id && !m.supersededBy);
  if (!record) throw Error("That memory no longer exists.");
  if (record.confirmed) return state;
  const kind: MemoryKind = /\b(prefer|likes?|wants?|style|format|length|tone)\b/i.test(record.text) ? "preference" : "fact";
  return putMemory({ ...state, records: state.records.filter((m) => m.id !== id) }, { ...record, kind, confirmed: true, confidence: 1, source: { ...record.source, locator: "Kept by you in memory settings", at: now } }, now);
}
