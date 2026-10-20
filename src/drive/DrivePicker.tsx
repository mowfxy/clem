import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icons";
import { DriveLogo } from "../BrandLogos";
import { desktop } from "../desktop/bridge";
import { confirmDialog } from "../dialogs";
import { DriveIcon, kindName } from "./DriveIcon";
import { connectDrive, disconnectDrive, driveError, listDrive, pickFromDrive, refreshDrive, useDrive, type DriveItem } from "./drive";
import "./drive.css";

const FOLDER = "application/vnd.google-apps.folder";
const when = (iso?: string) => { if (!iso) return ""; const d = new Date(iso); return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }); };
const bytes = (n?: number) => !n ? "" : n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + " KB" : n < 1024 ** 3 ? (n / 1024 / 1024).toFixed(1).replace(/\.0$/, "") + " MB" : (n / 1024 ** 3).toFixed(1) + " GB";
const hasPreview = (f: DriveItem) => !!f.thumbnail && /^(image|video)\//.test(f.mimeType);

/**
 * Google Drive, live, as far as Clem can see it: the files and folders picked in Google's own picker and the files Clem
 * made. "Choose in Google Drive" opens that picker to add more. In "files" mode, pick files to use in a chat (they are
 * read from Drive when needed, never copied). In "folder" mode, link a folder to a subject or project.
 */
export function DrivePicker({ mode = "files", onFiles, onFolder, confirmLabel }: { mode?: "files" | "folder"; onFiles?: (files: DriveItem[]) => void; onFolder?: (folder: { id: string; name: string }) => void; confirmLabel?: string }) {
  const { connected } = useDrive();
  const [choosing, setChoosing] = useState(false);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState(""), [search, setSearch] = useState("");
  const [items, setItems] = useState<DriveItem[]>([]), [next, setNext] = useState<string>();
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [picked, setPicked] = useState<Map<string, DriveItem>>(new Map());
  const [grid, setGrid] = useState(() => { try { return localStorage.getItem("clem-drive-grid") === "1"; } catch { return false; } });
  const [waiting, setWaiting] = useState(false);
  const version = useRef(0);
  const folder = trail.at(-1)?.id || "root";
  useEffect(() => { const t = setTimeout(() => setSearch(query.trim()), 280); return () => clearTimeout(t); }, [query]);
  async function load(page?: string) {
    if (!desktop) { setBusy(false); setError("Google Drive works in the Clem desktop app."); return; }
    const v = ++version.current;
    setBusy(true); setError("");
    try {
      const r = await listDrive({ folder: search ? undefined : folder, query: search || undefined, page, kind: mode === "folder" && search ? "folders" : "all" });
      if (v !== version.current) return;
      setItems((all) => (page ? [...all, ...r.files] : r.files)); setNext(r.next);
    } catch (e) { if (v === version.current) setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")); }
    finally { if (v === version.current) setBusy(false); }
  }
  useEffect(() => { if (connected !== false) void load(); }, [folder, search, connected]);
  useEffect(() => { if (connected) setWaiting(false); }, [connected]);
  // One click opens a folder, so a double-click's second click must not open it again inside itself.
  const open = (f: DriveItem) => { setQuery(""); setSearch(""); setTrail((t) => t.at(-1)?.id === f.id ? t : [...t, { id: f.id, name: f.name }]); };
  const up = (index: number) => { setTrail((t) => t.slice(0, index)); setQuery(""); setSearch(""); };
  const toggle = (f: DriveItem) => setPicked((all) => { const copy = new Map(all); if (copy.has(f.id)) copy.delete(f.id); else if (copy.size < 10) copy.set(f.id, f); return copy; });
  const shown = useMemo(() => mode === "folder" ? [...items].sort((a, b) => Number(b.mimeType === FOLDER) - Number(a.mimeType === FOLDER)) : items, [items, mode]);
  const here = trail.at(-1);
  // Google's picker opens in the browser; what comes back is used straight away, as if picked here.
  async function choose() {
    setChoosing(true); setError("");
    try {
      const got = await pickFromDrive(mode === "folder" ? "folder" : "files");
      if (mode === "folder") { const f = got.find((g) => g.mimeType === FOLDER); if (f) onFolder?.({ id: f.id, name: f.name }); }
      else if (got.some((g) => g.mimeType !== FOLDER)) onFiles?.(got.filter((g) => g.mimeType !== FOLDER));
      else void load();
    } catch (e) { setError(driveError(e)); }
    finally { setChoosing(false); }
  }
  const chooseLabel = choosing ? "Finish in your browser…" : mode === "folder" ? "Choose a folder in Google Drive" : "Choose in Google Drive";

  if (connected === false) return <div className="gd-picker gd-connect">
    <div className="gd-hero" aria-hidden="true"><span className="gd-hero-tile"><DriveLogo size={34} /></span></div>
    <h3>Connect Google Drive</h3>
    <p>Use Drive files in chats and link folders to subjects and projects. Files are read live from Drive, never copied to this PC.</p>
    <ul>
      <li><Icon name="check" size={14} />Opens only the files and folders you choose in Google Drive</li>
      <li><Icon name="check" size={14} />Saves files you add, and Clem's files, into folders you link</li>
      <li><Icon name="check" size={14} />Videos play straight from Drive</li>
      <li><Icon name="check" size={14} />Disconnect anytime</li>
    </ul>
    <button className="gd-google" disabled={waiting} onClick={() => { setWaiting(true); void connectDrive().catch((e) => { setWaiting(false); setError(e.message); }); }}>
      <GoogleG />{waiting ? "Finish in your browser — Clem will notice" : "Continue with Google"}
    </button>
    {waiting && <button className="gd-link" onClick={() => void refreshDrive(true)}>I've connected it</button>}
    {error && <p className="gd-error">{error}</p>}
  </div>;

  return <div className={"gd-picker" + (grid ? " is-grid" : "")}>
    <div className="gd-top">
      <button className="gd-choose" disabled={choosing} onClick={() => void choose()}><DriveLogo size={14} />{chooseLabel}</button>
      <label className="gd-search"><Icon name="research" size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={mode === "folder" ? "Search folders" : "Search chosen files"} aria-label="Search Google Drive" />{query && <button aria-label="Clear search" onClick={() => setQuery("")}><Icon name="close" size={12} /></button>}</label>
      <button className="gd-view" aria-label={grid ? "List view" : "Grid view"} aria-description={grid ? "List view" : "Grid view"} onClick={() => { const g = !grid; setGrid(g); try { localStorage.setItem("clem-drive-grid", g ? "1" : "0"); } catch {} }}>{grid ? <ListGlyph /> : <GridGlyph />}</button>
    </div>
    <nav className="gd-trail" aria-label="Folder path">
      {search ? <span className="gd-crumb here">Results for “{search}”</span> : <>
        <button className={"gd-crumb" + (trail.length ? "" : " here")} onClick={() => up(0)}>Opened with Clem</button>
        {trail.map((t, i) => <span key={t.id} className="gd-crumb-wrap"><Chevron /><button className={"gd-crumb" + (i === trail.length - 1 ? " here" : "")} onClick={() => up(i + 1)}>{t.name}</button></span>)}
      </>}
      <button className="gd-refresh" aria-label="Refresh" aria-description="Refresh" disabled={busy} onClick={() => void load()}><Icon name="undo" size={13} /></button>
    </nav>
    <div className={"gd-list" + (busy && items.length ? " is-loading" : "")} role="list">
      {shown.map((f) => {
        const isFolder = f.mimeType === FOLDER, chosen = picked.has(f.id), muted = mode === "folder" && !isFolder;
        const click = () => isFolder ? open(f) : mode === "files" ? toggle(f) : undefined;
        return <div role="listitem" key={f.id} className={"gd-row" + (isFolder ? " is-folder" : "") + (chosen ? " is-picked" : "") + (muted ? " is-muted" : "")}>
          <button className="gd-open" disabled={muted} onClick={click} onDoubleClick={() => { if (!isFolder && mode === "files") onFiles?.([f]); }} aria-description={f.name}>
            <span className="gd-thumb">{(grid ? f.thumbnail : hasPreview(f)) ? <Thumb id={f.id} mime={f.mimeType} name={f.name} /> : <DriveIcon mime={f.mimeType} name={f.name} size={grid ? 44 : 26} />}{f.mimeType.startsWith("video/") && <span className="gd-play" aria-hidden="true"><Icon name="playhead" size={11} /></span>}</span>
            <span className="gd-name"><strong>{f.name}</strong><small>{[kindName(f.mimeType, f.name), when(f.modified), bytes(f.size)].filter(Boolean).join(" · ")}</small></span>
            {mode === "files" && !isFolder && <span className={"gd-check" + (chosen ? " on" : "")} aria-hidden="true">{chosen && <Icon name="check" size={12} />}</span>}
            {isFolder && <Chevron />}
          </button>
          {mode === "folder" && isFolder && <button className="gd-link-folder" onClick={() => onFolder?.({ id: f.id, name: f.name })}>Link</button>}
        </div>;
      })}
      {busy && !items.length && Array.from({ length: 7 }, (_, i) => <div key={i} className="gd-skeleton" style={{ animationDelay: i * 60 + "ms" }} />)}
      {!busy && !error && !items.length && <div className="gd-empty"><DriveIcon mime={FOLDER} size={40} />
        <strong>{search ? "Nothing matches" : here ? "Nothing here Clem can open" : "Nothing from your Drive yet"}</strong>
        <small>{search ? "Clem searches only what you've chosen. Try other words." : here ? (mode === "folder" ? "You can still link it." : "Choose its files in Google Drive to use them.") : mode === "folder" ? "Choose a folder in Google Drive to link it." : "Choose files in Google Drive to use them here."}</small>
        {!search && <button className="gd-choose" disabled={choosing} onClick={() => void choose()}><DriveLogo size={14} />{chooseLabel}</button>}</div>}
      {next && !busy && <button className="gd-more" onClick={() => void load(next)}>Show more</button>}
    </div>
    {error && <p className="gd-error" role="alert">{error}</p>}
    <footer className="gd-foot">
      <button className="gd-disconnect" onClick={() => void confirmDialog({ title: "Disconnect Google Drive?", message: "Clem stops reading your Drive and loses access to the files you chose. Nothing in your Drive changes.", confirm: "Disconnect" }).then((yes) => { if (yes) return disconnectDrive(); }).catch((e) => setError(e.message))}>Disconnect</button>
      {mode === "files"
        ? <><span className="gd-count">{picked.size ? `${picked.size} selected` : "Select files, or double-click one"}</span><button className="primary" disabled={!picked.size} onClick={() => onFiles?.([...picked.values()])}>{confirmLabel || "Add to chat"}</button></>
        : <><span className="gd-count">{here ? <>Open folders to go deeper, or link one with <b>Link</b></> : "Open a folder, or link one with Link"}</span><button className="primary" disabled={!here} onClick={() => here && onFolder?.(here)}>{here ? `Link “${here.name.length > 24 ? here.name.slice(0, 23) + "…" : here.name}”` : "Link this folder"}</button></>}
    </footer>
  </div>;
}

function Thumb({ id, mime, name }: { id: string; mime: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <DriveIcon mime={mime} name={name} size={26} /> : <img src={"/api/drive/thumb/" + id} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}
const Chevron = () => <span className="gd-chev"><Icon name="right" size={12} /></span>;
const GridGlyph = () => <Icon name="grid" size={15} />;
const ListGlyph = () => <Icon name="list" size={15} />;
function GoogleG() {
  return <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" /><path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-10l-8 6.1C6.6 42.6 14.6 48 24 48z" /></svg>;
}
