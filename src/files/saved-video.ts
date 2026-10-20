import { stamp, type VideoCaptions } from "../../core/captions.ts";
import type { SavedVideo, StoredFile } from "../../core/types.ts";
import { desktop } from "../desktop/bridge.ts";
import { youtubePlaylistReference, youtubeReference } from "../youtube.ts";

// A saved YouTube video is an ordinary Markdown file: its title, where it came from and its timestamped transcript.
// Clem reads it like any other file the person keeps (src/source-context.ts), so the AI works from the transcript with
// no special handling; StoredFile.video only changes how the file is shown.

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
export const captionsLabel = (v: SavedVideo) => (v.captions === "own" ? "Transcript" : v.captions === "auto" ? "Auto transcript" : "No transcript");

/** The file's text: a short header the AI and the person can both read, then the transcript. */
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

/** One video's captions, read by the desktop app. In a browser YouTube can't be read, so the video is saved without. */
export async function readVideo(v: PlaylistVideo): Promise<VideoCaptions> {
  const base: VideoCaptions = { source: "youtube", id: v.id, transcript: "", title: v.title, channel: v.channel, durationSec: v.durationSec };
  if (!desktop) return { ...base, error: "Transcripts are read in the Clem desktop app." };
  try {
    const read = (await desktop.invoke({ action: "videoCaptions", source: "youtube", id: v.id, languages: languages() })) as VideoCaptions;
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
 * Reads each video and keeps it as a file: two at a time, in the playlist's order, skipping videos already saved in the
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
    const c = await readVideo(todo[at]);
    if (signal?.aborted) return;
    const blob = new Blob([videoDocument(c, playlist)], { type: "text/markdown" });
    const id = crypto.randomUUID();
    // A video that can't be stored (disk full) stops the run; the ones stored already are still listed.
    try { await store(id, blob); } catch (e) { failed ??= e; return; }
    saved[at] = { id, name: videoFileName(c.title || todo[at].title || "YouTube video"), size: blob.size, type: "text/markdown", created: base - at, spaceId: place, folderId, remote: false, video: videoRecord(c, playlist) };
    onProgress?.({ done: ++done, total: todo.length, title: todo[next]?.title });
    return work();
  };
  await Promise.all([work(), work()]);
  if (failed && !saved.some(Boolean)) throw failed;
  return { files: saved.filter((f): f is StoredFile => !!f), skipped: videos.length - todo.length };
}

/** Reads a saved video's captions again (a video saved while YouTube was unreachable, or captions added since). */
export async function refreshVideo(file: StoredFile, store: (id: string, blob: Blob) => Promise<void>): Promise<StoredFile> {
  const v = file.video!;
  const c = await readVideo({ id: v.id, title: shownName(file), channel: v.channel, durationSec: v.durationSec });
  const blob = new Blob([videoDocument(c, v.playlist)], { type: "text/markdown" });
  await store(file.id, blob);
  return { ...file, size: blob.size, updated: Date.now(), video: videoRecord(c, v.playlist) };
}
