import {decodeEntities, parseCaptions, pickTrack, transcriptText, type CaptionTrack, type VideoCaptions} from "../core/captions.ts";

// YouTube captions, read from the main process (the page can't: YouTube doesn't allow cross-origin reads). Same route
// the maintained open-source transcript tools use: the watch page gives the Innertube key, the Android player endpoint
// lists caption tracks whose URLs work without a browser session, and the track itself is timed-text XML.

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const ANDROID = {client: {clientName: "ANDROID", clientVersion: "20.10.38", hl: "en"}};

type PlayerResponse = {
  playabilityStatus?: {status?: string; reason?: string};
  videoDetails?: {title?: string; author?: string; lengthSeconds?: string; shortDescription?: string};
  captions?: {playerCaptionsTracklistRenderer?: {captionTracks?: {baseUrl?: string; languageCode?: string; kind?: string; name?: {simpleText?: string; runs?: {text?: string}[]}}[]}};
};

class Unavailable extends Error {}

/** The JSON object assigned after `marker` in a page, read by matching braces (the page has more script after it). */
export function embeddedJson(html: string, marker: string): unknown {
  const at = html.indexOf(marker);
  if (at < 0) return undefined;
  const start = html.indexOf("{", at);
  let depth = 0, quote = "", escaped = false;
  for (let i = start; i < html.length && i - start < 5_000_000; i++) {
    const ch = html[i];
    if (quote) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === quote) quote = ""; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return undefined; } }
  }
  return undefined;
}

function tracksOf(player: PlayerResponse | undefined): CaptionTrack[] {
  return (player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || []).filter((t) => t.baseUrl).map((t) => ({
    url: t.baseUrl!.replace(/&fmt=srv3\b/, ""),
    lang: t.languageCode || "",
    name: t.name?.simpleText || t.name?.runs?.map((r) => r.text).join("") || undefined,
    auto: t.kind === "asr",
  }));
}

function whyUnplayable(player: PlayerResponse | undefined) {
  const status = player?.playabilityStatus?.status, reason = player?.playabilityStatus?.reason || "";
  if (!status || status === "OK") return "";
  if (/inappropriate|age|sign in to confirm your age/i.test(reason)) return "YouTube only shows this video to signed-in adults, so Mowr can't read its captions.";
  if (/private/i.test(reason)) return "This video is private.";
  if (/bot|sign in to confirm/i.test(reason)) return "YouTube is asking this network to prove it isn't a bot, so captions can't be read right now. Try again later.";
  return reason ? `YouTube says: ${reason}` : "YouTube won't play this video here.";
}

/** Captions of one YouTube video as a timestamped transcript. Never throws: problems come back as `error`. */
export async function youtubeCaptions(id: string, {fetcher = fetch, languages = ["en"], signal}: {fetcher?: typeof fetch; languages?: string[]; signal?: AbortSignal} = {}): Promise<VideoCaptions> {
  const result: VideoCaptions = {source: "youtube", id, transcript: ""};
  if (!/^[\w-]{11}$/.test(id)) return {...result, error: "That isn't a YouTube video address."};
  const timeout = () => AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]);
  try {
    let cookie = "CONSENT=YES+cb; SOCS=CAI";
    const page = async () => {
      const r = await fetcher(`https://www.youtube.com/watch?v=${id}&hl=en`, {headers: {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: cookie}, signal: timeout()});
      if (r.status === 429) throw new Unavailable("YouTube is limiting requests from this network right now. Try again in a few minutes.");
      return r.text();
    };
    let html = await page();
    // Europe: a consent page comes first; accepting it is a cookie.
    const consent = html.includes('action="https://consent.youtube.com/s"') && /name="v" value="(.*?)"/.exec(html)?.[1];
    if (consent) { cookie = `CONSENT=YES+${consent}; SOCS=CAI`; html = await page(); }
    if (html.includes('class="g-recaptcha"')) throw new Unavailable("YouTube is asking this network to prove it isn't a bot, so captions can't be read right now. Try again later.");
    const pagePlayer = embeddedJson(html, "ytInitialPlayerResponse") as PlayerResponse | undefined;
    const key = /"INNERTUBE_API_KEY":\s*"([\w-]+)"/.exec(html)?.[1];
    let player: PlayerResponse | undefined;
    if (key) {
      const r = await fetcher(`https://www.youtube.com/youtubei/v1/player?key=${key}&prettyPrint=false`, {
        method: "POST", headers: {"Content-Type": "application/json", "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: cookie},
        body: JSON.stringify({context: ANDROID, videoId: id}), signal: timeout(),
      });
      if (r.status === 429) throw new Unavailable("YouTube is limiting requests from this network right now. Try again in a few minutes.");
      if (r.ok) player = await r.json() as PlayerResponse;
    }
    const details = player?.videoDetails || pagePlayer?.videoDetails;
    Object.assign(result, {
      title: details?.title ? decodeEntities(details.title) : undefined, channel: details?.author,
      durationSec: Number(details?.lengthSeconds) || undefined, description: details?.shortDescription || undefined,
    });
    const tracks = tracksOf(player);
    const fallback = tracksOf(pagePlayer).filter((t) => !tracks.some((x) => x.lang === t.lang && x.auto === t.auto));
    if (!tracks.length && !fallback.length) {
      const why = whyUnplayable(player) || whyUnplayable(pagePlayer);
      if (why) throw new Unavailable(why);
      if (!details) throw new Unavailable("YouTube didn't return this video. It may have been removed.");
      throw new Unavailable("This video has no captions, and its owner hasn't turned on automatic ones.");
    }
    // Android-client tracks first (they work without a browser session), then the page's own as a fallback.
    for (const track of [...pickTrack(tracks, languages), ...pickTrack(fallback, languages)].slice(0, 4)) {
      const r = await fetcher(track.url, {headers: {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: cookie}, signal: timeout()}).catch(() => null);
      if (!r?.ok) continue;
      const cues = parseCaptions(await r.text());
      if (!cues.length) continue;
      return {...result, transcript: transcriptText(cues), language: track.name || track.lang, auto: track.auto};
    }
    throw new Unavailable("YouTube listed captions for this video but wouldn't send them. Try again in a minute.");
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Unavailable ? error.message : (error as Error).name === "TimeoutError" ? "YouTube took too long to answer." : "YouTube couldn't be reached.";
    return {...result, error: message};
  }
}

/** One video of a playlist, as the playlist page lists it. */
export type PlaylistVideo = {id: string; title?: string; channel?: string; durationSec?: number};
export type Playlist = {id: string; title?: string; videos: PlaylistVideo[]; error?: string};
/** The most videos one save takes from a playlist; the person is told when a playlist is longer. */
export const PLAYLIST_LIMIT = 100;

const text = (t: any): string | undefined => typeof t === "string" ? t : t?.simpleText ?? t?.content ?? (Array.isArray(t?.runs) ? t.runs.map((r: any) => r?.text || "").join("") : undefined);

/** The videos, title and next-page token of a playlist page or a continuation of it. YouTube serves two layouts (the
 *  older playlistVideoRenderer and the newer lockupViewModel), so both are walked for. */
export function playlistFromData(data: unknown) {
  const videos: PlaylistVideo[] = [];
  let title: string | undefined, next: string | undefined;
  const seen = new Set<string>();
  const add = (v: PlaylistVideo) => { if (/^[\w-]{11}$/.test(v.id) && !seen.has(v.id)) { seen.add(v.id); videos.push(v); } };
  const walk = (node: any, depth: number): void => {
    if (!node || typeof node !== "object" || depth > 40) return;
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    const old = node.playlistVideoRenderer;
    if (old?.videoId) { if (old.isPlayable !== false) add({id: old.videoId, title: text(old.title), channel: text(old.shortBylineText), durationSec: Number(old.lengthSeconds) || undefined}); return; }
    const lockup = node.lockupViewModel;
    if (lockup?.contentId && (!lockup.contentType || lockup.contentType === "LOCKUP_CONTENT_TYPE_VIDEO")) {
      const meta = lockup.metadata?.lockupMetadataViewModel;
      const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts || [];
      add({id: lockup.contentId, title: text(meta?.title), channel: text(rows[0]?.text)});
      return;
    }
    if (node.playlistMetadataRenderer?.title) title ??= text(node.playlistMetadataRenderer.title);
    if (node.playlistHeaderRenderer?.title) title ??= text(node.playlistHeaderRenderer.title);
    const token = node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (typeof token === "string") next = token;
    for (const key of Object.keys(node)) walk(node[key], depth + 1);
  };
  walk(data, 0);
  return {title: title ? decodeEntities(title) : undefined, videos: videos.map((v) => ({...v, title: v.title ? decodeEntities(v.title) : undefined})), next};
}

/** The videos of a public or unlisted YouTube playlist, in its order, up to PLAYLIST_LIMIT. Never throws. */
export async function youtubePlaylist(id: string, {fetcher = fetch, signal}: {fetcher?: typeof fetch; signal?: AbortSignal} = {}): Promise<Playlist> {
  const result: Playlist = {id, videos: []};
  if (!/^[\w-]{10,64}$/.test(id)) return {...result, error: "That isn't a YouTube playlist address."};
  // Mixes ("RD…") are made for each viewer and have no page of their own.
  if (id.startsWith("RD")) return {...result, error: "YouTube mixes can't be saved. Save a playlist or the videos one by one."};
  const timeout = () => AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]);
  try {
    let cookie = "CONSENT=YES+cb; SOCS=CAI";
    const page = async () => {
      const r = await fetcher(`https://www.youtube.com/playlist?list=${id}&hl=en`, {headers: {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: cookie}, signal: timeout()});
      if (r.status === 429) throw new Unavailable("YouTube is limiting requests from this network right now. Try again in a few minutes.");
      return r.text();
    };
    let html = await page();
    const consent = html.includes('action="https://consent.youtube.com/s"') && /name="v" value="(.*?)"/.exec(html)?.[1];
    if (consent) { cookie = `CONSENT=YES+${consent}; SOCS=CAI`; html = await page(); }
    if (html.includes('class="g-recaptcha"')) throw new Unavailable("YouTube is asking this network to prove it isn't a bot. Try again later.");
    const first = playlistFromData(embeddedJson(html, "ytInitialData"));
    Object.assign(result, {title: first.title, videos: first.videos});
    if (!first.videos.length) throw new Unavailable(/"alerts"[\s\S]{0,400}(does not exist|private)/i.test(html) ? "This playlist is private or doesn't exist." : "YouTube didn't list any videos in this playlist.");
    // Longer playlists come a page at a time.
    const key = /"INNERTUBE_API_KEY":\s*"([\w-]+)"/.exec(html)?.[1], version = /"INNERTUBE_CLIENT_VERSION":\s*"([\d.]+)"/.exec(html)?.[1] || "2.20250101.00.00";
    let next = first.next;
    while (key && next && result.videos.length < PLAYLIST_LIMIT) {
      const r = await fetcher(`https://www.youtube.com/youtubei/v1/browse?key=${key}&prettyPrint=false`, {
        method: "POST", headers: {"Content-Type": "application/json", "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Cookie: cookie},
        body: JSON.stringify({context: {client: {clientName: "WEB", clientVersion: version, hl: "en"}}, continuation: next}), signal: timeout(),
      }).catch(() => null);
      if (!r?.ok) break;
      const more = playlistFromData(await r.json());
      const fresh = more.videos.filter((v) => !result.videos.some((x) => x.id === v.id));
      if (!fresh.length) break;
      result.videos.push(...fresh);
      next = more.next;
    }
    result.videos = result.videos.slice(0, PLAYLIST_LIMIT);
    return result;
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Unavailable ? error.message : (error as Error).name === "TimeoutError" ? "YouTube took too long to answer." : "YouTube couldn't be reached.";
    return {...result, error: message};
  }
}
