import { useEffect, useRef, useState, type DragEvent } from "react";
import { Icon } from "../Icons";
import { DriveLogo } from "../BrandLogos";
import { FileGlyph } from "../files/FileGlyph";
import { RenameField, PencilIcon } from "../files/RenameField";
import { Menu, FolderIcon } from "../space/SpaceMenu";
import { sizeLabel } from "../store";
import { connectDrive, driveFolder, isGoogleFormat, moveInDrive, useDrive, type DriveItem, type DriveSyncState } from "./drive";
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

/** A file on its way into Drive: shown in its folder at once with a turning ring, or with Google's reason if it failed. */
type Upload = { key: string; name: string; size: number; type: string; folder: string; input: File | string; error?: string };

/**
 * The Google Drive folder linked to a subject or project, listed like the files kept here: the same file icons, rename,
 * Source and menu. Files dropped on it (from this PC or from Mowr's own files) go to the Drive folder they land on and
 * only there, showing a turning ring until Drive has them; "Save on this PC" copies a file or a whole folder to
 * "On this PC" as well. Edits made here go back to the same Drive file once approved.
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
  const [uploads, setUploads] = useState<Upload[]>([]);
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
  const incoming = uploads.filter((u) => u.folder === hereId);
  const failed = uploads.filter((u) => u.error);

  /** One file into Drive: its row shows at once; once Drive has it, it joins the listing in the folder it landed on. */
  function send(upload: Upload) {
    setUploads((all) => [...all.filter((u) => u.key !== upload.key), { ...upload, error: undefined }]);
    void actions.onAddToDrive(upload.folder, upload.input).then((item) => {
      setUploads((all) => all.filter((u) => u.key !== upload.key));
      setItems((all) => { if (!all) return all; const next = [...all.filter((x) => x.id !== item.id), { ...item, path: pathOf(upload.folder) || undefined }]; onItems?.(next); return next; });
      setTimeout(() => void load(true), 1500);
    }, (e) => setUploads((all) => all.map((u) => u.key === upload.key ? { ...u, error: (e as Error).message || "Not saved to Google Drive" } : u)));
  }
  /** Files go to Drive only, side by side; Mowr files dragged in are copied there and stay on this PC too. */
  function save(target: string, local: File[], mowr: string[]) {
    if (!local.length && !mowr.length) return;
    setError("");
    for (const input of local) send({ key: crypto.randomUUID(), name: input.name, size: input.size, type: input.type, folder: target, input });
    for (const id of mowr) { const f = files.find((x) => x.id === id); if (f) send({ key: crypto.randomUUID(), name: f.name, size: f.size, type: f.type, folder: target, input: id }); }
  }
  /** Every Drive file inside a folder, with the folders it sits in (starting with the folder itself), for "Save on this PC". */
  const inside = (folder: DriveItem) => { const root = full(folder); return (items || []).filter((i) => !i.folder && (i.path === root || i.path?.startsWith(root + " / "))).map((item) => ({ item, dirs: [folder.name, ...(item.path!.slice(root.length).split(" / ").filter(Boolean))] })); };
  const DRIVE_ITEM = "application/x-mowr-drive";
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("application/x-mowr-file") || e.dataTransfer.types.includes(DRIVE_ITEM);
  /** Drive files and folders are dragged by id onto another folder (a card, the path above, or the folder shown). */
  const dragItem = (i: DriveItem) => ({ draggable: true, onDragStart: (e: DragEvent) => { e.stopPropagation(); e.dataTransfer.setData(DRIVE_ITEM, i.id); e.dataTransfer.effectAllowed = "move"; } });
  /** Moves a Drive file or folder into `to`: shown there at once (a folder with everything in it), undone if Drive refuses. */
  function move(id: string, to: string) {
    const all = items || [], moving = all.find((i) => i.id === id);
    if (!moving) return;
    const from = moving.path || "", dest = pathOf(to), own = full(moving);
    if (from === dest || moving.id === to) return;
    if (moving.folder && (dest === own || dest.startsWith(own + " / "))) { setError("A folder can't go inside itself."); return; }
    const moved = (dest ? dest + " / " : "") + moving.name;
    const next = all.map((i) => i.id === id ? { ...i, path: dest || undefined } : moving.folder && (i.path === own || i.path?.startsWith(own + " / ")) ? { ...i, path: moved + i.path!.slice(own.length) } : i);
    setItems(next); onItems?.(next); setError("");
    void moveInDrive(folderId, id, to).then(() => void load(true), (e) => { setError(`${moving.name} was not moved: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")}`); void load(true); });
  }
  // What is dropped is read during the drop itself; the browser empties it right after.
  const dropped = (e: DragEvent) => {
    const folders = Array.from(e.dataTransfer.items || []).filter((i) => i.kind === "file" && i.webkitGetAsEntry?.()?.isDirectory).length;
    const local = Array.from(e.dataTransfer.files).filter((f, i) => !(e.dataTransfer.items?.[i]?.webkitGetAsEntry?.()?.isDirectory));
    const mowr = e.dataTransfer.getData("application/x-mowr-file");
    if (folders) setError("Folders are not copied to Drive yet; drop the files inside them.");
    return { local, mowr: mowr ? [mowr] : [] };
  };
  const target = (key: string) => ({
    onDragOver: (e: DragEvent) => { if (!accepts(e) || connected === false) return; e.preventDefault(); e.stopPropagation();
      // A file from this space's own list is dragged as a move; the drop effect has to match or the browser cancels the drop.
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes("application/x-mowr-file") || e.dataTransfer.types.includes(DRIVE_ITEM) ? "move" : "copy"; setOver(key); },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === key ? null : o)); },
    onDrop: (e: DragEvent) => { if (!accepts(e) || connected === false) return; e.preventDefault(); e.stopPropagation(); setOver(null);
      const driveId = e.dataTransfer.getData(DRIVE_ITEM);
      if (driveId) { move(driveId, key); return; }
      const { local, mowr } = dropped(e); save(key, local, mowr); },
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
  const reconnect = failed.some((u) => /^Reconnect Google Drive/.test(u.error || ""));

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
      <button className={"gd-crumb" + (over === folderId ? " over" : "")} onClick={() => setAt("")} {...target(folderId)}>{folderName}</button>
      {parts.map((p, i) => { const path = parts.slice(0, i + 1).join(" / "), id = (items || []).find((x) => x.folder && full(x) === path)?.id || folderId;
        return <span className="gd-crumb-wrap" key={i}><span className="gd-chev"><Icon name="right" size={12} /></span><button className={"gd-crumb" + (i === parts.length - 1 ? " here" : "") + (over === id && i < parts.length - 1 ? " over" : "")} onClick={() => setAt(path)} {...(i < parts.length - 1 ? target(id) : {})}>{p}</button></span>; })}
    </nav>}
    {connected === false && <p className="gd-space-empty">Google Drive is disconnected. Connect it in Settings → Connectors to see this folder.</p>}
    {error && <p className="gd-error">{error}</p>}
    {reconnect && <p className="gd-reconnect">Mowr saves into your own Drive folders, which needs one more permission from Google.
      <button onClick={() => void connectDrive().then(() => failed.forEach(send)).catch((e) => setError((e as Error).message))}>Reconnect Google Drive</button></p>}
    {!items && !error && connected !== false && <div className="sp-file-list">{Array.from({ length: 3 }, (_, i) => <div key={i} className="gd-skeleton" />)}</div>}
    {folders.length > 0 && <div className="sp-folders">
      {folders.map((f) => <div key={f.id} className={"sp-folder" + (over === f.id ? " over" : "")} role="button" tabIndex={0} onClick={() => setAt(full(f))} onKeyDown={(e) => { if (e.key === "Enter") setAt(full(f)); }} {...target(f.id)} {...dragItem(f)}>
        <FolderIcon /><div><strong>{f.name}</strong><small>{count(full(f))} file{count(full(f)) === 1 ? "" : "s"}</small></div>
        {uploads.some((u) => u.folder === f.id && !u.error) && <SyncMark state="uploading" />}
        <Menu label={`${f.name} options`} items={[{ label: "Save on this PC", run: () => actions.onSaveOnPc(inside(f)) }, { label: "Open in Google Drive", run: () => actions.onOpenDriveWeb(f) }]} />
      </div>)}
    </div>}
    {(incoming.length > 0 || driveFiles.length > 0) && <div className="sp-file-list">
      {incoming.map((u) => { const state: Sync = u.error ? "failed" : "uploading"; return <div key={u.key} className={"sp-file gd-file is-" + state}>
        <div className="sp-file-open"><FileGlyph file={{ name: u.name, type: u.type }} size={36} /><span><strong>{u.name}</strong><small>{u.error || `${sizeLabel(u.size)} · saving to Google Drive…`}</small></span></div>
        <SyncMark state={state} error={u.error} />
        {u.error && <Menu label={`${u.name} options`} items={[{ label: "Try again", run: () => send(u) }, { label: "Remove", run: () => setUploads((all) => all.filter((x) => x.key !== u.key)) }]} />}
      </div>; })}
      {driveFiles.map((i) => { const copy = copyOf(i.id), state = syncOf(copy), google = isGoogleFormat(i.mimeType), name = copy?.name || i.name;
        const meta = state === "failed" ? driveSync[copy!.id]?.error || "Not saved to Google Drive" : state === "pending" ? "Edited here · approve the change to save it to Drive" : state === "uploading" ? "Saving to Google Drive…"
          : [i.size ? sizeLabel(i.size) : google ? "Google " + i.mimeType.replace("application/vnd.google-apps.", "") : "", (copy?.updated ? "edited " : "") + ago(i.modified), copy?.versions?.length ? `${copy.versions.length} earlier version${copy.versions.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
        return <div key={i.id} className={"sp-file gd-file is-" + state} {...(renaming === i.id ? {} : dragItem(i))}>
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
            { label: "Save on this PC", run: () => actions.onSaveOnPc([{ item: i, dirs: [] }]) },
            ...(!google ? [{ label: "Open in Google Drive", run: () => actions.onOpenDriveWeb(i) }] : []),
            ...(state === "failed" && copy ? [{ label: "Try again", run: () => actions.onRetryDrive(copy) }] : []),
            { label: "Move to Drive trash", icon: "trash", danger: true, run: () => void actions.onTrashDrive(i).then((ok) => { if (ok) setItems((all) => all && all.filter((x) => x.id !== i.id)); }) },
          ]} />
        </div>; })}
    </div>}
    {items && !here.length && !incoming.length && <div className="gd-space-empty">This folder is empty in Drive. Drop files here to save them to it.</div>}
  </section>;
}
