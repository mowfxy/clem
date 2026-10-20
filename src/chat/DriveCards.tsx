import React, { useEffect, useState } from "react";
import { mediaUrl } from "../drive/drive";
import { DriveLogo } from "../BrandLogos";
import { Icon } from "../Icons";
import { driveKind, type DriveRef } from "../../core/drive-search";
import "./drive-cards.css";

const minutes = (ms?: number) => { if (!ms) return ""; const s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(r).padStart(2, "0"); };
const typeName = (m: string) => m.includes("google-apps.document") ? "Google Doc" : m.includes("google-apps.presentation") ? "Google Slides" : m.includes("google-apps.spreadsheet") ? "Google Sheet" : m === "application/pdf" ? "PDF" : m.startsWith("image/") ? "Image" : m.startsWith("audio/") ? "Audio" : m.includes("word") ? "Word" : m.includes("presentation") ? "PowerPoint" : m.includes("sheet") ? "Excel" : "File";

/** A Drive video that plays in the conversation, styled like the in-app YouTube player. Streamed from Drive
 *  (seeking and full screen work), never saved. */
export function DriveVideo({ file, onOpenWeb }: { file: DriveRef; onOpenWeb?: (file: DriveRef) => void }) {
  const [playing, setPlaying] = useState(false), [poster, setPoster] = useState(true);
  const [src, setSrc] = useState(""), [state, setState] = useState<"loading" | "ready" | "error">("loading"), [attempt, setAttempt] = useState(0), [arrived, setArrived] = useState(0);
  // Each attempt gets a fresh <video>, so "Try again" really asks Drive again.
  const start = () => { setPlaying(true); setState("loading"); setAttempt((n) => n + 1); void mediaUrl(file.id).then(setSrc).catch(() => setState("error")); };
  // A stream that never starts is reported instead of spinning forever; one still receiving data on a slow connection isn't.
  useEffect(() => { if (!playing || state !== "loading") return; const t = setTimeout(() => setState((s) => (s === "loading" ? "error" : s)), 45000); return () => clearTimeout(t); }, [playing, state, src, arrived]);
  return <span className="yt-embed drive-video" role="group" aria-label={"Video: " + file.name}>
    {playing
      ? <>{src && <video key={attempt} src={src} controls autoPlay playsInline controlsList="nodownload" onProgress={() => { if (state === "loading") setArrived(Date.now()); }} onCanPlay={() => setState("ready")} onPlaying={() => setState("ready")} onError={() => setState("error")} />}
        {state === "loading" && <span className="drive-video-status" role="status"><span className="drive-spinner" aria-hidden="true" />Streaming from Google Drive…</span>}
        {state === "error" && <span className="drive-video-status is-error" role="alert"><strong>This video didn’t start.</strong><span>Google may still be processing it, or the format can’t play here.</span><span className="drive-video-actions"><button type="button" onClick={start}>Try again</button>{onOpenWeb && <button type="button" onClick={() => onOpenWeb(file)}>Open in Drive</button>}</span></span>}</>
      : <span className="yt-poster" role="button" tabIndex={0} aria-label={"Play " + file.name} onClick={start} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(); } }}>
        {poster ? <img src={"/api/drive/thumb/" + file.id} alt="" onError={() => setPoster(false)} /> : <span className="drive-poster-art" aria-hidden="true" />}
        <span className="drive-head">
          <span className="drive-avatar" aria-hidden="true"><DriveLogo size={22} /></span>
          <span className="drive-head-text"><strong>{file.name.replace(/\.[a-z0-9]{2,4}$/i, "")}</strong><small>Google Drive{file.durationMs ? " · " + minutes(file.durationMs) : ""}</small></span>
        </span>
        <span className="drive-play" aria-hidden="true"><Icon name="playhead" size={28} /></span>
        {onOpenWeb && <button type="button" className="yt-open" onClick={(e) => { e.stopPropagation(); onOpenWeb(file); }}>Open in <DriveLogo size={16} /> Drive</button>}
      </span>}
  </span>;
}

/** How a Drive link reads inside the sentence: a chip with Drive's mark, like YouTube and GitHub links. */
export function DriveChip({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  const inner = <><span className="link-mark" aria-hidden="true"><DriveLogo size={13} /></span><span className="link-label">{children}</span></>;
  return onClick ? <button type="button" className="link-chip drive-chip" onClick={onClick}>{inner}</button> : <span className="link-chip drive-chip">{inner}</span>;
}

/** A Drive document, image or audio file linked in a reply; opens in Clem's viewer, streamed. */
export function DriveCard({ file, label, onOpen }: { file: DriveRef; label?: string; onOpen: (file: DriveRef) => void }) {
  const kind = driveKind(file.mimeType);
  return <button type="button" className="drive-card" onClick={() => onOpen(file)} aria-description={"Open " + file.name}>
    <span className="drive-card-mark"><DriveLogo size={16} /></span>
    <span className="drive-card-text"><strong>{label || file.name}</strong><small>{typeName(file.mimeType)}{file.modified ? " · " + new Date(file.modified).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : ""}</small></span>
    <Icon name={kind === "audio" ? "arrow" : "expand"} size={14} />
  </button>;
}

/** Audio plays inline, like a small player. */
export function DriveAudio({ file }: { file: DriveRef }) {
  const [src, setSrc] = useState("");
  useEffect(() => { void mediaUrl(file.id).then(setSrc).catch(() => {}); }, [file.id]);
  return <figure className="drive-audio"><figcaption><DriveLogo size={13} /><span>{file.name}</span></figcaption>{src ? <audio src={src} controls preload="none" /> : <span className="drive-audio-wait">Connecting to Drive…</span>}</figure>;
}
