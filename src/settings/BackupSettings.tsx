import { useEffect, useState } from "react";
import { desktop } from "../desktop/bridge";
import { confirmDialog } from "../dialogs";
import { SettingsPopup } from "../SettingsPopup";
import { sizeLabel } from "../store";
import { SettingsCard, SettingRow } from "./SettingsParts";

type Status = { destination?: { kind: "folder"; path: string } | { kind: "drive" }; schedule: "off" | "daily" | "weekly"; keep: number; passphrase: boolean; running: boolean; driveConnected?: boolean; last?: { at?: number; tried?: number; error?: string; size?: number; where?: string } };
type Item = { source: "folder"; path: string; name: string; at: number; kind?: string; size: number } | { source: "drive"; id: string; name: string; at: number; size: number };
type Summary = { createdAt: number; chats: number; subjects: number; projects: number; files: number; folders: number; studySets: number; cards: number; reviewed: number; automations: number; bytes: number };
type Counts = Omit<Summary, "createdAt" | "bytes"> & { empty?: boolean };

const when = (t: number) => new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
/** "3 chats, 2 subjects, 41 files, 120 cards (80 reviewed), 1 routine". */
export function describeCounts(c: Counts) {
  return [plural(c.chats, "chat"), c.subjects && plural(c.subjects, "subject"), c.projects && plural(c.projects, "project"), plural(c.files, "file"), c.folders && plural(c.folders, "folder"),
    c.cards ? plural(c.cards, "card") + (c.reviewed ? ` (${c.reviewed} with review history)` : "") : "", c.automations && plural(c.automations, "routine")].filter(Boolean).join(", ");
}
const pick = (item: Item) => (item.source === "folder" ? { source: "folder" as const, path: item.path } : { source: "drive" as const, id: item.id });

/** Settings → Data & privacy: encrypted backups of the whole workspace, made now or on a schedule, and restoring one. */
export function BackupSettings({ onError }: { onError: (message: string) => void }) {
  const [status, setStatus] = useState<Status | null>(null), [phrase, setPhrase] = useState<null | { one: string; two: string }>(null), [busy, setBusy] = useState(false);
  const fail = (e: unknown) => onError((e as Error).message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") || "That didn't work. Try again.");
  const refresh = () => desktop?.invoke({ action: "backupStatus" }).then(setStatus, fail);
  useEffect(() => { void refresh(); }, []);
  if (!desktop || !status) return null;
  const configure = (change: Record<string, unknown>) => desktop!.invoke({ action: "backupConfigure", ...change } as any).then(setStatus, fail);
  const where = !status.destination ? "Not chosen yet" : status.destination.kind === "drive" ? "Google Drive › Clem backups" + (status.driveConnected === false ? " (connect Drive in Connectors)" : "") : status.destination.path;
  const last = status.last;
  const lastLine = last?.error && (!last.at || (last.tried || 0) > last.at) ? `The last backup didn't finish: ${last.error}` : last?.at ? `Last backed up ${when(last.at)}${last.size ? " · " + sizeLabel(last.size) : ""}` : "Not backed up yet";
  const ready = !!status.destination && status.passphrase;
  return <>
    <SettingsCard title="Backups" note="Encrypted with your passphrase. Clem can't recover it if you forget it.">
      <SettingRow title="Where" description={where}>
        <button className="secondary" onClick={() => void configure({ chooseFolder: true })}>Folder…</button>
        <button className="secondary" aria-pressed={status.destination?.kind === "drive"} onClick={() => void configure({ destination: { kind: "drive" } })}>Google Drive</button>
      </SettingRow>
      <SettingRow title="Passphrase" description={status.passphrase ? "Set" : "Needed before the first backup"}>
        {!phrase && <button className="secondary" onClick={() => setPhrase({ one: "", two: "" })}>{status.passphrase ? "Change" : "Set passphrase"}</button>}
      </SettingRow>
      {phrase && <form className="st-row backup-phrase" onSubmit={(e) => {
        e.preventDefault();
        if (phrase.one.length < 8) return onError("Use at least 8 characters for the passphrase.");
        if (phrase.one !== phrase.two) return onError("The two passphrases don't match.");
        void configure({ passphrase: phrase.one }).then(() => setPhrase(null));
      }}>
        <input type="password" aria-label="Backup passphrase" placeholder="Passphrase" autoComplete="new-password" minLength={8} maxLength={200} autoFocus value={phrase.one} onChange={(e) => setPhrase({ ...phrase, one: e.target.value })} />
        <input type="password" aria-label="Type the passphrase again" placeholder="Again" autoComplete="new-password" maxLength={200} value={phrase.two} onChange={(e) => setPhrase({ ...phrase, two: e.target.value })} />
        <button type="submit">Save</button><button type="button" className="secondary" onClick={() => setPhrase(null)}>Cancel</button>
      </form>}
      <SettingRow title="Back up automatically" description={status.schedule === "off" ? undefined : `Keeps the newest ${status.keep ?? 3}`}>
        <span className="text-size" role="radiogroup" aria-label="Backup schedule">{([["off", "Off"], ["daily", "Daily"], ["weekly", "Weekly"]] as const).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={status.schedule === value} onClick={() => void configure({ schedule: value })}>{label}</button>)}</span>
        <select className="backup-keep" aria-label="Backups to keep" value={status.keep} onChange={(e) => void configure({ keep: Number(e.target.value) })}>{[3, 7, 14, 30].map((n) => <option key={n} value={n}>Keep {n}</option>)}</select>
      </SettingRow>
      <SettingRow title={lastLine} description={ready ? undefined : "Pick a place and a passphrase first"}>
        <button disabled={!ready || busy || status.running} onClick={() => { setBusy(true); void desktop!.invoke({ action: "backupNow" }).then(() => refresh(), (e) => { fail(e); void refresh(); }).finally(() => setBusy(false)); }}>{busy || status.running ? "Backing up…" : "Back up now"}</button>
      </SettingRow>
    </SettingsCard>
    <SettingsCard title="Restore" note="Moving to a new PC? Install Clem, sign in, then restore.">
      <SettingRow title="Restore a backup" description="What's here now is backed up first">
        <SettingsPopup bare title="Restore a backup" action="Restore…"><RestorePanel saved={status.passphrase} onError={onError} /></SettingsPopup>
      </SettingRow>
    </SettingsCard>
  </>;
}

/** Choosing a backup, previewing it and restoring it. */
function RestorePanel({ saved, onError }: { saved: boolean; onError: (message: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null), [chosen, setChosen] = useState<Item | null>(null), [passphrase, setPassphrase] = useState("");
  const [preview, setPreview] = useState<{ summary: Summary; current: Counts } | null>(null), [busy, setBusy] = useState("");
  const fail = (e: unknown) => onError((e as Error).message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") || "That didn't work. Try again.");
  const load = (from?: "file" | "drive") => { setBusy("Looking for backups…"); setPreview(null); void desktop!.invoke({ action: "backupList", ...(from ? { from } : {}) }).then((r: { items: Item[]; chosen?: string } | null) => {
    if (!r) return;
    setItems(r.items);
    setChosen((r.chosen && r.items.find((i) => i.source === "folder" && i.path === r.chosen)) || r.items[0] || null);
  }, fail).finally(() => setBusy("")); };
  useEffect(() => { load(); }, []);
  const show = () => { if (!chosen) return; setBusy("Opening the backup…"); void desktop!.invoke({ action: "backupPreview", item: pick(chosen), ...(passphrase ? { passphrase } : {}) }).then(setPreview, fail).finally(() => setBusy("")); };
  const restore = async () => {
    if (!chosen || !preview) return;
    if (!preview.current.empty && !await confirmDialog({ title: "Replace your workspace?", message: `What's here now (${describeCounts(preview.current)}) is replaced by the backup from ${when(preview.summary.createdAt)}. A copy of it is saved to Documents\\Clem\\Backups first, and you can restore that copy the same way.`, confirm: "Restore", danger: true })) return;
    setBusy("Restoring…");
    try { await desktop!.invoke({ action: "backupRestore", item: pick(chosen), confirmed: true, ...(passphrase ? { passphrase } : {}) }); setBusy("Restored. Clem is reloading…"); }
    catch (e) { fail(e); setBusy(""); }
  };
  return <div className="backup-restore">
    <div className="backup-sources">
      <button className="secondary" onClick={() => load()}>Backup folder</button>
      <button className="secondary" onClick={() => load("file")}>Choose a file…</button>
      <button className="secondary" onClick={() => load("drive")}>Google Drive</button>
    </div>
    {items && !items.length && <p className="muted">No backups here yet.</p>}
    {!!items?.length && <ul className="backup-list" role="listbox" aria-label="Backups">{items.map((item) => {
      const key = item.source === "folder" ? item.path : item.id, on = !!chosen && (chosen.source === "folder" ? chosen.path : chosen.id) === key;
      return <li key={key} role="option" aria-selected={on}><button type="button" className={on ? "chosen" : ""} onClick={() => { setChosen(item); setPreview(null); }}>
        <strong>{when(item.at)}</strong><span>{item.name.startsWith("Clem before restore") ? "Saved before a restore" : item.source === "drive" ? "Google Drive" : "This PC"} · {sizeLabel(item.size)}</span>
      </button></li>;
    })}</ul>}
    {chosen && !preview && <form className="backup-open" onSubmit={(e) => { e.preventDefault(); show(); }}>
      <input type="password" aria-label="Backup passphrase" placeholder={saved ? "Passphrase (leave empty to use yours)" : "Backup passphrase"} autoComplete="current-password" maxLength={200} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      <button type="submit" disabled={!!busy || (!saved && !passphrase)}>See what's inside</button>
    </form>}
    {preview && <div className="backup-preview" role="status">
      <p><strong>From {when(preview.summary.createdAt)}</strong> · {sizeLabel(preview.summary.bytes)}</p>
      <p>{describeCounts(preview.summary)}.</p>
      <p className="muted">{preview.current.empty ? "Your workspace here is empty." : `Here now: ${describeCounts(preview.current)}.`}</p>
      <button className="danger" disabled={!!busy} onClick={() => void restore()}>Restore this backup</button>
    </div>}
    {busy && <p className="muted" role="status">{busy}</p>}
  </div>;
}
