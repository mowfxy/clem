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
 * Files dropped on it (from this PC or from Mowr's own files) are saved straight into Drive, into the folder they land on.
 */
export function DriveFolderView({ folderId, folderName, onOpen, onAsk, onChangeFolder, onUnlink, onItems, onResolveFile }: {
  folderId: string; folderName: string; onOpen: (file: DriveItem) => void; onAsk: (files: DriveItem[]) => void;
  onChangeFolder: () => void; onUnlink: () => void; onItems?: (items: DriveItem[]) => void;
  /** The bytes of a Mowr file dragged here, so it can be saved into Drive too. */
  onResolveFile?: (id: string) => Promise<{ blob: Blob; name: string } | undefined>;
}) {
  const { connected } = useDrive();
  const [items, setItems] = useState<DriveItem[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [at, setAt] = useState("");
  const [over, setOver] = useState<string | null>(null), [saving, setSaving] = useState(""), [saved, setSaved] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!saved) return; const t = setTimeout(() => setSaved(""), 6000); return () => clearTimeout(t); }, [saved]);
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
  useEffect(() => { request.current++; setItems(null); setAt(""); setError(""); setBusy(false); }, [folderId]);
  useEffect(() => { if (connected !== false) void load(); const t = setInterval(() => { if (!document.hidden) void load(true); }, 5 * 60_000); return () => clearInterval(t); }, [folderId, connected]);
  const full = (i: DriveItem) => (i.path ? i.path + " / " : "") + i.name;
  const here = (items || []).filter((i) => (i.path || "") === at).sort((a, b) => Number(!!b.folder) - Number(!!a.folder) || a.name.localeCompare(b.name));
  const count = (path: string) => (items || []).filter((i) => !i.folder && (i.path === path || i.path?.startsWith(path + " / "))).length;
  const parts = at ? at.split(" / ") : [];
  const files = (items || []).filter((i) => !i.folder);
  const hereId = at ? (items || []).find((i) => i.folder && full(i) === at)?.id || folderId : folderId;
  const nameOf = (id: string) => id === folderId ? folderName : (items || []).find((i) => i.id === id)?.name || "Drive";
  /** Saves files into a Drive folder one by one, then reads the folder again so they show. */
  async function save(target: string, local: File[], mowr: string[]) {
    const total = local.length + mowr.length;
    if (!total) return;
    setSaved(""); setError("");
    let done = 0;
    try {
      for (const file of local) { setSaving(`Saving ${total === 1 ? file.name : `${done + 1} of ${total}`} to ${nameOf(target)}…`); await uploadToDrive(target, file, file.name); done++; }
      for (const id of mowr) {
        const file = await onResolveFile?.(id);
        if (!file) continue;
        setSaving(`Saving ${total === 1 ? file.name : `${done + 1} of ${total}`} to ${nameOf(target)}…`);
        await uploadToDrive(target, file.blob, file.name); done++;
      }
      setSaved(done === 1 ? `Saved to ${nameOf(target)} in Drive.` : `${done} files saved to ${nameOf(target)} in Drive.`);
    } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") || "Google Drive did not accept the file."); }
    finally { setSaving(""); void load(true); }
  }
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("application/x-mowr-file");
  // What is dropped is read during the drop itself; the browser empties it right after.
  const dropped = (e: DragEvent) => {
    const folders = Array.from(e.dataTransfer.items || []).filter((i) => i.kind === "file" && i.webkitGetAsEntry?.()?.isDirectory).length;
    const local = Array.from(e.dataTransfer.files).filter((f, i) => !(e.dataTransfer.items?.[i]?.webkitGetAsEntry?.()?.isDirectory));
    const mowr = e.dataTransfer.getData("application/x-mowr-file");
    if (folders && !local.length) setError("Drop the files inside the folder; whole folders are not copied to Drive.");
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
        {connected !== false && <button onClick={() => picker.current?.click()} disabled={!!saving} aria-description={`Add files from this PC to ${at ? parts[parts.length - 1] : folderName} in Drive`}><Icon name="plus" size={13} /> Add files</button>}
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
      {(saving || saved) && <p className="gd-saving" role="status">{saving || saved}</p>}
      {!items && !error && connected !== false && Array.from({ length: 4 }, (_, i) => <div key={i} className="gd-skeleton" />)}
      {here.map((i) => <div key={i.id} className={"gd-row" + (i.folder ? " is-folder" : "") + (over === i.id ? " is-drop" : "")} {...(i.folder ? target(i.id) : {})}>
        <button className="gd-open" onClick={() => (i.folder ? setAt(full(i)) : onOpen(i))} aria-description={i.name}>
          <span className="gd-thumb">{i.thumbnail && /^(image|video)\//.test(i.mimeType) ? <img src={"/api/drive/thumb/" + i.id} alt="" loading="lazy" /> : <DriveIcon mime={i.mimeType} name={i.name} size={26} />}</span>
          <span className="gd-name"><strong>{i.name}</strong><small>{i.folder ? `${count(full(i))} file${count(full(i)) === 1 ? "" : "s"}` : [kindName(i.mimeType, i.name), ago(i.modified)].filter(Boolean).join(" · ")}</small></span>
        </button>
        {!i.folder && <button className="gd-link-folder" onClick={() => onAsk([i])}>Ask</button>}
      </div>)}
      {items && !here.length && <p className="gd-space-empty">This folder is empty in Drive. Drop files here to save them to it.</p>}
    </div>
  </section>;
}
