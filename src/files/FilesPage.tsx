import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Space, StoredFile } from "../../core/types";
import { Icon } from "../Icons";
import { YouTubeLogo } from "../BrandLogos";
import { PageHead, EmptyState } from "../ui/Calm";
import { PickMenu } from "../ui/PickMenu";
import { shortWhen, daysAgo } from "../ui/when";
import { sizeLabel } from "../store";
import { FileGlyph } from "./FileGlyph";
import { RenameField, PencilIcon } from "./RenameField";
import { StorageSummary, kinds, kindOf, type FileKind } from "./StorageSummary";
import { VideoThumb } from "./SaveVideo";
import { captionsLabel, durationLabel, shownName, watchUrl } from "./saved-video";
import "./files-page.css";

type Sort = "newest" | "oldest" | "name" | "size";
type View = "list" | "grid";
const remembered = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => { try { const v = localStorage.getItem(key) as T; return allowed.includes(v) ? v : fallback; } catch { return fallback; } };
const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch {} };
const when = (f: StoredFile) => f.updated || f.created;

/** "Today", "Yesterday", "Earlier this week", then each month: the headings newest-first files fall under. */
export function period(t: number, now = Date.now()) {
  const days = daysAgo(t, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Earlier this week";
  const d = new Date(t), n = new Date(now);
  if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()) return "Earlier this month";
  return d.toLocaleDateString(undefined, { month: "long", ...(d.getFullYear() !== n.getFullYear() ? { year: "numeric" } : {}) });
}

export type FilesPageActions = {
  onUpload: () => void;
  onSaveVideo: () => void;
  onOpen: (file: StoredFile) => void;
  onRename: (file: StoredFile, name: string) => void;
  onDownload: (file: StoredFile) => void;
  onDelete: (file: StoredFile) => void;
  /** Starts a chat with the file attached, in its subject or project. */
  onAsk: (file: StoredFile) => void;
};

/** Every file the person keeps, in one place: find one by name, kind or where it lives, as a list or as cards. */
export function FilesPage({ files, spaces, folders, actions }: { files: StoredFile[]; spaces: Space[]; folders?: ReactNode; actions: FilesPageActions }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<FileKind | "all">(() => remembered("clem-file-kind", ["all", ...kinds.map((k) => k.id)] as (FileKind | "all")[], "all"));
  const [sort, setSort] = useState<Sort>(() => remembered("clem-file-sort", ["newest", "oldest", "name", "size"] as const, "newest"));
  const [view, setView] = useState<View>(() => remembered("clem-file-view", ["list", "grid"] as const, "list"));
  const [place, setPlace] = useState("all");
  const [renaming, setRenaming] = useState<string | null>(null);
  useEffect(() => remember("clem-file-sort", sort), [sort]);
  useEffect(() => remember("clem-file-kind", kind), [kind]);
  useEffect(() => remember("clem-file-view", view), [view]);

  const spaceName = (f: StoredFile) => spaces.find((s) => s.id === f.spaceId)?.name || "Personal";
  const counts = useMemo(() => { const c = new Map<FileKind, number>(); for (const f of files) { const k = kindOf(f); c.set(k, (c.get(k) || 0) + 1); } return c; }, [files]);
  // Places that hold files, for the "Where" menu; a place whose files are all gone resets to everywhere.
  const places = useMemo(() => [...new Set(files.map((f) => f.spaceId || ""))].map((id) => ({ value: id || "personal", label: id ? spaces.find((s) => s.id === id)?.name || "Personal" : "Personal" })).sort((a, b) => a.label.localeCompare(b.label)), [files, spaces]);
  const shownKind = kind !== "all" && counts.has(kind) ? kind : "all";
  const shownPlace = place === "all" || places.some((p) => p.value === place) ? place : "all";
  const q = query.trim().toLowerCase();
  const shown = files
    .filter((f) => (shownKind === "all" || kindOf(f) === shownKind) && (shownPlace === "all" || (f.spaceId || "personal") === shownPlace))
    .filter((f) => !q || f.name.toLowerCase().includes(q) || spaceName(f).toLowerCase().includes(q) || (f.video?.channel || "").toLowerCase().includes(q) || (f.video?.playlist?.title || "").toLowerCase().includes(q))
    .sort((a, b) => sort === "name" ? shownName(a).localeCompare(shownName(b), undefined, { numeric: true, sensitivity: "base" }) : sort === "size" ? b.size - a.size : sort === "oldest" ? when(a) - when(b) : when(b) - when(a));
  // By date, files fall under "Today", "Yesterday"…; by name or size they are one list.
  const groups = useMemo(() => {
    if (sort === "name" || sort === "size") return [{ label: "", files: shown }];
    const out: { label: string; files: StoredFile[] }[] = [];
    for (const f of shown) { const label = period(when(f)); const last = out[out.length - 1]; if (last?.label === label) last.files.push(f); else out.push({ label, files: [f] }); }
    return out;
  }, [shown, sort]);

  const rename = (f: StoredFile, name: string) => { setRenaming(null); actions.onRename(f, f.video && !/\.md$/i.test(name) ? name + ".md" : name); };
  const meta = (f: StoredFile) => <>
    <span className="fx-place">{spaceName(f)}</span>
    {f.video ? <>
      {f.video.channel && <span>{f.video.channel}</span>}
      <span className={`fx-captions ${f.video.captions}`}>{captionsLabel(f.video)}</span>
    </> : <span>{sizeLabel(f.size)}</span>}
    <time dateTime={new Date(when(f)).toISOString()} title={new Date(when(f)).toLocaleString()}>{f.updated ? "edited " : ""}{shortWhen(when(f))}</time>
  </>;
  const tools = (f: StoredFile) => <div className="fx-tools">
    {f.video && <a className="icon-button" href={watchUrl(f.video.id)} target="_blank" rel="noreferrer" aria-label={`Watch ${shownName(f)} on YouTube`} title="Watch on YouTube"><Icon name="external" size={17} /></a>}
    <button className="icon-button" aria-label={`Ask about ${shownName(f)}`} title="Ask about it" onClick={() => actions.onAsk(f)}><Icon name="chat" size={17} /></button>
    <button className="icon-button" aria-label={`Rename ${shownName(f)}`} title="Rename" onClick={() => setRenaming(f.id)}><PencilIcon size={16} /></button>
    <button className="icon-button" aria-label={`Download ${shownName(f)}`} title={f.video ? "Download transcript" : "Download"} onClick={() => actions.onDownload(f)}><Icon name="download" size={18} /></button>
    <button className="icon-button" aria-label={`Delete ${shownName(f)}`} title="Delete" onClick={() => actions.onDelete(f)}><Icon name="trash" size={17} /></button>
  </div>;
  const name = (f: StoredFile) => renaming === f.id
    ? <RenameField name={shownName(f)} onSave={(n) => rename(f, n)} onCancel={() => setRenaming(null)} />
    : <button className="fx-name" onClick={() => actions.onOpen(f)} title={shownName(f)}>{shownName(f)}</button>;

  return <div className="page lib files-page">
    <PageHead title="Files" line="Everything you’ve added, kept on this PC.">
      <button className="lib-btn" onClick={actions.onSaveVideo}><YouTubeLogo size={16} />Save from YouTube</button>
      <button className="lib-btn strong" onClick={actions.onUpload}><Icon name="plus" size={16} />Upload</button>
    </PageHead>
    {files.length > 0 && <StorageSummary files={files} />}
    {folders}
    {files.length > 0 && <>
      <div className="fx-bar">
        <label className="fx-find">
          <Icon name="research" size={17} />
          <input aria-label="Search files" placeholder="Find a file, subject or channel…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); } }} />
        </label>
        {places.length > 1 && <span className="fx-pick"><PickMenu label="Where" value={shownPlace} onChange={setPlace} options={[{ value: "all", label: "Everywhere" }, ...places]} /></span>}
        <span className="fx-pick"><PickMenu label="Sort files" value={sort} onChange={setSort} options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }, { value: "name", label: "Name" }, { value: "size", label: "Largest first" }]} /></span>
        <span className="fx-views" role="group" aria-label="View">
          <button type="button" className="icon-button" aria-label="List" aria-pressed={view === "list"} onClick={() => setView("list")}><Icon name="list" size={17} /></button>
          <button type="button" className="icon-button" aria-label="Cards" aria-pressed={view === "grid"} onClick={() => setView("grid")}><Icon name="grid" size={17} /></button>
        </span>
      </div>
      {counts.size > 1 && <div className="files-kinds" role="group" aria-label="Show">
        <button type="button" aria-pressed={shownKind === "all"} onClick={() => setKind("all")}>All<small>{files.length}</small></button>
        {kinds.filter((k) => counts.has(k.id)).map((k) => <button type="button" key={k.id} aria-pressed={shownKind === k.id} onClick={() => setKind(k.id)}>{k.id === "video" && <YouTubeLogo size={13} />}{k.label}<small>{counts.get(k.id)}</small></button>)}
      </div>}
      {!shown.length && <p className="files-none" role="status">No files match{q ? ` “${query.trim()}”` : ""}{shownKind !== "all" ? ` in ${kinds.find((k) => k.id === shownKind)?.label}` : ""}.<button type="button" onClick={() => { setQuery(""); setKind("all"); setPlace("all"); }}>Show all files</button></p>}
      {groups.filter((g) => g.files.length).map((g) => <section key={g.label || "all"} className="fx-group" aria-label={g.label || "Files"}>
        {g.label && <h2 className="fx-group-title">{g.label}<span>{g.files.length}</span></h2>}
        {view === "list" ? <div className="fx-list">
          {g.files.map((f) => <div className={`fx-row${f.video ? " is-video" : ""}`} key={f.id}>
            <button className="fx-lead" tabIndex={-1} aria-hidden="true" onClick={() => actions.onOpen(f)}>{f.video ? <VideoThumb id={f.video.id} duration={durationLabel(f.video.durationSec)} /> : <FileGlyph file={f} size={32} />}</button>
            <div className="fx-main">{name(f)}<small className="fx-meta">{meta(f)}</small></div>
            {tools(f)}
          </div>)}
        </div> : <div className="fx-grid">
          {g.files.map((f) => <article className={`fx-card${f.video ? " is-video" : ""}`} key={f.id}>
            <button className="fx-cover" onClick={() => actions.onOpen(f)} aria-label={`Open ${shownName(f)}`}>{f.video ? <VideoThumb id={f.video.id} duration={durationLabel(f.video.durationSec)} /> : <FileGlyph file={f} size={46} />}</button>
            <div className="fx-main">{name(f)}<small className="fx-meta">{meta(f)}</small></div>
            {tools(f)}
          </article>)}
        </div>}
      </section>)}
    </>}
    {!files.length && <EmptyState scene="folder" line="No files yet. Upload a file, or save a YouTube video and Clem keeps its transcript.">
      <button className="lib-btn" onClick={actions.onSaveVideo}><YouTubeLogo size={16} />Save from YouTube</button>
      <button className="lib-btn strong" onClick={actions.onUpload}><Icon name="plus" size={16} />Upload files</button>
    </EmptyState>}
  </div>;
}
