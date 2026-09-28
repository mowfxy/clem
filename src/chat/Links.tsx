import { useState, type ReactNode } from "react";
import { youtubeReference } from "../youtube";
import { DriveLogo, GitHubLogo, YouTubeLogo } from "../BrandLogos";
import { Icon } from "../Icons";
import "../youtube.css";

type Brand = { name: string; mark: ReactNode };
const globe = <Icon name="globe" size={13} />;

function brandOf(url: URL): Brand | null {
  const host = url.hostname.replace(/^www\./, "");
  if (youtubeReference(url.href) || /(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return { name: "YouTube", mark: <YouTubeLogo size={14} /> };
  if (/(^|\.)github\.com$|githubusercontent\.com$/.test(host)) return { name: "GitHub", mark: <GitHubLogo size={13} /> };
  if (/^(drive|docs)\.google\.com$/.test(host)) return { name: "Google Drive", mark: <DriveLogo size={13} /> };
  return null;
}

/** "github.com/openai/codex/blob/main/README.md" → "github.com/openai/codex/…/README.md" */
export function shortUrl(url: URL) {
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  let path = parts.join("/");
  if (parts.length > 3) path = [parts[0], parts[1], "…", parts[parts.length - 1]].join("/");
  if (path.length > 38) path = path.slice(0, 36) + "…";
  return host + (path ? "/" + path : "");
}

const textOf = (children: ReactNode): string => Array.isArray(children) ? children.map(textOf).join("") : typeof children === "string" || typeof children === "number" ? String(children) : "";

/** A link shown as its site's mark and a short, readable label. */
export function LinkChip({ href, children }: { href: string; children?: ReactNode }) {
  let url: URL;
  try { url = new URL(href); } catch { return <a href={href} target="_blank" rel="noopener">{children || href}</a>; }
  if (!/^https?:$/.test(url.protocol)) return <a href={href} target="_blank" rel="noopener">{children || href}</a>;
  const brand = brandOf(url);
  const text = textOf(children).trim();
  const bare = !text || text === href || text.replace(/\/$/, "") === href.replace(/\/$/, "") || /^https?:\/\//.test(text);
  const label = bare ? (brand && brand.name !== "Google Drive" && brand.name !== "GitHub" ? brand.name : shortUrl(url)) : children;
  return <a className="link-chip" href={url.href} target="_blank" rel="noopener" title={url.href}>
    <span className="link-mark" aria-hidden="true">{brand?.mark || globe}</span><span className="link-label">{label}</span>
  </a>;
}

/** Plain text with any web addresses turned into link chips (for the person's own messages). */
export function LinkifiedText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  const pattern = /https?:\/\/[^\s<>"'`]+[^\s<>"'`.,;:!?)\]}]/g;
  let last = 0, match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(<LinkChip key={match.index} href={match[0]} />);
    last = match.index + match[0].length;
  }
  if (!out.length) return <>{text}</>;
  if (last < text.length) out.push(text.slice(last));
  const videos = videosIn({ children: (text.match(pattern) || []).map((href) => ({ tagName: "a", properties: { href } })) });
  return <>{out}{videos.length > 0 && <span className="inline-videos">{videos.map((v) => <YouTubeEmbed key={v} href={v} />)}</span>}</>;
}

/** A YouTube video that plays right in the conversation. Nothing loads from YouTube until Play. */
export function YouTubeEmbed({ href }: { href: string }) {
  const video = youtubeReference(href);
  const [playing, setPlaying] = useState(false);
  if (!video) return null;
  return <span className="yt-embed" role="group" aria-label="YouTube video">
    {playing
      ? <iframe title="YouTube video player" src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&start=${video.start}&playsinline=1&rel=0`} referrerPolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen />
      : <span className="yt-poster" role="button" tabIndex={0} aria-label="Play video" onClick={() => setPlaying(true)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPlaying(true); } }}>
        <img src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" loading="lazy" referrerPolicy="no-referrer" />
        <span className="yt-play" aria-hidden="true"><YouTubeLogo size={64} /></span>
        <a className="yt-open" href={video.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>Watch on <YouTubeLogo size={16} /> YouTube</a>
      </span>}
  </span>;
}

/** YouTube videos linked inside a block of rendered markdown, in order and without repeats. */
export function videosIn(node: unknown): string[] {
  const found: string[] = [];
  const walk = (n: { tagName?: string; properties?: { href?: unknown }; children?: unknown[] }) => {
    if (n?.tagName === "a" && typeof n.properties?.href === "string") { const v = youtubeReference(n.properties.href); if (v && !found.some((f) => youtubeReference(f)?.id === v.id)) found.push(v.url); }
    for (const child of n?.children || []) walk(child as typeof n);
  };
  walk(node as never);
  return found;
}
