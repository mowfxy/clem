import { useSyncExternalStore } from "react";
import { desktop } from "../desktop/bridge";
import { sourceExcerpts } from "../../core/source-context";
import type { DriveRef } from "../../core/drive-search";

/**
 * Google Drive as the whole app sees it: whether it is connected (checked once in the background when Mowr opens,
 * then kept fresh), file text read live when a question needs it, and stream addresses for video. Nothing from Drive
 * is written to this PC; text is kept in memory for this session only.
 */
export type DriveItem = DriveRef & { thumbnail?: boolean; path?: string; folder?: boolean };
type State = { connected: boolean | null; error?: string };
let state: State = { connected: null };
const listeners = new Set<() => void>();
const set = (next: State) => { if (next.connected === state.connected && next.error === state.error) return; state = next; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
/** `connected` is null until the first check finishes, so nothing flashes a "Connect" screen in the meantime. */
export const useDrive = () => useSyncExternalStore(subscribe, () => state);
export const driveConnected = () => state.connected;

let checking: Promise<void> | null = null;
export function refreshDrive(force = false) {
  if (!desktop) return Promise.resolve();
  if (checking && !force) return checking;
  checking = desktop.invoke({ action: "driveStatus", refresh: force })
    .then((r: { connected: boolean; checked: boolean; error?: string }) => set({ connected: r.checked ? r.connected : state.connected, error: r.error }))
    .catch(() => {})
    .finally(() => { checking = null; });
  return checking;
}

/** After "Continue with Google" the browser finishes the sign-in; Mowr notices on its own and carries on. */
let waiting: ReturnType<typeof setInterval> | undefined;
export async function connectDrive() {
  if (!desktop) return;
  await desktop.invoke({ action: "driveConnect" });
  clearInterval(waiting);
  const started = Date.now();
  waiting = setInterval(() => {
    if (Date.now() - started > 5 * 60_000 || state.connected) { clearInterval(waiting); return; }
    void refreshDrive(true);
  }, 2500);
}
export async function disconnectDrive() {
  const r = await fetch("/api/drive/connection", { method: "DELETE" });
  if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || "Could not disconnect Google Drive.");
  set({ connected: false });
}

export async function listDrive(options: { folder?: string; page?: string; query?: string; kind?: "all" | "folders" }) {
  const r = await desktop!.invoke({ action: "driveList", ...options });
  if (!r.connected) set({ connected: false });
  else if (!state.connected) set({ connected: true });
  return r as { connected: boolean; files: DriveItem[]; next?: string };
}

export async function driveFolder(folder: string, query = "", refresh = false) {
  return desktop!.invoke({ action: "driveFolder", folder, query: query.slice(0, 4000), refresh }) as Promise<{ items: DriveItem[]; hits: (DriveRef & { excerpt?: string })[]; checked: number }>;
}

const media = new Map<string, Promise<string>>();
/** A private 127.0.0.1 address Chromium's media player can stream and seek. */
export function mediaUrl(id: string) {
  if (!media.has(id)) media.set(id, desktop!.invoke({ action: "driveMediaUrl", id }).then((r: { url: string }) => r.url).catch((e) => { media.delete(id); throw e; }));
  return media.get(id)!;
}

const texts = new Map<string, Promise<string>>();
/** A Drive file's text, read live: Drive's own export for Google formats and text; PDFs and Word files are read here in memory. */
export function driveText(ref: DriveRef): Promise<string> {
  const key = ref.id + ":" + (ref.modified || "");
  if (!texts.has(key)) texts.set(key, (async () => {
    const direct = await desktop!.invoke({ action: "driveText", id: ref.id }).then((r: { text?: string }) => r.text).catch(() => undefined);
    if (direct) return direct;
    if (/^(video|audio|image)\//.test(ref.mimeType)) return "";
    if (ref.size && ref.size > 40_000_000) return "";
    const response = await fetch("/api/drive/live/" + ref.id);
    if (!response.ok) return "";
    const bytes = new Uint8Array(await response.arrayBuffer());
    const type = response.headers.get("Content-Type") || ref.mimeType;
    if (/presentationml|spreadsheetml/.test(type) || /\.(pptx|xlsx)$/i.test(ref.name)) {
      const { readOffice } = await import("../office");
      return (await readOffice(new Blob([bytes], { type }))).map((b) => b.text).join("\n").slice(0, 40000);
    }
    const { extractAttachment } = await import("../desktop/attachment-processing");
    return extractAttachment(bytes, ref.name, type === "application/pdf" || /\.pdf$/i.test(ref.name) ? "application/pdf" : /wordprocessing/.test(type) || /\.docx$/i.test(ref.name) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : type).catch(() => "");
  })().catch(() => { texts.delete(key); return ""; }));
  return texts.get(key)!;
}

/** Excerpts of Drive files for a question, labelled with their names so the model can cite and link them. */
export async function driveSources(refs: DriveRef[], query: string, budget = 14000) {
  const readable = refs.filter((r) => !/^(video|audio|image)\//.test(r.mimeType)).slice(0, 6);
  const texts = await Promise.all(readable.map(async (r) => ({ name: r.name, text: await driveText(r) })));
  const usable = texts.filter((t) => t.text.trim());
  return usable.length ? sourceExcerpts(usable, query, budget) : "";
}

/** How a Drive file is described to the model so it can link it as [name](drive:ID). */
export const driveList = (refs: DriveRef[]) => refs.map((r, i) => `${i + 1}. id=${r.id} · ${r.name} · ${r.mimeType.replace("application/vnd.google-apps.", "Google ")}${r.durationMs ? ` · ${Math.round(r.durationMs / 60000)} min` : ""}`).join("\n");
