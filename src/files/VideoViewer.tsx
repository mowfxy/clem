import { useEffect, useMemo, useRef, useState } from "react";
import type { StoredFile } from "../../core/types";
import { Icon } from "../Icons";
import { getBlob } from "../store";
import { captionsLabel, durationLabel, shownName, transcriptOf, watchUrl } from "./saved-video";
import { stamp } from "../../core/captions";
import "./saved-video.css";

/** A saved video opened from Files: the player beside its transcript, where each time jumps the player there. */
export function VideoViewer({ file, onClose, onAsk, onRefresh }: { file: StoredFile; onClose: () => void; onAsk: (file: StoredFile) => void; onRefresh: (file: StoredFile) => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const video = file.video!;
  const [doc, setDoc] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [play, setPlay] = useState(0);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => { let live = true; void getBlob(file.id).then((b) => b?.text()).then((t) => { if (live) setDoc(t || ""); }).catch(() => live && setDoc("")); return () => { live = false; }; }, [file.id, file.updated]);
  const moments = useMemo(() => transcriptOf(doc || ""), [doc]);
  const q = query.trim().toLowerCase();
  const shown = q ? moments.filter((m) => m.text.toLowerCase().includes(q)) : moments;
  const jump = (at: number) => { setStart(at); setPlay((n) => n + 1); };
  const meta = [video.channel, durationLabel(video.durationSec), video.playlist?.title].filter(Boolean).join(" · ");
  return <dialog ref={ref} className="yt-viewer" aria-label={shownName(file)} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <header className="yt-viewer-head">
      <div><h2>{shownName(file)}</h2>{meta && <p>{meta}</p>}</div>
      <a className="yt-btn" href={watchUrl(video.id, start)} target="_blank" rel="noreferrer"><Icon name="external" size={15} />YouTube</a>
      <button type="button" className="yt-btn strong" onClick={() => onAsk(file)}><Icon name="chat" size={15} />Ask about it</button>
      <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button>
    </header>
    <div className="yt-viewer-body">
      <div className="yt-player">
        <iframe key={play} title={shownName(file)} src={`https://www.youtube-nocookie.com/embed/${video.id}?start=${Math.floor(start)}&playsinline=1&rel=0${play ? "&autoplay=1" : ""}`} referrerPolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen />
      </div>
      <section className="yt-transcript" aria-label="Transcript">
        <div className="yt-transcript-head">
          <strong>{captionsLabel(video)}</strong>
          {video.captions !== "none" && <span className="yt-find"><Icon name="research" size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in transcript" aria-label="Find in transcript" /></span>}
        </div>
        {video.captions === "none" ? <div className="yt-none">
          <p>{video.error || "This video has no captions Clem can read."} Clem only knows its title{video.channel ? " and channel" : ""}, so it won’t guess what the video says.</p>
          <button type="button" className="yt-btn" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await onRefresh(file); } finally { setRefreshing(false); } }}><Icon name="refresh" size={14} />{refreshing ? "Reading captions…" : "Try captions again"}</button>
        </div> : doc === null ? <p className="yt-none">Loading the transcript…</p> : <ol className="yt-lines">
          {shown.map((m) => <li key={m.start}><button type="button" onClick={() => jump(m.start)}><time>{stamp(m.start)}</time><span>{m.text}</span></button></li>)}
          {!shown.length && <li className="yt-none">{q ? `Nothing in the transcript matches “${query.trim()}”.` : "The transcript is empty."}</li>}
        </ol>}
        {video.captions === "auto" && <p className="yt-fine">Automatic captions can mishear names and terms.</p>}
      </section>
    </div>
  </dialog>;
}
