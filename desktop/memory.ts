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
      const always = m.scope === PROFILE_SCOPE || (m.kind === "preference" && m.confirmed);
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
/** Compact lines for the model: far fewer tokens than records, with what matters for trust. */
export function memoryLines(records: Omit<Memory, "embedding">[]) {
  return records
    .map((m) => `- ${m.text.trim()} (${m.scope === PROFILE_SCOPE ? "about the user" : "this space"}; ${m.confirmed ? "confirmed" : "learned from conversation"}; ${m.updatedAt.slice(0, 10)})`)
    .join("\n");
}
/** Cheap gate: only messages where the person says something about themselves are worth a memory pass. */
export function mentionsSelf(text: string) {
  return /\b(i am|i'm|im|i work|i study|i teach|i live|i moved|my (?:name|job|role|major|degree|course|class|exam|goal|level|company|team|field|background|school|university)|i prefer|i like|i love|i hate|i dislike|i don'?t like|i usually|i always|i never|i struggle|call me|remember|from now on|going forward|i'?ve been|i'?m (?:a|an|studying|learning|preparing|working))\b/i.test(text);
}
export function explicitRemember(text: string) {
  return /^\s*(?:please\s+)?(?:remember|note|keep in mind)(?: that)?\b/i.test(text) || /\bfrom now on\b/i.test(text);
}
export const extractionInstructions = `You maintain a private memory of durable facts about the user, so future answers fit them. From the user's latest message, extract only lasting information about the USER: identity (name, role, field, level, school/company), goals and deadlines, and stable preferences about how they want answers (length, tone, language, format, units, level of detail). Ignore the topic of the question itself, one-off requests, and anything the assistant said. Never store secrets, passwords, health, financial, or other sensitive details unless the user explicitly asked you to remember them.
Return ONLY JSON: {"memories":[{"key":"short-stable-key","text":"one sentence in third person, e.g. The user is a second-year physics student.","kind":"fact"|"preference","about":"user"|"space"}]}. "about":"space" only for facts tied to the current project or subject. Reuse an existing key when the new information updates it. Return {"memories":[]} when there is nothing durable. At most 4 items.`;
export type Learned = { key: string; text: string; kind: "fact" | "preference"; about: "user" | "space" };
export function parseExtraction(raw: string): Learned[] {
  const json = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: any;
  try { value = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(value?.memories)) return [];
  return value.memories.slice(0, 4).flatMap((m: any) =>
    typeof m?.text === "string" && m.text.trim().length > 5 && m.text.length <= 400 && typeof m.key === "string" && /^[\w .:-]{1,60}$/.test(m.key) &&
    ["fact", "preference"].includes(m.kind) && ["user", "space"].includes(m.about)
      ? [{ key: m.key.trim().toLowerCase().replace(/\s+/g, "-"), text: m.text.trim(), kind: m.kind, about: m.about }]
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
    const current = state.records.filter((m) => m.scope === scope && m.key === item.key && !m.supersededBy);
    if (current.some((m) => m.text.trim().toLowerCase() === item.text.toLowerCase())) continue;
    state = { ...state, records: state.records.filter((m) => !(m.scope === scope && m.key === item.key && !m.confirmed && !m.supersededBy)) };
    state = putMemory(state, {
      scope,
      key: item.key,
      text: item.text,
      kind: context.explicit ? item.kind : "inference",
      confirmed: context.explicit,
      confidence: context.explicit ? 1 : 0.7,
      source: { id: context.sourceId, locator: context.explicit ? "You asked Mowr to remember this in a chat" : "Learned from your message in a chat", at: now },
      derivedFrom: [],
      sharedWith: [],
    }, now);
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
