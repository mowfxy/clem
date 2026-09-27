import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icons";
import { DriveLogo } from "../BrandLogos";
import { DriveIcon, kindName } from "./DriveIcon";
import { driveFolder, useDrive, type DriveItem } from "./drive";
import "./drive.css";

const ago = (iso?: string) => { if (!iso) return ""; const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000); return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 7 ? `${d} days ago` : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }); };

/**
 * A Drive folder linked to a subject or project, read live from Google each time it is shown (and every few
 * minutes while open). Subfolders open in place; files open in Mowr's viewer or play, streamed, never copied.
 */
export function DriveFolderView({ folderId, folderName, onOpen, onAsk, onChangeFolder, onUnlink, onItems }: {
  folderId: string; folderName: string; onOpen: (file: DriveItem) => void; onAsk: (files: DriveItem[]) => void;
  onChangeFolder: () => void; onUnlink: () => void; onItems?: (items: DriveItem[]) => void;
}) {
  const { connected } = useDrive();
  const [items, setItems] = useState<DriveItem[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [at, setAt] = useState("");
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
  return <section className="gd-space" aria-label={`Google Drive folder ${folderName}`}>
    <header className="gd-space-head">
      <DriveLogo size={18} />
      <div><strong>{folderName}</strong><br /><small>{items ? `${files.length} file${files.length === 1 ? "" : "s"} · read live from Google Drive` : "Google Drive"}</small></div>
      <span className="gd-live" title="Always up to date: nothing is downloaded">Live</span>
      <div className="gd-space-actions">
        {files.length > 0 && <button onClick={() => onAsk(files)} title="Ask Mowr about this folder"><Icon name="chat" size={13} /> Ask about it</button>}
        <button onClick={() => void load(true)} disabled={busy} aria-label="Refresh" title="Refresh"><Icon name="undo" size={13} /></button>
        <button onClick={onChangeFolder}>Change</button>
        <button onClick={onUnlink}>Unlink</button>
      </div>
    </header>
    {parts.length > 0 && <nav className="gd-trail" aria-label="Folder path">
      <button className="gd-crumb" onClick={() => setAt("")}>{folderName}</button>
      {parts.map((p, i) => <span className="gd-crumb-wrap" key={i}><svg className="gd-chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg><button className={"gd-crumb" + (i === parts.length - 1 ? " here" : "")} onClick={() => setAt(parts.slice(0, i + 1).join(" / "))}>{p}</button></span>)}
    </nav>}
    <div className="gd-space-list">
      {connected === false && <p className="gd-space-empty">Google Drive is disconnected. Connect it in Settings → Connectors to see this folder.</p>}
      {error && <p className="gd-error">{error}</p>}
      {!items && !error && connected !== false && Array.from({ length: 4 }, (_, i) => <div key={i} className="gd-skeleton" />)}
      {here.map((i) => <div key={i.id} className={"gd-row" + (i.folder ? " is-folder" : "")}>
        <button className="gd-open" onClick={() => (i.folder ? setAt(full(i)) : onOpen(i))} title={i.name}>
          <span className="gd-thumb">{i.thumbnail && /^(image|video)\//.test(i.mimeType) ? <img src={"/api/drive/thumb/" + i.id} alt="" loading="lazy" /> : <DriveIcon mime={i.mimeType} name={i.name} size={26} />}</span>
          <span className="gd-name"><strong>{i.name}</strong><small>{i.folder ? `${count(full(i))} file${count(full(i)) === 1 ? "" : "s"}` : [kindName(i.mimeType, i.name), ago(i.modified)].filter(Boolean).join(" · ")}</small></span>
        </button>
        {!i.folder && <button className="gd-link-folder" onClick={() => onAsk([i])}>Ask</button>}
      </div>)}
      {items && !here.length && <p className="gd-space-empty">This folder is empty in Drive.</p>}
    </div>
  </section>;
}
