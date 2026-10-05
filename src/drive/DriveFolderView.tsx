import { useEffect, useRef, useState, type DragEvent } from "react";
import { Icon } from "../Icons";
import { DriveLogo } from "../BrandLogos";
import { DriveIcon, kindName } from "./DriveIcon";
import { driveFolder, uploadToDrive, useDrive, type DriveItem } from "./drive";
import "./drive.css";

const ago = (iso?: string) => { if (!iso) return ""; const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000); return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 7 ? `${d} days ago` : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }); };

/**
 * A Drive folder linked to a subject or project, read live from Google each time it is shown (and every few
 * minutes while open). Subfolders open in place; files open in Mowr's viewer or play, streamed, never copied.
 * Files dropped on it (from this PC or from Mowr's own files) are saved straight into Drive, into the folder they land on:
 * each shows in place at once with an upload ring, which turns into a check once Drive has it.
 */
type Pending = { key: string; name: string; target: string; type: string; state: "uploading" | "failed"; error?: string };
export function DriveFolderView({ folderId, folderName, onOpen, onAsk, onChangeFolder, onUnlink, onItems, onResolveFile }: {
  folderId: string; folderName: string; onOpen: (file: DriveItem) => void; onAsk: (files: DriveItem[]) => void;
  onChangeFolder: () => void; onUnlink: () => void; onItems?: (items: DriveItem[]) => void;
  /** The bytes of a Mowr file dragged here, so it can be saved into Drive too. */
  onResolveFile?: (id: string) => Promise<{ blob: Blob; name: string } | undefined>;
}) {
  const { connected } = useDrive();
  const [items, setItems] = useState<DriveItem[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [at, setAt] = useState("");
  const [over, setOver] = useState<string | null>(null);
  // Files on their way to Drive, shown in place at once; and the Drive ids of files that arrived, which show a check.
  const [pending, setPending] = useState<Pending[]>([]), [synced, setSynced] = useState<Set<string>>(() => new Set());
  const picker = useRef<HTMLInputElement>(null);
  // Only the newest request may update the view, so a slow answer for a previous folder never shows here.
  const request = useRef(0);
  async function load(refresh = false) {
    const mine = ++request.current;
    setBusy(true);
    try { const r = await driveFolder(folderId, "", refresh); if (mine !== request.current) return; setItems(r.items); setError(""); onItems?.(r.items); }
    catch (e) { if (mine === request.current) setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); }
    finally { if (mine === request.current) setBusy(false); }
  }
  // A different folder starts fresh: its own items, from its top level.
  useEffect(() => { request.current++; setItems(null); setAt(""); setError(""); setBusy(false); setPending([]); setSynced(new Set()); }, [folderId]);
  useEffect(() => { if (connected !== false) void load(); const t = setInterval(() => { if (!document.hidden) void load(true); }, 5 * 60_000); return () => clearInterval(t); }, [folderId, connected]);
  const full = (i: DriveItem) => (i.path ? i.path + " / " : "") + i.name;
  const here = (items || []).filter((i) => (i.path || "") === at).sort((a, b) => Number(!!b.folder) - Number(!!a.folder) || a.name.localeCompare(b.name));
  const count = (path: string) => (items || []).filter((i) => !i.folder && (i.path === path || i.path?.startsWith(path + " / "))).length;
  const parts = at ? at.split(" / ") : [];
  const files = (items || []).filter((i) => !i.folder);
  const hereId = at ? (items || []).find((i) => i.folder && full(i) === at)?.id || folderId : folderId;
  const nameOf = (id: string) => id === folderId ? folderName : (items || []).find((i) => i.id === id)?.name || "Drive";
  /** Puts the files in the folder straight away, then saves them into Drive one by one; each turns into a check as it lands. */
  async function save(target: string, local: File[], mowr: string[]) {
    if (!local.length && !mowr.length) return;
    setError("");
    const batch: Pending[] = [
      ...local.map((f) => ({ key: crypto.randomUUID(), name: f.name, type: f.type, target, state: "uploading" as const })),
      ...mowr.map((id) => ({ key: "mowr:" + id + ":" + crypto.randomUUID(), name: "", type: "", target, state: "uploading" as const })),
    ];
    setPending((p) => [...p, ...batch]);
    const sources: (() => Promise<{ blob: Blob; name: string } | undefined>)[] = [
      ...local.map((f) => async () => ({ blob: f as Blob, name: f.name })),
      ...mowr.map((id) => () => onResolveFile?.(id) ?? Promise.resolve(undefined)),
    ];
    const arrived: string[] = [];
    for (let n = 0; n < batch.length; n++) {
      const key = batch[n].key;
      try {
        const file = await sources[n]();
        if (!file) { setPending((p) => p.filter((x) => x.key !== key)); continue; }
        setPending((p) => p.map((x) => x.key === key ? { ...x, name: file.name, type: file.blob.type } : x));
        const { id } = await uploadToDrive(target, file.blob, file.name);
        arrived.push(id);
        setSynced((s) => new Set(s).add(id));
        // Shown with its check right here until Drive's listing has it.
        setItems((all) => all && !all.some((i) => i.id === id) ? [...all, { id, name: file.name, mimeType: file.blob.type || "application/octet-stream", size: file.blob.size, modified: new Date().toISOString(), path: pathOf(target) }] : all);
        setPending((p) => p.filter((x) => x.key !== key));
      } catch (e) {
        const message = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") || "Google Drive did not accept the file.";
        setPending((p) => p.map((x) => x.key === key ? { ...x, state: "failed", error: message } : x));
      }
    }
    if (arrived.length) void load(true);
  }
  /** Where a Drive folder sits inside the linked folder, as the rows' `path`. */
  const pathOf = (id: string) => { if (id === folderId) return undefined; const f = (items || []).find((i) => i.id === id); return f ? full(f) : undefined; };
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("application/x-mowr-file");
  // What is dropped is read during the drop itself; the browser empties it right after.
  const dropped = (e: DragEvent) => {
    const folders = Array.from(e.dataTransfer.items || []).filter((i) => i.kind === "file" && i.webkitGetAsEntry?.()?.isDirectory).length;
    const local = Array.from(e.dataTransfer.files).filter((f, i) => !(e.dataTransfer.items?.[i]?.webkitGetAsEntry?.()?.isDirectory));
    const mowr = e.dataTransfer.getData("application/x-mowr-file");
    if (folders) setError("Folders are not copied to Drive yet; drop the files inside them.");
    return { local, mowr: mowr ? [mowr] : [] };
  };
  const target = (key: string) => ({
    onDragOver: (e: DragEvent) => { if (!accepts(e) || connected === false) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "copy"; setOver(key); },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === key ? null : o)); },
    onDrop: (e: DragEvent) => { if (!accepts(e) || connected === false) return; e.preventDefault(); e.stopPropagation(); setOver(null); const { local, mowr } = dropped(e); void save(key, local, mowr); },
  });
  return <section className={"gd-space" + (over === hereId ? " is-drop" : "")} aria-label={`Google Drive folder ${folderName}`} {...target(hereId)}>
    <header className="gd-space-head">
      <DriveLogo size={18} />
      <div><strong>{folderName}</strong><br /><small>{items ? `${files.length} file${files.length === 1 ? "" : "s"} · read live from Google Drive` : "Google Drive"}</small></div>
      <span className="gd-live" aria-description="Always up to date: nothing is downloaded">Live</span>
      <div className="gd-space-actions">
        {files.length > 0 && <button onClick={() => onAsk(files)} aria-description="Ask Mowr about this folder"><Icon name="chat" size={13} /> Ask about it</button>}
        {connected !== false && <button onClick={() => picker.current?.click()} aria-description={`Add files from this PC to ${at ? parts[parts.length - 1] : folderName} in Drive`}><Icon name="plus" size={13} /> Add files</button>}
        <input ref={picker} type="file" multiple hidden onChange={(e) => { const chosen = Array.from(e.target.files || []); e.target.value = ""; void save(hereId, chosen, []); }} />
        <button onClick={() => void load(true)} disabled={busy} aria-label="Refresh" aria-description="Refresh"><Icon name="undo" size={13} /></button>
        <button onClick={onChangeFolder}>Change</button>
        <button onClick={onUnlink}>Unlink</button>
      </div>
    </header>
    {parts.length > 0 && <nav className="gd-trail" aria-label="Folder path">
      <button className="gd-crumb" onClick={() => setAt("")}>{folderName}</button>
      {parts.map((p, i) => <span className="gd-crumb-wrap" key={i}><span className="gd-chev"><Icon name="right" size={12} /></span><button className={"gd-crumb" + (i === parts.length - 1 ? " here" : "")} onClick={() => setAt(parts.slice(0, i + 1).join(" / "))}>{p}</button></span>)}
    </nav>}
    <div className="gd-space-list">
      {connected === false && <p className="gd-space-empty">Google Drive is disconnected. Connect it in Settings → Connectors to see this folder.</p>}
      {error && <p className="gd-error">{error}</p>}
      {!items && !error && connected !== false && Array.from({ length: 4 }, (_, i) => <div key={i} className="gd-skeleton" />)}
      {pending.filter((p) => p.target === hereId).map((p) => <div key={p.key} className={"gd-row is-pending" + (p.state === "failed" ? " is-failed" : "")}>
        <span className="gd-open">
          <span className="gd-thumb"><DriveIcon mime={p.type || "application/octet-stream"} name={p.name} size={26} /></span>
          <span className="gd-name"><strong>{p.name || "Mowr file"}</strong><small>{p.state === "failed" ? p.error : "Uploading to Drive…"}</small></span>
          {p.state === "uploading" ? <span className="gd-sync is-uploading" role="img" aria-label="Uploading" /> : <span className="gd-sync is-failed" role="img" aria-label="Not saved">!</span>}
        </span>
        {p.state === "failed" && <button className="gd-link-folder" onClick={() => setPending((all) => all.filter((x) => x.key !== p.key))}>Dismiss</button>}
      </div>)}
      {here.map((i) => <div key={i.id} className={"gd-row" + (i.folder ? " is-folder" : "") + (over === i.id ? " is-drop" : "")} {...(i.folder ? target(i.id) : {})}>
        <button className="gd-open" onClick={() => (i.folder ? setAt(full(i)) : onOpen(i))} aria-description={i.name}>
          <span className="gd-thumb">{i.thumbnail && /^(image|video)\//.test(i.mimeType) ? <img src={"/api/drive/thumb/" + i.id} alt="" loading="lazy" /> : <DriveIcon mime={i.mimeType} name={i.name} size={26} />}</span>
          <span className="gd-name"><strong>{i.name}</strong><small>{i.folder ? `${count(full(i))} file${count(full(i)) === 1 ? "" : "s"}` : [kindName(i.mimeType, i.name), ago(i.modified)].filter(Boolean).join(" · ")}</small></span>
          {i.folder && pending.some((p) => p.state === "uploading" && p.target === i.id) && <span className="gd-sync is-uploading" role="img" aria-label="Uploading into this folder" />}
          {synced.has(i.id) && <span className="gd-sync is-done" role="img" aria-label="In sync with Google Drive"><Icon name="check" size={12} /></span>}
        </button>
        {!i.folder && <button className="gd-link-folder" onClick={() => onAsk([i])}>Ask</button>}
      </div>)}
      {items && !here.length && !pending.some((p) => p.target === hereId) && <p className="gd-space-empty">This folder is empty in Drive. Drop files here to save them to it.</p>}
    </div>
  </section>;
}
