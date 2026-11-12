import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icons";
import { DriveLogo } from "../BrandLogos";
import { desktop } from "../desktop/bridge";
import { DriveIcon, kindName } from "./DriveIcon";
import { connectDrive, driveError, listDrive, pickFromDrive, refreshDrive, stopPicking, useDrive, type DriveItem } from "./drive";
import "./drive.css";

const FOLDER = "application/vnd.google-apps.folder";
export const when = (iso?: string) => { if (!iso) return ""; const d = new Date(iso); return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }); };
const bytes = (n?: number) => !n ? "" : n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + " KB" : n < 1024 ** 3 ? (n / 1024 / 1024).toFixed(1).replace(/\.0$/, "") + " MB" : (n / 1024 ** 3).toFixed(1) + " GB";
const hasPreview = (f: DriveItem) => !!f.thumbnail && /^(image|video)\//.test(f.mimeType);

/**
 * Google Drive, live, as far as Clem can open it: the files and folders chosen in Google's own picker and the files Clem
 * made. "Choose in Google Drive" opens that picker to add more. In "files" mode, pick files to use in a chat (they are
 * read from Drive when needed, never copied). In "folder" mode, link a folder to a subject or project.
 */
export function DrivePicker({ mode = "files", onFiles, onFolder, confirmLabel, onManage }: { mode?: "files" | "folder"; onFiles?: (files: DriveItem[]) => void; onFolder?: (folder: { id: string; name: string }) => void; confirmLabel?: string; onManage?: () => void }) {
  const { connected, version } = useDrive();
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState(""), [search, setSearch] = useState("");
  const [items, setItems] = useState<DriveItem[]>([]), [next, setNext] = useState<string>();
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [picked, setPicked] = useState<Map<string, DriveItem>>(new Map());
  const [grid, setGrid] = useState(() => { try { return localStorage.getItem("clem-drive-grid") === "1"; } catch { return false; } });
  const [choosing, setChoosing] = useState(false);
  const version$ = useRef(0);
  const folder = trail.at(-1)?.id || "access";
  useEffect(() => { const t = setTimeout(() => setSearch(query.trim()), 280); return () => clearTimeout(t); }, [query]);
  async function load(page?: string) {
    if (!desktop) { setBusy(false); setError("Google Drive works in the Clem desktop app."); return; }
    const v = ++version$.current;
    setBusy(true); setError("");
    try {
      const r = await listDrive({ folder: search ? undefined : folder, query: search || undefined, page, kind: mode === "folder" && search ? "folders" : "all" });
      if (v !== version$.current) return;
      setItems((all) => (page ? [...all, ...r.files] : r.files)); setNext(r.next);
    } catch (e) { if (v === version$.current) setError(driveError(e)); }
    finally { if (v === version$.current) setBusy(false); }
  }
  useEffect(() => { if (connected) void load(); }, [folder, search, connected, version]);
  useEffect(() => () => stopPicking(), []);
  // One click opens a folder, so a double-click's second click must not open it again inside itself.
  const open = (f: DriveItem) => { setQuery(""); setSearch(""); setTrail((t) => t.at(-1)?.id === f.id ? t : [...t, { id: f.id, name: f.name }]); };
  const up = (index: number) => { setTrail((t) => t.slice(0, index)); setQuery(""); setSearch(""); };
  const toggle = (f: DriveItem) => setPicked((all) => { const copy = new Map(all); if (copy.has(f.id)) copy.delete(f.id); else if (copy.size < 10) copy.set(f.id, f); return copy; });
  const shown = useMemo(() => mode === "folder" ? [...items].sort((a, b) => Number(b.mimeType === FOLDER) - Number(a.mimeType === FOLDER)) : items, [items, mode]);
  const here = trail.at(-1);
  // Google's picker opens in the browser; what comes back is ready here at once: files selected, a folder linked.
  async function choose() {
    setChoosing(true); setError("");
    try {
      const got = await pickFromDrive("files");
      const folders = got.filter((g) => g.mimeType === FOLDER), files = got.filter((g) => g.mimeType !== FOLDER);
      if (mode === "folder" && folders.length === 1 && !files.length) onFolder?.({ id: folders[0].id, name: folders[0].name });
      else if (mode === "files" && files.length) setPicked((all) => { const copy = new Map(all); for (const f of files) if (copy.size < 10) copy.set(f.id, f); return copy; });
    } catch (e) { setError(driveError(e)); }
    finally { setChoosing(false); }
  }

  if (connected === false) return <DriveConnect />;

  return <div className={"gd-picker" + (grid ? " is-grid" : "")}>
    <div className="gd-top">
      <label className="gd-search"><Icon name="research" size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={mode === "folder" ? "Search folders shared with Clem" : "Search files shared with Clem"} aria-label="Search Google Drive" />{query && <button aria-label="Clear search" onClick={() => setQuery("")}><Icon name="close" size={12} /></button>}</label>
      <button className="gd-choose" disabled={choosing} onClick={() => void choose()}><DriveLogo size={14} />{choosing ? "Finish in your browser…" : "Choose in Google Drive"}</button>
      <button className="gd-view" aria-label={grid ? "List view" : "Grid view"} aria-description={grid ? "List view" : "Grid view"} onClick={() => { const g = !grid; setGrid(g); try { localStorage.setItem("clem-drive-grid", g ? "1" : "0"); } catch {} }}>{grid ? <Icon name="list" size={15} /> : <Icon name="grid" size={15} />}</button>
    </div>
    {choosing && <ChoosingNote onCancel={() => { stopPicking(); setChoosing(false); }} />}
    <nav className="gd-trail" aria-label="Folder path">
      {search ? <span className="gd-crumb here">Results for “{search}”</span> : <>
        <button className={"gd-crumb" + (trail.length ? "" : " here")} onClick={() => up(0)}>Shared with Clem</button>
        {trail.map((t, i) => <span key={t.id} className="gd-crumb-wrap"><Chevron /><button className={"gd-crumb" + (i === trail.length - 1 ? " here" : "")} onClick={() => up(i + 1)}>{t.name}</button></span>)}
      </>}
      <button className="gd-refresh" aria-label="Refresh" aria-description="Refresh" disabled={busy} onClick={() => void load()}><Icon name="undo" size={13} /></button>
    </nav>
    <div className={"gd-list" + (busy && items.length ? " is-loading" : "")} role="list">
      {shown.map((f) => {
        const isFolder = f.mimeType === FOLDER, chosen = picked.has(f.id), muted = mode === "folder" && !isFolder;
        const click = () => isFolder ? open(f) : mode === "files" ? toggle(f) : undefined;
        const meta = isFolder && !trail.length && !search && f.inside !== undefined ? (f.inside ? `${f.inside} item${f.inside === 1 ? "" : "s"} inside` : "Only the folder · choose its files too") : [kindName(f.mimeType, f.name), when(f.modified), bytes(f.size)].filter(Boolean).join(" · ");
        return <div role="listitem" key={f.id} className={"gd-row" + (isFolder ? " is-folder" : "") + (chosen ? " is-picked" : "") + (muted ? " is-muted" : "")}>
          <button className="gd-open" disabled={muted} onClick={click} onDoubleClick={() => { if (!isFolder && mode === "files") onFiles?.([f]); }} aria-description={f.name}>
            <span className="gd-thumb">{(grid ? f.thumbnail : hasPreview(f)) ? <Thumb id={f.id} mime={f.mimeType} name={f.name} /> : <DriveIcon mime={f.mimeType} name={f.name} size={grid ? 44 : 26} />}{f.mimeType.startsWith("video/") && <span className="gd-play" aria-hidden="true"><Icon name="playhead" size={11} /></span>}</span>
            <span className="gd-name"><strong>{f.name}</strong><small>{meta}</small></span>
            {mode === "files" && !isFolder && <span className={"gd-check" + (chosen ? " on" : "")} aria-hidden="true">{chosen && <Icon name="check" size={12} />}</span>}
            {isFolder && <Chevron />}
          </button>
          {mode === "folder" && isFolder && <button className="gd-link-folder" onClick={() => onFolder?.({ id: f.id, name: f.name })}>Link</button>}
        </div>;
      })}
      {busy && !items.length && Array.from({ length: 7 }, (_, i) => <div key={i} className="gd-skeleton" style={{ animationDelay: i * 60 + "ms" }} />)}
      {!busy && !error && !items.length && <div className="gd-empty">
        <DriveIcon mime={FOLDER} size={40} />
        <strong>{search ? "Nothing matches" : here ? "Nothing in this folder is shared with Clem" : "Nothing shared with Clem yet"}</strong>
        <small>{search ? "Clem searches only what you chose in Google Drive." : here ? (mode === "folder" ? "You can still link it, then choose its files in Google Drive." : "Choose its files in Google Drive: open the folder there and select them.") : "Choose files and folders in Google Drive. Select a folder's files with it so Clem can open them."}</small>
        {!search && <button className="gd-choose" disabled={choosing} onClick={() => void choose()}><DriveLogo size={14} />{choosing ? "Finish in your browser…" : "Choose in Google Drive"}</button>}
      </div>}
      {next && !busy && <button className="gd-more" onClick={() => void load(next)}>Show more</button>}
    </div>
    {error && <p className="gd-error" role="alert">{error}{/^(Reconnect Google Drive|Clem now opens only)/.test(error) && <> <button className="gd-retry" onClick={() => void choose()}>Reconnect</button></>} <button className="gd-retry" onClick={() => void load()}>Try again</button></p>}
    <footer className="gd-foot">
      {onManage && <button className="gd-disconnect" onClick={onManage}>Manage access</button>}
      {mode === "files"
        ? <><span className="gd-count">{picked.size ? `${picked.size} selected` : "Select files, or double-click one"}</span><button className="primary" disabled={!picked.size} onClick={() => onFiles?.([...picked.values()])}>{confirmLabel || "Add to chat"}</button></>
        : <><span className="gd-count">{here ? <>Open folders to go deeper, or link one with <b>Link</b></> : "Open a folder, or link one with Link"}</span><button className="primary" disabled={!here} onClick={() => here && onFolder?.(here)}>{here ? `Link “${here.name.length > 24 ? here.name.slice(0, 23) + "…" : here.name}”` : "Link this folder"}</button></>}
    </footer>
  </div>;
}

/** Not connected yet: "Continue with Google" connects and opens Google's picker in one step. */
export function DriveConnect() {
  const [waiting, setWaiting] = useState(false), [error, setError] = useState("");
  // A connection finished in the browser after this was last closed shows up as soon as it opens again.
  useEffect(() => { void refreshDrive(true); return () => stopPicking(); }, []);
  return <div className="gd-picker gd-connect">
    <div className="gd-hero" aria-hidden="true"><span className="gd-hero-tile"><DriveLogo size={34} /></span></div>
    <h3>Connect Google Drive</h3>
    <p>Use Drive files in chats and link folders to subjects and projects. Files are read live from Drive, never copied to this PC.</p>
    <ul>
      <li><Icon name="check" size={14} />Opens only the files and folders you choose in Google Drive</li>
      <li><Icon name="check" size={14} />Select a folder's files with it, and Clem sees them inside it</li>
      <li><Icon name="check" size={14} />Saves files you add, and Clem's files, into folders you choose</li>
      <li><Icon name="check" size={14} />Change what Clem can open, or disconnect, anytime</li>
    </ul>
    <button className="gd-google" disabled={waiting} onClick={() => { setWaiting(true); setError(""); void connectDrive().catch((e) => setError(driveError(e))).finally(() => setWaiting(false)); }}>
      <GoogleG />{waiting ? "Finish in your browser — Clem will notice" : "Continue with Google"}
    </button>
    {waiting && <button className="gd-link" onClick={() => { stopPicking(); setWaiting(false); void refreshDrive(true); }}>I've finished, or closed it</button>}
    {error && <p className="gd-error">{error}</p>}
  </div>;
}

/** While Google's picker is open in the browser: how to give Clem a folder's files, since Google shares a folder alone. */
export function ChoosingNote({ onCancel }: { onCancel: () => void }) {
  return <div className="gd-choosing" role="status">
    <span className="gd-choosing-ring" aria-hidden="true" />
    <span><b>Choose in your browser.</b> To give Clem a folder's files, open the folder in Google's window and select them too (Ctrl+A selects everything there), then Select.</span>
    <button onClick={onCancel}>Cancel</button>
  </div>;
}

export function Thumb({ id, mime, name }: { id: string; mime: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <DriveIcon mime={mime} name={name} size={26} /> : <img src={"/api/drive/thumb/" + id} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}
export const Chevron = () => <span className="gd-chev"><Icon name="right" size={12} /></span>;
function GoogleG() {
  return <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" /><path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-10l-8 6.1C6.6 42.6 14.6 48 24 48z" /></svg>;
}
