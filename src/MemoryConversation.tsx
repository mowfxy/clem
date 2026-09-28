import { useEffect, useMemo, useState } from "react";
import { desktop } from "./desktop/bridge";
import { Icon } from "./Icons";
import { confirmDialog } from "./dialogs";
type Fact = {
  id: string;
  text: string;
  scope: string;
  confirmed: boolean;
  updatedAt?: string;
};
const PROFILE = "user:me";
const newestFirst = (records: Fact[]) => records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
/** The last records read, so reopening Memory shows them at once while a fresh copy loads. */
let remembered: Fact[] | null = null;
const keep = (records: Fact[]) => (remembered = newestFirst(records));
/** Reads memory ahead of time (the app calls this at start), so the first open is instant too. */
export function warmMemory() { if (desktop && !remembered) void desktop.invoke({ action: "memoryAll" }).then((r) => keep(r.records)).catch(() => {}); }
const cleanError = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
/**
 * Everything Mowr remembers, grouped by where it applies: about the person first, then the open
 * space, then other spaces and chats. Learned items wait for Keep; anything can be forgotten.
 */
export function MemoryConversation({
  home,
  only = false,
  labelFor,
  summary = "",
  summaryLabel = "Your notes",
  onSummary,
  empty = "Share your role, goals or how you like answers in any chat and Mowr keeps it here.",
}: {
  /** The open project or subject, if any: new memories are saved there and its group comes first. */
  home?: string;
  /** Show only `home`'s memories (a project or subject page). */
  only?: boolean;
  labelFor: (scope: string) => string;
  summary?: string;
  summaryLabel?: string;
  onSummary?: (text: string) => void;
  empty?: string;
}) {
  const [facts, setFacts] = useState<Fact[] | null>(remembered),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState("");
  const load = async () => setFacts(keep((await desktop!.invoke({ action: "memoryAll" })).records));
  useEffect(() => {
    let active = true;
    void desktop!.invoke({ action: "memoryAll" })
      .then((r) => { const records = keep(r.records); if (active) setFacts(records); })
      .catch(() => { if (active) { setFacts([]); setStatus("Memory could not be opened. Close and try again."); } });
    return () => { active = false; };
  }, []);
  const groups = useMemo(() => {
    const order = (scope: string) => (scope === PROFILE ? 0 : scope === home ? 1 : scope.startsWith("chat:") ? 3 : 2);
    const byScope = new Map<string, Fact[]>();
    for (const f of facts || []) if (!only || f.scope === home) byScope.set(f.scope, [...(byScope.get(f.scope) || []), f]);
    return [...byScope].sort((a, b) => order(a[0]) - order(b[0])).map(([scope, items]) => ({ scope, items }));
  }, [facts, home, only]);
  async function act(action: "memoryConfirm" | "memoryForget", id: string) {
    setBusy(true);
    try { await desktop!.invoke({ action, id }); await load(); setStatus(""); }
    catch (e) { setStatus(cleanError(e)); }
    finally { setBusy(false); }
  }
  const count = groups.reduce((n, g) => n + g.items.length, 0) + (summary.trim() ? 1 : 0);
  return (
    <section className="memory-panel">
      <p className="memory-lede">{facts === null ? " " : count ? `${count} ${count === 1 ? "thing" : "things"} remembered` : "Nothing remembered yet"}</p>
      {facts !== null && !count && (
        <div className="memory-empty">
          <span className="memory-empty-mark"><Icon name="subjects" size={22} /></span>
          <p>{empty}</p>
        </div>
      )}
      {summary.trim() && onSummary && (
        <div className="memory-group">
          <h4>{summaryLabel}</h4>
          <ul><li><span className="memory-text">{summary.trim()}</span><span className="memory-actions"><button type="button" className="memory-icon" disabled={busy} aria-label="Forget your notes" title="Forget" onClick={async () => { if (await confirmDialog({ title: `Forget “${summaryLabel}”?`, message: "All of it is erased. Mowr stops using it in new answers.", confirm: "Forget", danger: true })) onSummary(""); }}><Icon name="close" size={13} /></button></span></li></ul>
        </div>
      )}
      {groups.map(({ scope, items }) => (
        <div className="memory-group" key={scope}>
          {!only && <h4>{labelFor(scope)}</h4>}
          <ul>
            {items.map((m) => (
              <li key={m.id} className={m.confirmed ? "" : "learned"}>
                <span className="memory-text">{m.text}</span>
                <span className="memory-actions">
                  {!m.confirmed && <button type="button" className="memory-keep" disabled={busy} title="Learned from a chat. Keep it?" onClick={() => void act("memoryConfirm", m.id)}>Keep</button>}
                  <button type="button" className="memory-icon" disabled={busy} aria-label={"Forget: " + m.text} title="Forget" onClick={() => void act("memoryForget", m.id)}><Icon name="close" size={13} /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <form
        className="memory-add"
        onSubmit={async (e) => {
          e.preventDefault();
          const value = text.trim();
          if (!value || busy || facts === null) return;
          setBusy(true);
          setStatus("");
          try {
            await desktop!.invoke({ action: "memorySave", scope: home || PROFILE, key: "note:" + crypto.randomUUID().slice(0, 18), text: value, kind: /\b(prefer|like|want|always|never|please|answer|reply|explain)\b/i.test(value) ? "preference" : "fact", sharedWith: [], source: "Added by you in memory settings" });
            setText("");
            await load();
          } catch (err) { setStatus(cleanError(err)); }
          finally { setBusy(false); }
        }}
      >
        <input value={text} disabled={busy || facts === null} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Add something for Mowr to remember" aria-label="Add a memory" />
        <button type="submit" className="memory-send" disabled={busy || facts === null || !text.trim()} aria-label="Remember"><Icon name="up" size={15} /></button>
      </form>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
