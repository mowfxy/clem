import { stamp, type VideoCaptions } from "../../core/captions.ts";
import type { SavedVideo, StoredFile } from "../../core/types.ts";
import { desktop } from "../desktop/bridge.ts";
import { youtubePlaylistReference, youtubeReference } from "../youtube.ts";

// A saved YouTube video is an ordinary Markdown file: its title, where it came from and its link. No transcript is kept:
// Clem reads the captions when the video is opened (src/files/VideoViewer.tsx) or asked about (src/App.tsx), so they are
// always current and nothing is stored twice. Videos saved before this kept their transcript in the file, and still work
// from it. StoredFile.video only changes how the file is shown.

export type PlaylistVideo = { id: string; title?: string; channel?: string; durationSec?: number };
export type Playlist = { id: string; title?: string; videos: PlaylistVideo[]; error?: string };
export type VideoLink = { video?: ReturnType<typeof youtubeReference>; playlist?: ReturnType<typeof youtubePlaylistReference> };

/** What a pasted address points at: a video, a playlist, or a video played inside a playlist (both). */
export function readVideoLink(value: string): VideoLink | null {
  const text = value.trim();
  const video = youtubeReference(text);
  // A Mix (RD…) is YouTube's endless radio, not a playlist that can be saved: a video opened from one is just the video.
  const listed = youtubePlaylistReference(text), playlist = video && listed?.id.startsWith("RD") ? null : listed;
  return video || playlist ? { ...(video ? { video } : {}), ...(playlist ? { playlist } : {}) } : null;
}

export const watchUrl = (id: string, at = 0) => `https://www.youtube.com/watch?v=${id}${at > 0 ? `&t=${Math.floor(at)}s` : ""}`;
export const thumbnailUrl = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
/** The name a saved video is listed under: its title, without the ".md" its file carries. */
export const shownName = (f: Pick<StoredFile, "name" | "video">) => (f.video ? f.name.replace(/\.md$/i, "") : f.name);
/** A video title as a file name that is safe on Windows. */
export const videoFileName = (title: string) => (title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "YouTube video") + ".md";
export const durationLabel = (sec?: number) => (sec ? stamp(sec) : "");
export const captionsLabel = (v: SavedVideo) => (readsLive(v) ? "Link" : v.captions === "own" ? "Transcript" : v.captions === "auto" ? "Auto transcript" : "No transcript");
/** Saved without a transcript in its file: its captions are read when they are needed. */
export const readsLive = (v?: SavedVideo) => v?.captions === "live" || v?.captions === "none";

/** The file's text: what the video is and where it is. Its captions are read when it is asked about, not kept here. */
export function linkDocument(c: Pick<VideoCaptions, "id" | "title" | "channel" | "durationSec" | "description">, playlist?: { id: string; title: string }) {
  const lines = [
    `# ${c.title || "YouTube video"}`,
    "",
    `YouTube video${c.channel ? ` by ${c.channel}` : ""}${c.durationSec ? ` · ${stamp(c.durationSec)} long` : ""}`,
    `Link: ${watchUrl(c.id)}`,
    ...(playlist ? [`Playlist: ${playlist.title} (https://www.youtube.com/playlist?list=${playlist.id})`] : []),
    "Transcript: not kept in this file. Clem reads the video's captions when it is asked about, and supplies them under VIDEO TRANSCRIPTS.",
  ];
  if (c.description) lines.push("", "## Description", "", "The video's own description, not a transcript:", "", c.description.slice(0, 2000));
  return lines.join("\n") + "\n";
}

/** The text older saves kept: a short header, then the transcript. Still read for files saved that way. */
export function videoDocument(c: VideoCaptions, playlist?: { id: string; title: string }) {
  const lines = [
    `# ${c.title || "YouTube video"}`,
    "",
    `YouTube video${c.channel ? ` by ${c.channel}` : ""}${c.durationSec ? ` · ${stamp(c.durationSec)} long` : ""}`,
    `Link: ${watchUrl(c.id)}`,
    ...(playlist ? [`Playlist: ${playlist.title} (https://www.youtube.com/playlist?list=${playlist.id})`] : []),
    c.transcript
      ? `Captions: ${c.auto ? "automatic (speech recognition, may mishear names and terms)" : "the video's own captions"}${c.language ? ` · ${c.language}` : ""}`
      : `Captions: not available. ${c.error || "This video has no captions Clem can read."} There is no transcript, so what the video says is not in this file.`,
  ];
  if (c.transcript) lines.push("", "## Transcript", "", c.transcript.split("\n").join("\n\n"));
  else if (c.description) lines.push("", "## Description", "", "The video's own description, not a transcript:", "", c.description.slice(0, 5000));
  return lines.join("\n") + "\n";
}

export function linkRecord(c: Pick<VideoCaptions, "id" | "channel" | "durationSec">, playlist?: { id: string; title: string }): SavedVideo {
  return { id: c.id, ...(c.channel ? { channel: c.channel } : {}), ...(c.durationSec ? { durationSec: c.durationSec } : {}), captions: "live", ...(playlist ? { playlist } : {}) };
}

export function videoRecord(c: VideoCaptions, playlist?: { id: string; title: string }): SavedVideo {
  return {
    id: c.id,
    ...(c.channel ? { channel: c.channel } : {}),
    ...(c.durationSec ? { durationSec: c.durationSec } : {}),
    captions: c.transcript ? (c.auto ? "auto" : "own") : "none",
    ...(c.language ? { language: c.language } : {}),
    ...(!c.transcript ? { error: c.error || "This video has no captions Clem can read." } : {}),
    ...(playlist ? { playlist } : {}),
  };
}

/** The transcript of a saved video's file as moments, for the viewer. */
export function transcriptOf(doc: string) {
  const at = doc.indexOf("\n## Transcript");
  if (at < 0) return [];
  const out: { start: number; text: string }[] = [];
  for (const m of doc.slice(at).matchAll(/^\[((?:\d+:)?\d{1,2}:\d{2})\]\s*(.+)$/gm)) {
    const start = m[1].split(":").map(Number).reduce((t, n) => t * 60 + n, 0);
    out.push({ start, text: m[2].trim() });
  }
  return out;
}

const languages = () => [...new Set([navigator.language, "en"])].filter((l) => /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/.test(l));

/** One video's captions (or, with `detailsOnly`, just its title, channel and length), read by the desktop app. In a
 *  browser YouTube can't be read, so only what is already known comes back. */
export async function readVideo(v: PlaylistVideo, { detailsOnly = false }: { detailsOnly?: boolean } = {}): Promise<VideoCaptions> {
  const base: VideoCaptions = { source: "youtube", id: v.id, transcript: "", title: v.title, channel: v.channel, durationSec: v.durationSec };
  if (!desktop) return { ...base, error: "Transcripts are read in the Clem desktop app." };
  try {
    const read = (await desktop.invoke({ action: "videoCaptions", source: "youtube", id: v.id, languages: languages(), ...(detailsOnly ? { detailsOnly: true } : {}) })) as VideoCaptions;
    return { ...read, title: read.title || v.title, channel: read.channel || v.channel, durationSec: read.durationSec || v.durationSec };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "YouTube couldn't be reached." };
  }
}

export async function readPlaylist(id: string): Promise<Playlist> {
  if (!desktop) return { id, videos: [], error: "Playlists can be saved in the Clem desktop app." };
  try { return (await desktop.invoke({ action: "youtubePlaylist", id })) as Playlist; }
  catch (e) { return { id, videos: [], error: e instanceof Error ? e.message : "YouTube couldn't be reached." }; }
}

export type SaveProgress = { done: number; total: number; title?: string };

/**
 * Keeps each video as a file of its details and link (no transcript): two at a time, in the playlist's order, skipping videos already saved in the
 * same place. `store` keeps a file's bytes (src/store.ts storeBlob). Stops between videos when `signal` aborts.
 */
export async function saveVideos(videos: PlaylistVideo[], { place, folderId = null, playlist, existing, store, onProgress, signal }: {
  place: string | null;
  folderId?: string | null;
  playlist?: { id: string; title: string };
  existing: StoredFile[];
  store: (id: string, blob: Blob) => Promise<void>;
  onProgress?: (p: SaveProgress) => void;
  signal?: AbortSignal;
}) {
  const kept = new Set(existing.filter((f) => f.video && f.spaceId === place).map((f) => f.video!.id));
  const todo = videos.filter((v, i) => !kept.has(v.id) && videos.findIndex((x) => x.id === v.id) === i);
  const saved: (StoredFile | undefined)[] = new Array(todo.length);
  // One clock for the whole run: later videos of a playlist are a moment older, so "newest first" keeps its order.
  let next = 0, done = 0, failed: unknown;
  const base = Date.now();
  onProgress?.({ done, total: todo.length, title: todo[0]?.title });
  const work = async (): Promise<void> => {
    const at = next++;
    if (at >= todo.length || signal?.aborted || failed) return;
    // A playlist already lists each video's title, channel and length; a single link is looked up for them.
    const known = !!todo[at].title && !!playlist;
    const c: VideoCaptions = known ? { source: "youtube", id: todo[at].id, transcript: "", title: todo[at].title, channel: todo[at].channel, durationSec: todo[at].durationSec } : await readVideo(todo[at], { detailsOnly: true });
    if (signal?.aborted) return;
    const blob = new Blob([linkDocument(c, playlist)], { type: "text/markdown" });
    const id = crypto.randomUUID();
    // A video that can't be stored (disk full) stops the run; the ones stored already are still listed.
    try { await store(id, blob); } catch (e) { failed ??= e; return; }
    saved[at] = { id, name: videoFileName(c.title || todo[at].title || "YouTube video"), size: blob.size, type: "text/markdown", created: base - at, spaceId: place, folderId, remote: false, video: linkRecord(c, playlist) };
    onProgress?.({ done: ++done, total: todo.length, title: todo[next]?.title });
    return work();
  };
  await Promise.all([work(), work()]);
  if (failed && !saved.some(Boolean)) throw failed;
  return { files: saved.filter((f): f is StoredFile => !!f), skipped: videos.length - todo.length };
}

/** The captions of a saved video, read now and kept nowhere (the viewer and the chat use them as they are). */
export async function liveCaptions(file: StoredFile): Promise<VideoCaptions> {
  const v = file.video!;
  return readVideo({ id: v.id, title: shownName(file), channel: v.channel, durationSec: v.durationSec });
}
