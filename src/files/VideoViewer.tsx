import { useEffect, useMemo, useRef, useState } from "react";
import type { StoredFile } from "../../core/types";
import { Icon } from "../Icons";
import { getBlob } from "../store";
import { durationLabel, liveCaptions, readsLive, shownName, transcriptOf, watchUrl } from "./saved-video";
import { stamp } from "../../core/captions";
import "./saved-video.css";

type Lines = { moments: { start: number; text: string }[]; auto?: boolean; error?: string };

/**
 * A saved video opened from Files: the player beside its transcript, where each time jumps the player there. A video
 * saved as a link has its captions read now and kept nowhere; an older save shows the transcript kept in its file.
 */
export function VideoViewer({ file, onClose, onAsk }: { file: StoredFile; onClose: () => void; onAsk: (file: StoredFile) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const video = file.video!;
  const live = readsLive(video);
  const [lines, setLines] = useState<Lines | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [start, setStart] = useState(0);
  const [play, setPlay] = useState(0);
  const [query, setQuery] = useState("");
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    let on = true;
    setLines(null);
    const read: Promise<Lines> = live
      ? liveCaptions(file).then((c) => c.transcript ? { moments: transcriptOf("\n## Transcript\n" + c.transcript), auto: c.auto } : { moments: [], error: c.error || "This video has no captions Clem can read." })
      : getBlob(file.id).then((b) => b?.text()).then((t) => ({ moments: transcriptOf(t || ""), auto: video.captions === "auto" }));
    void read.catch(() => ({ moments: [], error: "The transcript couldn't be read." })).then((l) => { if (on) setLines(l); });
    return () => { on = false; };
  }, [file.id, file.updated, live, attempt]);
  const moments = useMemo(() => lines?.moments || [], [lines]);
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
          <strong>{lines?.auto ? "Auto transcript" : "Transcript"}</strong>
          {!!moments.length && <span className="yt-find"><Icon name="research" size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in transcript" aria-label="Find in transcript" /></span>}
        </div>
        {lines === null ? <p className="yt-none">{live ? "Reading the captions…" : "Loading the transcript…"}</p> : lines.error ? <div className="yt-none">
          <p>{lines.error} Clem only knows its title{video.channel ? " and channel" : ""}, so it won’t guess what the video says.</p>
          <button type="button" className="yt-btn" onClick={() => setAttempt((n) => n + 1)}><Icon name="refresh" size={14} />Try captions again</button>
        </div> : <ol className="yt-lines">
          {shown.map((m) => <li key={m.start}><button type="button" onClick={() => jump(m.start)}><time>{stamp(m.start)}</time><span>{m.text}</span></button></li>)}
          {!shown.length && <li className="yt-none">{q ? `Nothing in the transcript matches “${query.trim()}”.` : "The transcript is empty."}</li>}
        </ol>}
        {lines?.auto && <p className="yt-fine">Automatic captions can mishear names and terms.</p>}
        {live && !!moments.length && <p className="yt-fine">Read from YouTube just now; Clem doesn’t keep a copy.</p>}
      </section>
    </div>
  </dialog>;
}
