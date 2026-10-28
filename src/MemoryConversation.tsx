import { useEffect, useMemo, useState } from "react";
import { desktop } from "./desktop/bridge";
import { Icon } from "./Icons";
import { confirmDialog } from "./dialogs";
import { Menu } from "./space/SpaceMenu";
import { memoryPoints } from "../core/memory-points";
type Fact = {
  id: string;
  text: string;
  scope: string;
  confirmed: boolean;
  kind?: string;
  key?: string;
  updatedAt?: string;
  expiresAt?: string;
  sharedWith?: string[];
  source?: { locator?: string };
};
/** A project or subject a memory can live in or be shared with. */
export type MemoryPlace = { scope: string; label: string };
const PROFILE = "user:me";
const newestFirst = (records: Fact[]) => records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
/** The last records read, so reopening Memory shows them at once while a fresh copy loads. */
let remembered: Fact[] | null = null;
const keep = (records: Fact[]) => (remembered = newestFirst(records));
/** Reads memory ahead of time (the app calls this at start), so the first open is instant too. */
export function warmMemory() { if (desktop && !remembered) void desktop.invoke({ action: "memoryAll" }).then((r) => keep(r.records)).catch(() => {}); }
const cleanError = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
const isPreference = (m: Fact) => m.kind === "preference" || !!m.key?.startsWith("pref:");
/** Three dots: the options beside a memory. */
const Dots = () => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.25" fill="currentColor"/><circle cx="8" cy="8" r="1.25" fill="currentColor"/><circle cx="12.5" cy="8" r="1.25" fill="currentColor"/></svg>;
const Tick = () => <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.6l3 2.9 6.6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
/** A memory's words as a lead and dated points, so a long sentence reads like a list. */
function MemoryWords({ text }: { text: string }) {
  const { lead, points } = memoryPoints(text);
  return (
    <div className="memory-words">
      {lead && <p className="memory-lead">{lead}{points.length ? ":" : ""}</p>}
      {points.length > 0 && (
        <ul className="memory-points">
          {points.map((p, i) => <li key={i}><span>{p.text}</span>{p.when && <time>{p.when}</time>}</li>)}
        </ul>
      )}
    </div>
  );
}
/** One quiet line under a memory: how Clem came to know it, when, until when, and where else it applies. */
function metaOf(m: Fact, labelFor: (scope: string) => string, home?: string) {
  const parts = [
    m.confirmed ? (/chat/i.test(m.source?.locator || "") && /remember/i.test(m.source?.locator || "") ? "You asked Clem to remember" : /by you/i.test(m.source?.locator || "") ? "Added by you" : "Kept") : "Picked up in a chat",
    day(m.updatedAt),
    m.expiresAt ? "until " + day(m.expiresAt) : "",
    m.scope !== home && home && m.scope !== PROFILE ? "from " + labelFor(m.scope) : "",
    m.sharedWith?.some((s) => s !== home) ? "also in " + m.sharedWith.filter((s) => s !== home).map(labelFor).join(", ") : "",
  ];
  return parts.filter(Boolean).join(" · ");
}
/**
 * Everything Clem remembers, grouped by where it applies: about the person first, then the open
 * space, then other spaces and chats. Learned items wait for Keep; anything can be edited, moved to
 * where it belongs, shared with other projects or subjects, or forgotten.
 */
export function MemoryConversation({
  home,
  only = false,
  labelFor,
  places = [],
  summary = "",
  summaryLabel = "Your notes",
  onSummary,
  empty = "Share your role, goals or how you like answers in any chat and Clem keeps it here.",
}: {
  /** The open project or subject, if any: new memories are saved there and its group comes first. */
  home?: string;
  /** Show only `home`'s memories and what other spaces share with it (a project or subject page). */
  only?: boolean;
  labelFor: (scope: string) => string;
  /** Every project and subject, for moving a memory or sharing it. */
  places?: MemoryPlace[];
  summary?: string;
  summaryLabel?: string;
  onSummary?: (text: string) => void;
  empty?: string;
}) {
  const [facts, setFacts] = useState<Fact[] | null>(remembered),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState<{ id: string; text: string } | null>(null),
    [placing, setPlacing] = useState<{ id: string; scope: string; shared: string[] } | null>(null);
  const load = async () => setFacts(keep((await desktop!.invoke({ action: "memoryAll" })).records));
  useEffect(() => {
    let active = true;
    void desktop!.invoke({ action: "memoryAll" })
      .then((r) => { const records = keep(r.records); if (active) setFacts(records); })
      .catch(() => { if (active) { setFacts([]); setStatus("Memory could not be opened. Close and try again."); } });
    return () => { active = false; };
  }, []);
  const SHARED = "shared:";
  const groups = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    const order = (scope: string) => (scope === PROFILE ? 0 : scope === home ? 1 : scope === SHARED ? 2 : scope.startsWith("chat:") ? 4 : 3);
    const byScope = new Map<string, Fact[]>();
    for (const f of facts || []) {
      if (wanted && !f.text.toLowerCase().includes(wanted) && !labelFor(f.scope).toLowerCase().includes(wanted)) continue;
      // On a space's page: its own memories, then what other spaces share with it.
      const group = !only ? f.scope : f.scope === home ? home : home && f.sharedWith?.includes(home) ? SHARED : null;
      if (group) byScope.set(group, [...(byScope.get(group) || []), f]);
    }
    return [...byScope].sort((a, b) => order(a[0]) - order(b[0])).map(([scope, items]) => ({ scope, items }));
  }, [facts, home, only, query, labelFor]);
  const total = (facts || []).filter((f) => !only || f.scope === home || (home && f.sharedWith?.includes(home))).length;
  const aboutYou = only ? (facts || []).filter((f) => f.scope === PROFILE).length : 0;
  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    try { await task(); await load(); setStatus(""); return true; }
    catch (e) { setStatus(cleanError(e)); return false; }
    finally { setBusy(false); }
  }
  const act = (action: "memoryConfirm" | "memoryForget", id: string) => run(() => desktop!.invoke({ action, id }));
  const update = (id: string, change: { text?: string; scope?: string; sharedWith?: string[] }) => run(() => desktop!.invoke({ action: "memoryUpdate", id, ...change }));
  const keepAll = (items: Fact[]) => run(async () => { for (const m of items.filter((x) => !x.confirmed)) await desktop!.invoke({ action: "memoryConfirm", id: m.id }); });
  const count = total + (summary.trim() ? 1 : 0);
  const fresh = (facts || []).filter((f) => !f.confirmed && (!only || f.scope === home || (home && f.sharedWith?.includes(home)))).length;
  const homes: MemoryPlace[] = [{ scope: PROFILE, label: "About you (everywhere)" }, ...places];
  return (
    <section className="memory-panel">
      <div className="memory-head">
        <p className="memory-lede">{facts === null ? " " : count ? <>{`${count} ${count === 1 ? "thing" : "things"} remembered${aboutYou ? ` here, plus ${aboutYou} about you that ${aboutYou === 1 ? "applies" : "apply"} everywhere` : ""}`}{fresh > 0 && <span className="memory-fresh"> · {fresh} new to review</span>}</> : "Nothing remembered yet"}</p>
        {total > 6 && (
          <label className="memory-search">
            <Icon name="search" size={13} />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search memory" aria-label="Search memory" />
          </label>
        )}
      </div>
      <div className="memory-scroll">
      {facts !== null && !count && (
        <div className="memory-empty">
          <span className="memory-empty-mark"><Icon name="subjects" size={22} /></span>
          <p>{empty}</p>
        </div>
      )}
      {facts !== null && !!count && query.trim() && !groups.length && <p className="memory-none">Nothing in memory matches “{query.trim()}”.</p>}
      {summary.trim() && onSummary && !query.trim() && (
        <div className="memory-group">
          <h4>{summaryLabel}</h4>
          <ul><li><div className="memory-body"><MemoryWords text={summary.trim()} /></div><span className="memory-actions"><Menu label="Options for your notes" trigger={<Dots />} items={[{ label: "Forget", icon: "trash", danger: true, run: async () => { if (await confirmDialog({ title: `Forget “${summaryLabel}”?`, message: "All of it is erased. Clem stops using it in new answers.", confirm: "Forget", danger: true })) onSummary(""); } }]} /></span></li></ul>
        </div>
      )}
      {groups.map(({ scope, items }) => {
        const learned = items.filter((m) => !m.confirmed).length;
        return (
          <div className="memory-group" key={scope}>
            {(!only || scope === SHARED || learned > 1) && (
              <div className="memory-group-head">
                {(scope === SHARED || !only) && <h4>{scope === SHARED ? "Shared from other spaces" : labelFor(scope)}<span className="memory-count">{items.length}</span></h4>}
                {learned > 1 && <button type="button" className="memory-keep-all" disabled={busy} onClick={() => void keepAll(items)}>Keep all {learned}</button>}
              </div>
            )}
            <ul>
              {items.map((m) => (
                <li key={m.id} className={m.confirmed ? "" : "learned"}>
                  <div className="memory-body">
                    {editing?.id === m.id ? (
                      <form className="memory-edit" onSubmit={async (e) => { e.preventDefault(); const value = editing.text.trim(); if (!value) return; if (value === m.text || await update(m.id, { text: value })) setEditing(null); }}>
                        <textarea autoFocus value={editing.text} maxLength={2000} rows={Math.min(5, Math.max(1, Math.ceil(editing.text.length / 70)))} aria-label="Edit memory"
                          onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                          onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
                        <span className="memory-edit-actions"><button type="button" onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="memory-keep" disabled={busy || !editing.text.trim()}>Save</button></span>
                      </form>
                    ) : (
                      <MemoryWords text={m.text} />
                    )}
                    {editing?.id !== m.id && (
                      <span className="memory-meta">
                        {!m.confirmed && <span className="memory-new">New</span>}
                        <span>{[isPreference(m) ? "How you like answers" : "", metaOf(m, labelFor, only ? home : undefined)].filter(Boolean).join(" · ")}</span>
                      </span>
                    )}
                    {!m.confirmed && editing?.id !== m.id && placing?.id !== m.id && (
                      <span className="memory-review">
                        <button type="button" className="memory-keep" disabled={busy} aria-description="Clem picked this up in a chat. Keep it?" onClick={() => void act("memoryConfirm", m.id)}><Tick />Keep</button>
                        <button type="button" className="memory-drop" disabled={busy} onClick={() => void act("memoryForget", m.id)}>Forget</button>
                      </span>
                    )}
                    {placing?.id === m.id && (
                      <form className="memory-place" onSubmit={async (e) => { e.preventDefault(); if (await update(m.id, { scope: placing.scope, sharedWith: placing.scope === PROFILE ? [] : placing.shared })) setPlacing(null); }}>
                        <label>Applies to
                          <select value={placing.scope} onChange={(e) => setPlacing({ ...placing, scope: e.target.value, shared: placing.shared.filter((s) => s !== e.target.value) })}>
                            {homes.map((p) => <option key={p.scope} value={p.scope}>{p.label}</option>)}
                            {!homes.some((p) => p.scope === m.scope) && <option value={m.scope}>{labelFor(m.scope)}</option>}
                          </select>
                        </label>
                        {placing.scope !== PROFILE && places.length > 1 && (
                          <fieldset>
                            <legend>Also use in</legend>
                            {places.filter((p) => p.scope !== placing.scope).map((p) => (
                              <label key={p.scope} className="memory-share"><input type="checkbox" checked={placing.shared.includes(p.scope)} onChange={(e) => setPlacing({ ...placing, shared: e.target.checked ? [...placing.shared, p.scope].slice(0, 10) : placing.shared.filter((s) => s !== p.scope) })} />{p.label}</label>
                            ))}
                          </fieldset>
                        )}
                        <span className="memory-edit-actions"><button type="button" onClick={() => setPlacing(null)}>Cancel</button><button type="submit" className="memory-keep" disabled={busy}>Save</button></span>
                      </form>
                    )}
                  </div>
                  {editing?.id !== m.id && placing?.id !== m.id && (
                    <span className="memory-actions">
                      <Menu label={"Options for: " + m.text.slice(0, 60)} trigger={<Dots />} items={[
                        { label: "Edit", icon: "rename", run: () => { setPlacing(null); setEditing({ id: m.id, text: m.text }); } },
                        ...(homes.length > 1 ? [{ label: m.scope === PROFILE ? "Move to a project or subject" : "Where it applies…", run: () => { setEditing(null); setPlacing({ id: m.id, scope: m.scope, shared: m.sharedWith || [] }); } }] : []),
                        ...(only && home && m.scope !== home && m.sharedWith?.includes(home) ? [{ label: "Stop using here", run: () => void update(m.id, { sharedWith: (m.sharedWith || []).filter((s) => s !== home) }) }] : []),
                        { label: "Forget", icon: "trash", danger: true, run: () => void act("memoryForget", m.id) },
                      ]} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      </div>
      <form
        className="memory-add"
        onSubmit={async (e) => {
          e.preventDefault();
          const value = text.trim();
          if (!value || busy || facts === null) return;
          if (await run(() => desktop!.invoke({ action: "memorySave", scope: home || PROFILE, key: "note:" + crypto.randomUUID().slice(0, 18), text: value, kind: /\b(prefer\w*|like|want|always|never|please|answers?|repl(?:y|ies)|explain\w*|use|avoid|keep|short|brief|concise|detailed|simple|formal|casual|tone|style|format\w*)\b/i.test(value) ? "preference" : "fact", sharedWith: [], source: "Added by you in memory settings" }))) setText("");
        }}
      >
        <input value={text} disabled={busy || facts === null} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder={home ? "Add something Clem should remember here" : "Add something for Clem to remember"} aria-label="Add a memory" />
        <button type="submit" className="memory-send" disabled={busy || facts === null || !text.trim()} aria-label="Remember"><Icon name="up" size={15} /></button>
      </form>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
