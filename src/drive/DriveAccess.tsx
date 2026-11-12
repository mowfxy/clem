import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icons";
import { DriveLogo } from "../BrandLogos";
import { desktop } from "../desktop/bridge";
import { confirmDialog } from "../dialogs";
import { DriveIcon, kindName } from "./DriveIcon";
import { Chevron, ChoosingNote, DriveConnect, Thumb, when } from "./DrivePicker";
import { disconnectDrive, driveError, listDrive, pickFromDrive, setDriveAccess, stopPicking, useDrive, type DriveItem } from "./drive";
import "./drive.css";

const FOLDER = "application/vnd.google-apps.folder";
const hasPreview = (f: DriveItem) => !!f.thumbnail && /^(image|video)\//.test(f.mimeType);

/**
 * Settings → Connectors → Google Drive → Manage: what Clem can open in Drive, exactly. Clem asks Google only for the
 * files and folders chosen in Google's own picker (and the files it makes), so this is the whole of Clem's access.
 * Choose more opens that picker; Remove takes an item (and what is inside it) out of Clem's reach.
 */
export function DriveAccess({ onDone }: { onDone?: () => void }) {
  const { connected, version } = useDrive();
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<DriveItem[] | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [removed, setRemoved] = useState<DriveItem | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const run = useRef(0);
  const here = trail.at(-1);

  async function load() {
    if (!desktop) { setBusy(false); setError("Google Drive works in the Clem desktop app."); return; }
    const mine = ++run.current;
    setBusy(true); setError("");
    try {
      const all: DriveItem[] = [];
      let page: string | undefined;
      // Inside a folder, every page at once: what Clem can open there is short, and Remove needs to see it all.
      do { const r = await listDrive({ folder: here?.id || "access", page }); if (mine !== run.current) return; all.push(...r.files); page = r.next; } while (page && all.length < 1000);
      setItems(all);
    } catch (e) { if (mine === run.current) setError(driveError(e)); }
    finally { if (mine === run.current) setBusy(false); }
  }
  useEffect(() => { if (connected) void load(); }, [connected, here?.id, version]);
  useEffect(() => () => stopPicking(), []);

  async function choose() {
    setChoosing(true); setError(""); setRemoved(null);
    try {
      const got = await pickFromDrive("files");
      if (got.length) { setFresh(new Set(got.map((g) => g.id))); setTimeout(() => setFresh(new Set()), 2600); }
    } catch (e) { setError(driveError(e)); }
    finally { setChoosing(false); }
  }
  async function remove(f: DriveItem) {
    setError("");
    try { await setDriveAccess({ hide: [f.id] }); setRemoved(f); }
    catch (e) { setError(driveError(e)); }
  }
  async function undo() {
    const f = removed; if (!f) return;
    setRemoved(null);
    try { await setDriveAccess({ show: [f.id] }); } catch (e) { setError(driveError(e)); }
  }

  if (connected === false) return <DriveConnect />;

  const folders = (items || []).filter((f) => f.mimeType === FOLDER).length, files = (items || []).length - folders;
  const total = !items ? "" : !items.length ? "Nothing yet" : [folders && `${folders} folder${folders === 1 ? "" : "s"}`, files && `${files} file${files === 1 ? "" : "s"}`].filter(Boolean).join(" · ");

  return <div className="gd-picker gd-access">
    <div className="gd-access-intro">
      <span className="gd-access-mark" aria-hidden="true"><DriveLogo size={18} /></span>
      <p>Clem opens only what you choose in Google Drive, and the files it makes. Nothing else in your Drive.</p>
      <button className="gd-choose" disabled={choosing} onClick={() => void choose()}><Icon name="plus" size={13} />{choosing ? "Finish in your browser…" : "Choose in Google Drive"}</button>
    </div>
    {choosing && <ChoosingNote onCancel={() => { stopPicking(); setChoosing(false); }} />}
    <nav className="gd-trail" aria-label="Folder path">
      <button className={"gd-crumb" + (trail.length ? "" : " here")} onClick={() => setTrail([])}>Shared with Clem</button>
      {trail.map((t, i) => <span key={t.id} className="gd-crumb-wrap"><Chevron /><button className={"gd-crumb" + (i === trail.length - 1 ? " here" : "")} onClick={() => setTrail((all) => all.slice(0, i + 1))}>{t.name}</button></span>)}
      <button className="gd-refresh" aria-label="Refresh" aria-description="Refresh" disabled={busy} onClick={() => void load()}><Icon name="undo" size={13} /></button>
    </nav>
    {here && <div className="gd-inside-note">
      <span>Google shares a folder without what was already in it. Files and subfolders you chose with it are here; choose more in Google Drive.</span>
      <button disabled={choosing} onClick={() => void choose()}>Choose its files</button>
    </div>}
    <div className={"gd-list" + (busy && items?.length ? " is-loading" : "")} role="list" aria-busy={busy}>
      {(items || []).map((f) => {
        const isFolder = f.mimeType === FOLDER;
        const meta = isFolder
          ? trail.length ? "Folder" : f.inside ? `${f.inside} item${f.inside === 1 ? "" : "s"} inside Clem can open` : "Only the folder · choose its files too"
          : [kindName(f.mimeType, f.name), when(f.modified)].filter(Boolean).join(" · ");
        return <div role="listitem" key={f.id} className={"gd-row" + (isFolder ? " is-folder" : "") + (fresh.has(f.id) ? " is-new" : "")}>
          {(() => {
            const body = <>
              <span className="gd-thumb">{hasPreview(f) ? <Thumb id={f.id} mime={f.mimeType} name={f.name} /> : <DriveIcon mime={f.mimeType} name={f.name} size={26} />}</span>
              <span className="gd-name"><strong>{f.name}</strong><small className={isFolder && !trail.length && !f.inside ? "is-only" : ""}>{meta}</small></span>
              {isFolder && <Chevron />}
            </>;
            // A file is listed, not opened, here; only folders open.
            return isFolder
              ? <button className="gd-open" onClick={() => setTrail((t) => t.at(-1)?.id === f.id ? t : [...t, { id: f.id, name: f.name }])} aria-description={`Open ${f.name}`}>{body}</button>
              : <div className="gd-open is-static">{body}</div>;
          })()}
          {isFolder && !trail.length && !f.inside && <button className="gd-row-action" disabled={choosing} onClick={() => void choose()}>Choose its files</button>}
          <button className="gd-remove" aria-label={`Remove ${f.name} from Clem's access`} aria-description="Remove from Clem's access" onClick={() => void remove(f)}><Icon name="close" size={13} /></button>
        </div>;
      })}
      {busy && !items && Array.from({ length: 5 }, (_, i) => <div key={i} className="gd-skeleton" style={{ animationDelay: i * 60 + "ms" }} />)}
      {!busy && !error && items && !items.length && <div className="gd-empty">
        <DriveIcon mime={FOLDER} size={40} />
        <strong>{here ? "Nothing in this folder is shared with Clem" : "Nothing shared with Clem yet"}</strong>
        <small>{here ? "Choose its files in Google Drive: open the folder there and select them." : "Choose files and folders in Google Drive. Select a folder's files with it so Clem can open them."}</small>
        <button className="gd-choose" disabled={choosing} onClick={() => void choose()}><DriveLogo size={14} />{choosing ? "Finish in your browser…" : "Choose in Google Drive"}</button>
      </div>}
    </div>
    {error && <p className="gd-error" role="alert">{error}{/^(Reconnect Google Drive|Clem now opens only)/.test(error) && <> <button className="gd-retry" onClick={() => void choose()}>Reconnect</button></>} <button className="gd-retry" onClick={() => void load()}>Try again</button></p>}
    <footer className="gd-foot">
      <button className="gd-disconnect" onClick={() => void confirmDialog({ title: "Disconnect Google Drive?", message: "Google takes back everything Clem could open. Linked folders come back when you connect and choose them again. Nothing in your Drive changes.", confirm: "Disconnect" }).then((yes) => { if (yes) return disconnectDrive(); }).catch((e) => setError(driveError(e)))}>Disconnect</button>
      <span className="gd-count" aria-live="polite">{removed ? <>Removed <b>{removed.name.length > 32 ? removed.name.slice(0, 31) + "…" : removed.name}</b> · <button className="gd-retry" onClick={() => void undo()}>Undo</button></> : here ? "" : total}</span>
      {onDone && <button className="primary" onClick={onDone}>Done</button>}
    </footer>
  </div>;
}
