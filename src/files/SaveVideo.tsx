import { useEffect, useMemo, useRef, useState } from "react";
import type { StoredFile } from "../../core/types";
import { Icon } from "../Icons";
import { YouTubeLogo } from "../BrandLogos";
import { desktop } from "../desktop/bridge";
import { readPlaylist, readVideoLink, saveVideos, thumbnailUrl, type SaveProgress } from "./saved-video";
import "./saved-video.css";

export type SavedVideos = { files: StoredFile[]; skipped: number; place: string | null; playlist?: { id: string; title: string } };

/**
 * Paste a YouTube video or playlist and keep it, with its transcript, where the person is: a subject, a project or their
 * own files. `places`: where it can go when there is a choice (the Files page); a subject's Files tab passes only itself.
 */
export function SaveVideoDialog({ places, place: initial, folderId = null, existing, store, onSaved, onClose }: {
  places: { id: string | null; name: string }[];
  place: string | null;
  folderId?: string | null;
  existing: StoredFile[];
  store: (id: string, blob: Blob) => Promise<void>;
  onSaved: (saved: SavedVideos) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState("");
  const [place, setPlace] = useState(initial);
  const [whole, setWhole] = useState(true);
  const [busy, setBusy] = useState<SaveProgress & { listing?: boolean } | null>(null);
  const [error, setError] = useState("");
  const stop = useRef<AbortController | null>(null);
  const link = useMemo(() => readVideoLink(value), [value]);
  // A video watched inside a playlist can be saved alone or with the whole playlist; a playlist link is the playlist.
  const asPlaylist = !!link?.playlist && (!link.video || whole);
  useEffect(() => { ref.current?.showModal(); return () => stop.current?.abort(); }, []);
  useEffect(() => setError(""), [value]);
  // While saving, closing stops after the videos being read; the ones already read are kept.
  // Stop keeps the dialog open; closing it (Escape, the backdrop, ×) also closes it once the stop has settled.
  const leaving = useRef(false);
  const halt = () => { if (busy) stop.current?.abort(); else onClose(); };
  const close = () => { if (busy) leaving.current = true; halt(); };
  const stopped = () => { setBusy(null); if (leaving.current) onClose(); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!link) { setError(value.trim() ? "That isn't a YouTube video or playlist link." : "Paste a YouTube link first."); return; }
    const controller = new AbortController();
    stop.current = controller;
    try {
      let videos = [{ id: link.video?.id || "" }] as { id: string; title?: string }[], playlist: { id: string; title: string } | undefined;
      if (asPlaylist) {
        setBusy({ done: 0, total: 0, listing: true });
        const list = await readPlaylist(link.playlist!.id);
        if (controller.signal.aborted) { stopped(); return; }
        if (list.error || !list.videos.length) { setBusy(null); setError(list.error || "YouTube didn't list any videos in this playlist."); return; }
        videos = list.videos;
        playlist = { id: list.id, title: list.title || "YouTube playlist" };
      }
      const result = await saveVideos(videos, { place, folderId, playlist, existing, store, signal: controller.signal, onProgress: (p) => setBusy(p) });
      if (controller.signal.aborted && !result.files.length) { stopped(); return; }
      onSaved({ ...result, place, ...(playlist ? { playlist } : {}) });
    } catch (err) {
      if (!controller.signal.aborted) { setBusy(null); setError(err instanceof Error ? err.message : "The video could not be saved. Try again."); }
      else stopped();
    }
  }

  const preview = link?.video?.id;
  return <dialog ref={ref} className="yt-save" aria-labelledby="yt-save-title" onCancel={(e) => { e.preventDefault(); close(); }} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <form onSubmit={save}>
      <header className="yt-save-head">
        <YouTubeLogo size={26} />
        <div><h2 id="yt-save-title">Save from YouTube</h2><p>Clem keeps the transcript, so it can answer from what the video says.</p></div>
        <button type="button" className="icon-button" aria-label="Close" onClick={close}><Icon name="close" size={18} /></button>
      </header>
      <label className="yt-save-field">
        <span>Video or playlist link</span>
        <input autoFocus value={value} disabled={!!busy} onChange={(e) => setValue(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" aria-invalid={!!error} spellCheck={false} autoComplete="off" />
      </label>
      {link && <div className="yt-save-preview">
        {preview ? <VideoThumb id={preview} /> : <span className="yt-thumb yt-thumb-list" aria-hidden="true"><Icon name="list" size={22} /></span>}
        <div>
          <strong>{asPlaylist ? "Playlist" : "Video"}</strong>
          <small>{asPlaylist ? "Every video in it, up to the first 100, each with its transcript." : "Saved with its transcript when it has captions."}</small>
          {link.video && link.playlist && <span className="yt-save-choice" role="group" aria-label="What to save">
            <button type="button" aria-pressed={!whole} onClick={() => setWhole(false)}>This video</button>
            <button type="button" aria-pressed={whole} onClick={() => setWhole(true)}>Whole playlist</button>
          </span>}
        </div>
      </div>}
      {places.length > 1 && <label className="yt-save-field">
        <span>Save to</span>
        <select value={place ?? ""} disabled={!!busy} onChange={(e) => setPlace(e.target.value || null)}>
          {places.map((p) => <option key={p.id ?? ""} value={p.id ?? ""}>{p.name}</option>)}
        </select>
      </label>}
      {!desktop && <p className="yt-save-note">In the browser, videos are saved without a transcript. The Clem desktop app reads them.</p>}
      {error && <p className="yt-save-error" role="alert">{error}</p>}
      {busy && <div className="yt-save-progress" role="status">
        <progress max={busy.total || 1} value={busy.listing ? undefined : busy.done} />
        <span>{busy.listing ? "Reading the playlist…" : busy.total > 1 ? `Reading transcripts · ${busy.done} of ${busy.total}` : "Reading the transcript…"}</span>
      </div>}
      <footer className="yt-save-actions">
        <button type="button" className="yt-btn" onClick={halt}>{busy ? "Stop" : "Cancel"}</button>
        <button className="yt-btn strong" disabled={!!busy || !value.trim()}>{asPlaylist ? "Save playlist" : "Save video"}</button>
      </footer>
    </form>
  </dialog>;
}

/** A video's YouTube picture, or a drawn play mark when it can't load (offline, or a network that blocks it). */
export function VideoThumb({ id, duration, className = "" }: { id: string; duration?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  return <span className={`yt-thumb ${className}`} aria-hidden="true">
    {failed ? <Icon name="play" size={20} /> : <img src={thumbnailUrl(id)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    {duration && <i>{duration}</i>}
  </span>;
}
