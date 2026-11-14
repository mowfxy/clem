// The window's side of Clem's organizer (desktop/engine/organizer.ts): it applies what the organizer decided to the
// workspace (core/proactivity/actions.ts), posts its messages in the main thread, and puts back what the person asked
// to undo (in words, clem.undo; or from Settings → Proactivity's log). Nothing here raises a toast or a dialog: what
// Clem says by itself is plain messages, and the person answers in words. Line statuses are cached here for old cards.
import { useEffect, useState } from "react";
import { applyAction, proAction, undoAction, type Undo, type Workspace } from "../../core/proactivity/actions";
import { desktop } from "../desktop/bridge";
import type { State } from "../store";

const ask = <T,>(request: Record<string, unknown>) => desktop!.invoke(request as never) as Promise<T>;

// ---------- Live line statuses ----------
const statuses = new Map<string, string>();
const listeners = new Set<() => void>();
let wanted = new Set<string>(), timer: ReturnType<typeof setTimeout> | undefined;
const notify = () => { for (const fn of listeners) fn(); };
export const setStatus = (key: string, status: string) => { statuses.set(key, status); notify(); };
/** Reads every status asked for in this tick in one request. */
function want(keys: string[]) {
  for (const k of keys) if (!statuses.has(k)) wanted.add(k);
  if (!wanted.size || timer || !desktop) return;
  timer = setTimeout(() => {
    const keys = [...wanted].slice(0, 100); wanted = new Set([...wanted].slice(100)); timer = undefined;
    void ask<Record<string, string>>({ action: "proStatus", keys }).then((got) => { for (const k of keys) statuses.set(k, got?.[k] || "none"); notify(); }, () => {});
  }, 30);
}
/** Statuses for a card's keyed lines (applied, undone, confirm, dismissed, failed, said, apply, none). */
export function useProStatus(keys: string[]) {
  const [, tick] = useState(0);
  const sig = keys.join("\n");
  useEffect(() => { want(keys); const fn = () => tick((n) => n + 1); listeners.add(fn); return () => { listeners.delete(fn); }; }, [sig]);
  return (key: string) => statuses.get(key);
}
export const refreshStatuses = () => { const keys = [...statuses.keys()]; statuses.clear(); want(keys); };

export type ProDeps = {
  state: () => State;
  patch: (fn: (s: State) => State) => void;
};
const pick = (s: State): Workspace => ({ plans: s.plans, files: s.files, spaces: s.spaces, memory: s.memory, automations: s.automations });
const put = (s: State, w: Workspace): State => ({ ...s, plans: w.plans, files: w.files, memory: w.memory, automations: w.automations });

export function createPro(deps: ProDeps) {
  let busy = false;
  /** Applies one action to the workspace now; the result for the engine. */
  function apply(key: string, raw: unknown) {
    const parsed = proAction.safeParse(raw);
    if (!parsed.success) return { key, ok: false, error: "Unreadable" };
    const r = applyAction(pick(deps.state()), parsed.data);
    if ("error" in r) return { key, ok: false, error: r.error };
    deps.patch((s) => put(s, r.state));
    setStatus(key, r.undo ? "applied" : "done");
    return { key, ok: true, undo: r.undo };
  }
  /** What the organizer decided since last time: its actions applied, what the person undid in words put back, its
   *  messages posted in the main thread. */
  async function pull() {
    if (busy || !desktop) return;
    busy = true;
    try {
      const inbox = await ask<{ posts: { id: string; content: string; at: number }[]; apply: { key: string; action: unknown }[]; revert?: { key: string; undo: Undo }[] }>({ action: "proInbox" });
      if (!Array.isArray(inbox?.apply) || !Array.isArray(inbox.posts)) return;
      const results = inbox.apply.map((a) => apply(a.key, a.action));
      const reverted = (inbox.revert || []).map((r) => { deps.patch((s) => put(s, undoAction(pick(s), r.undo))); setStatus(r.key, "undone"); return r.key; });
      const main = deps.state().chats.find((c) => c.kind === "main");
      const posts = main ? inbox.posts : [];
      if (posts.length) deps.patch((s) => ({ ...s, chats: s.chats.map((c) => c.kind !== "main" ? c : { ...c, updated: Date.now(), messages: [...c.messages, ...posts.filter((p) => !c.messages.some((m) => m.id === p.id)).map((p) => ({ id: p.id, role: "assistant" as const, content: p.content, at: p.at }))] }) }));
      if (results.length || posts.length || reverted.length) await ask({ action: "proAck", posts: posts.map((p) => p.id), results, ...(reverted.length ? { reverted } : {}) });
      if (posts.length) refreshStatuses();
    } catch { /* the engine isn't open yet: next time */ } finally { busy = false; }
  }
  /** Undo from Settings → Proactivity's log (or a button on an older Telegram message): false when it can't any more. */
  async function undo(key: string) {
    try {
      const u = await ask<Undo | null>({ action: "proUndo", key });
      if (!u) return false;
      deps.patch((s) => put(s, undoAction(pick(s), u)));
      setStatus(key, "undone");
      return true;
    } catch { return false; }
  }
  /** "Do it" on an older Telegram message that still has the button. */
  async function confirm(key: string) {
    try {
      const got = await ask<{ key: string; action: unknown } | null>({ action: "proConfirm", key });
      if (!got) return false;
      const r = apply(got.key, got.action);
      await ask({ action: "proAck", results: [r] });
      return r.ok;
    } catch { return false; }
  }
  return { pull, undo, confirm };
}
export type Pro = ReturnType<typeof createPro>;
