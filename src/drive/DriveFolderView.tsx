import { useEffect, useRef, useState, type DragEvent } from "react";
import { Icon } from "../Icons";
import { DriveLogo } from "../BrandLogos";
import { FileGlyph } from "../files/FileGlyph";
import { RenameField, PencilIcon } from "../files/RenameField";
import { Menu, FolderIcon } from "../space/SpaceMenu";
import { sizeLabel } from "../store";
import { connectDrive, driveFolder, isGoogleFormat, useDrive, type DriveItem, type DriveSyncState } from "./drive";
import type { SpaceActions } from "../space/SpacePage";
import type { Space, StoredFile } from "../../core/types";
import "./drive.css";

const ago = (iso?: string) => { if (!iso) return ""; const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000); return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 7 ? `${d} days ago` : new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" }); };
/** Google's own formats get the glyph of the Office file they stand for. */
const glyphName = (i: { name: string; mimeType: string }) => i.name + (({ document: ".docx", presentation: ".pptx", spreadsheet: ".xlsx" } as Record<string, string>)[i.mimeType.replace("application/vnd.google-apps.", "")] || "");
const editable = /\.(pdf|docx|pptx|xlsx|txt|md|csv|json|tex)$/i;
type Sync = DriveSyncState["state"] | "pending";

/** Beside each file: a turning ring while it uploads, a check once Drive has it, a mark if it failed, a dot for an edit
 *  that waits for approval. */
function SyncMark({ state, error }: { state: Sync; error?: string }) {
  const label = state === "uploading" ? "Saving to Google Drive" : state === "failed" ? "Not saved to Google Drive" + (error ? ": " + error : "") : state === "pending" ? "Edited here · approve the change to save it to Google Drive" : "In Google Drive";
  return <span className={"gd-sync is-" + state} role="img" aria-label={label} title={label}>{state === "synced" ? <Icon name="check" size={12} /> : state === "failed" ? "!" : null}</span>;
}

/**
 * The Google Drive folder linked to a subject or project, listed like the files kept here: the same file icons, rename,
 * Source and menu. Files dropped on it (from this PC or from Mowr's own files) are kept here and saved into the Drive
 * folder they land on, showing a turning ring until Drive has them and a check after. Edits made here go back to the
 * same Drive file once approved.
 */
export function DriveFolderView({ space, files, driveSync, actions, onItems, more = [] }: {
  space: Space; files: StoredFile[]; driveSync: Record<string, DriveSyncState>; actions: SpaceActions; onItems?: (items: DriveItem[]) => void;
  /** Extra entries for the header's menu, from the page around it. */
  more?: { label: string; run: () => void }[];
}) {
  const { folderId, folderName } = space.drive!;
  const { connected } = useDrive();
  const [items, setItems] = useState<DriveItem[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [at, setAt] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
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
  useEffect(() => { request.current++; setItems(null); setAt(""); setError(""); setBusy(false); }, [folderId]);
  useEffect(() => { if (connected !== false) void load(); const t = setInterval(() => { if (!document.hidden) void load(true); }, 5 * 60_000); return () => clearInterval(t); }, [folderId, connected]);
  const full = (i: DriveItem) => (i.path ? i.path + " / " : "") + i.name;
  /** Where a Drive folder sits inside the linked folder, as the rows' `path`. */
  const pathOf = (id: string) => { if (id === folderId) return ""; const f = (items || []).find((i) => i.id === id); return f ? full(f) : ""; };

  // Files on their way into Drive are remembered with the folder they were dropped on, so once Drive has them they
  // show there straight away (with their check), before Drive's own listing catches up.
  const landing = useRef(new Map<string, string>());
  useEffect(() => {
    for (const f of files) if (f.driveFolder && !f.driveId) landing.current.set(f.id, f.driveFolder);
    const arrived = files.filter((f) => f.driveId && landing.current.has(f.id) && items && !items.some((i) => i.id === f.driveId));
    if (!arrived.length || !items) return;
    const next = [...items, ...arrived.map((f) => ({ id: f.driveId!, name: f.name, mimeType: f.type || "application/octet-stream", size: f.size, modified: f.driveModified || new Date().toISOString(), path: pathOf(landing.current.get(f.id)!) || undefined }))];
    arrived.forEach((f) => landing.current.delete(f.id));
    setItems(next); onItems?.(next);
    const t = setTimeout(() => void load(true), 1500);
    return () => clearTimeout(t);
  }, [files, items]);

  const copyOf = (id: string) => files.find((f) => f.driveId === id);
  const syncOf = (file?: StoredFile): Sync => !file ? "synced" : driveSync[file.id]?.state === "uploading" || (file.driveFolder && !file.driveId && !driveSync[file.id]) ? "uploading" : driveSync[file.id]?.state === "failed" ? "failed" : file.drivePending ? "pending" : "synced";
  const here = (items || []).filter((i) => (i.path || "") === at);
  const folders = here.filter((i) => i.folder).sort((a, b) => a.name.localeCompare(b.name));
  const driveFiles = here.filter((i) => !i.folder).sort((a, b) => Date.parse(b.modified || "") - Date.parse(a.modified || "") || a.name.localeCompare(b.name));
  const count = (path: string) => (items || []).filter((i) => !i.folder && (i.path === path || i.path?.startsWith(path + " / "))).length;
  const parts = at ? at.split(" / ") : [];
  const allFiles = (items || []).filter((i) => !i.folder);
  const hereId = at ? (items || []).find((i) => i.folder && full(i) === at)?.id || folderId : folderId;
  // Dropped files not in Drive yet: uploading, or failed with Google's reason.
  const incoming = files.filter((f) => f.driveFolder && !f.driveId && f.driveFolder === hereId);
  const failed = files.filter((f) => f.driveFolder && !f.driveId && driveSync[f.id]?.state === "failed");

  /** Each file is kept here and shown in the folder at once; they upload side by side and turn into checks as they land. */
  function save(target: string, local: File[], mowr: string[]) {
    if (!local.length && !mowr.length) return;
    setError("");
    void Promise.allSettled([...local, ...mowr].map((input) => actions.onAddToDrive(target, input)));
  }
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
    onDrop: (e: DragEvent) => { if (!accepts(e) || connected === false) return; e.preventDefault(); e.stopPropagation(); setOver(null); const { local, mowr } = dropped(e); save(key, local, mowr); },
  });

  const isSource = (i: DriveItem, copy?: StoredFile) => space.sources.includes(copy ? copy.id : "drive:" + i.id);
  const setSource = (i: DriveItem, copy: StoredFile | undefined, on: boolean) => {
    const id = copy ? copy.id : "drive:" + i.id;
    actions.onUpdateSpace({ ...space, sources: on ? [...new Set([...space.sources, id])] : space.sources.filter((x) => x !== id) });
  };
  const open = (i: DriveItem, copy?: StoredFile) => copy ? actions.onOpenFile(copy) : actions.onOpenDrive(i);
  const rename = async (i: DriveItem, copy: StoredFile | undefined, name: string) => {
    setRenaming(null);
    if (copy) actions.onRenameFile(copy, name);
    else if (!await actions.onRenameDrive(i, name)) return;
    setItems((all) => all && all.map((x) => x.id === i.id ? { ...x, name } : x));
  };
  const reconnect = failed.some((f) => /^Reconnect Google Drive/.test(driveSync[f.id]?.error || ""));

  return <section className={"gd-space" + (over === hereId ? " is-drop" : "")} aria-label={`Google Drive folder ${folderName}`} {...target(hereId)}>
    <header className="gd-space-head">
      <DriveLogo size={16} />
      <div><strong>{folderName}</strong><small>{items ? `${allFiles.length} file${allFiles.length === 1 ? "" : "s"} in Google Drive` : "Google Drive"}</small></div>
      <div className="gd-space-actions">
        {connected !== false && <button onClick={() => picker.current?.click()} aria-description={`Add files from this PC to ${at ? parts[parts.length - 1] : folderName} in Drive`}><Icon name="plus" size={13} /> Add files</button>}
        <input ref={picker} type="file" multiple hidden onChange={(e) => { const chosen = Array.from(e.target.files || []); e.target.value = ""; save(hereId, chosen, []); }} />
        <Menu label="Google Drive folder options" items={[
          ...(busy ? [] : [{ label: "Refresh", run: () => void load(true) }]),
          { label: "Open in Google Drive", run: () => actions.onOpenDriveWeb({ id: hereId, name: folderName, mimeType: "application/vnd.google-apps.folder" }) },
          ...more,
          { label: "Link another folder", run: actions.onLinkDrive }, { label: "Unlink folder", danger: true, run: actions.onUnlinkDrive }]} />
      </div>
    </header>
    {parts.length > 0 && <nav className="gd-trail" aria-label="Folder path">
      <button className="gd-crumb" onClick={() => setAt("")}>{folderName}</button>
      {parts.map((p, i) => <span className="gd-crumb-wrap" key={i}><span className="gd-chev"><Icon name="right" size={12} /></span><button className={"gd-crumb" + (i === parts.length - 1 ? " here" : "")} onClick={() => setAt(parts.slice(0, i + 1).join(" / "))}>{p}</button></span>)}
    </nav>}
    {connected === false && <p className="gd-space-empty">Google Drive is disconnected. Connect it in Settings → Connectors to see this folder.</p>}
    {error && <p className="gd-error">{error}</p>}
    {reconnect && <p className="gd-reconnect">Mowr saves into your own Drive folders, which needs one more permission from Google.
      <button onClick={() => void connectDrive().then(() => failed.forEach((f) => actions.onRetryDrive(f))).catch((e) => setError((e as Error).message))}>Reconnect Google Drive</button></p>}
    {!items && !error && connected !== false && <div className="sp-file-list">{Array.from({ length: 3 }, (_, i) => <div key={i} className="gd-skeleton" />)}</div>}
    {folders.length > 0 && <div className="sp-folders">
      {folders.map((f) => <div key={f.id} className={"sp-folder" + (over === f.id ? " over" : "")} role="button" tabIndex={0} onClick={() => setAt(full(f))} onKeyDown={(e) => { if (e.key === "Enter") setAt(full(f)); }} {...target(f.id)}>
        <FolderIcon /><div><strong>{f.name}</strong><small>{count(full(f))} file{count(full(f)) === 1 ? "" : "s"}</small></div>
        {files.some((x) => x.driveFolder === f.id && !x.driveId && driveSync[x.id]?.state !== "failed") && <SyncMark state="uploading" />}
        <Menu label={`${f.name} options`} items={[{ label: "Open in Google Drive", run: () => actions.onOpenDriveWeb(f) }]} />
      </div>)}
    </div>}
    {(incoming.length > 0 || driveFiles.length > 0) && <div className="sp-file-list">
      {incoming.map((f) => { const state = syncOf(f); return <div key={f.id} className={"sp-file gd-file is-" + state}>
        <button className="sp-file-open" onClick={() => actions.onOpenFile(f)}><FileGlyph file={f} size={36} /><span><strong>{f.name}</strong><small>{state === "failed" ? driveSync[f.id]?.error || "Not saved to Google Drive" : `${sizeLabel(f.size)} · saving to Google Drive…`}</small></span></button>
        <SyncMark state={state} error={driveSync[f.id]?.error} />
        <label className="sp-source" aria-description="Use this file when answering questions in this space"><input type="checkbox" checked={space.sources.includes(f.id)} onChange={(e) => actions.onUpdateSpace({ ...space, sources: e.target.checked ? [...new Set([...space.sources, f.id])] : space.sources.filter((id) => id !== f.id) })} />Source</label>
        <Menu label={`${f.name} options`} items={[{ label: "Open", run: () => actions.onOpenFile(f) }, ...(state === "failed" ? [{ label: "Try again", run: () => actions.onRetryDrive(f) }] : []), { label: "Delete", icon: "trash", danger: true, run: () => void actions.onDeleteFile(f) }]} />
      </div>; })}
      {driveFiles.map((i) => { const copy = copyOf(i.id), state = syncOf(copy), google = isGoogleFormat(i.mimeType), name = copy?.name || i.name;
        const meta = state === "failed" ? driveSync[copy!.id]?.error || "Not saved to Google Drive" : state === "pending" ? "Edited here · approve the change to save it to Drive" : state === "uploading" ? "Saving to Google Drive…"
          : [i.size ? sizeLabel(i.size) : google ? "Google " + i.mimeType.replace("application/vnd.google-apps.", "") : "", (copy?.updated ? "edited " : "") + ago(i.modified), copy?.versions?.length ? `${copy.versions.length} earlier version${copy.versions.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
        return <div key={i.id} className={"sp-file gd-file is-" + state}>
          {renaming === i.id ? <div className="sp-file-open"><FileGlyph file={{ name: glyphName({ name, mimeType: i.mimeType }), type: i.mimeType }} /><RenameField name={name} onSave={(n) => void rename(i, copy, n)} onCancel={() => setRenaming(null)} /></div>
            : <button className="sp-file-open" onClick={() => state === "pending" && copy ? actions.onEditFile(copy) : open(i, copy)}><FileGlyph file={{ name: glyphName({ name, mimeType: i.mimeType }), type: i.mimeType }} size={36} /><span><strong>{name}</strong><small>{meta}</small></span></button>}
          <SyncMark state={state} error={copy && driveSync[copy.id]?.error} />
          <button className="icon-button sp-rename" aria-label={`Rename ${name}`} aria-description="Rename" onClick={() => setRenaming(i.id)}><PencilIcon size={15} /></button>
          <label className="sp-source" aria-description="Use this file when answering questions in this space"><input type="checkbox" checked={isSource(i, copy)} onChange={(e) => setSource(i, copy, e.target.checked)} />Source</label>
          <Menu label={`${name} options`} items={[
            { label: "Open", run: () => open(i, copy) },
            ...(state === "pending" && copy ? [{ label: "Review edit", run: () => actions.onEditFile(copy) }] : []),
            ...(google ? [{ label: "Edit in Google Drive", run: () => actions.onEditDrive(i) }] : editable.test(name) ? [{ label: "Edit with Mowr", run: () => copy ? actions.onEditFile(copy) : actions.onEditDrive(i) }] : []),
            { label: "Ask about it", run: () => actions.onAskDrive([i]) },
            ...(!google ? [{ label: "Open in Google Drive", run: () => actions.onOpenDriveWeb(i) }] : []),
            ...(state === "failed" && copy ? [{ label: "Try again", run: () => actions.onRetryDrive(copy) }] : []),
            { label: "Move to Drive trash", icon: "trash", danger: true, run: () => void actions.onTrashDrive(i).then((ok) => { if (ok) setItems((all) => all && all.filter((x) => x.id !== i.id)); }) },
          ]} />
        </div>; })}
    </div>}
    {items && !here.length && !incoming.length && <div className="gd-space-empty">This folder is empty in Drive. Drop files here to save them to it.</div>}
  </section>;
}
