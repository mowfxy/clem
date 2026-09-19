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
function cosine(a: number[], b: number[]) {
  if (a.length !== b.length || !a.length) return 0;
  const dot = a.reduce((sum, x, i) => sum + x * b[i], 0),
    norm = Math.hypot(...a) * Math.hypot(...b);
  return norm ? dot / norm : 0;
}
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
  const terms = [
    ...new Set(query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []),
  ];
  const ranked = state.records
    .filter(
      (m) =>
        (m.scope === scope || m.sharedWith.includes(scope)) &&
        !m.supersededBy &&
        (!m.expiresAt || Date.parse(m.expiresAt) > now),
    )
    .map((m) => ({
      memory: m,
      score:
        terms.reduce(
          (score, t) =>
            score +
            (m.text.toLowerCase().includes(t) ? 1 : 0) +
            (m.key.toLowerCase().includes(t) ? 2 : 0),
          0,
        ) +
        (embedding && m.embedding
          ? Math.max(0, cosine(embedding, m.embedding)) * 3
          : 0),
    }))
    .filter((m) => m.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.memory.updatedAt.localeCompare(a.memory.updatedAt),
    );
  let used = 0;
  const seen = new Set<string>();
  return ranked.flatMap(({ memory }) => {
    if (seen.has(memory.text) || used + memory.text.length > budget) return [];
    used += memory.text.length;
    seen.add(memory.text);
    const { embedding, ...record } = memory;
    return [record];
  });
}
