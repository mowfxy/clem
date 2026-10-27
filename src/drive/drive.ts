import { useSyncExternalStore } from "react";
import { desktop } from "../desktop/bridge";
import { sourceExcerpts } from "../../core/source-context";
import type { DriveRef } from "../../core/drive-search";

/**
 * Google Drive as the whole app sees it: whether it is connected (checked once in the background when Clem opens,
 * then kept fresh), file text read live when a question needs it, and stream addresses for video. Nothing from Drive
 * is written to this PC; text is kept in memory for this session only.
 */
/** Characters read from one Drive file; each request then sends what fits its budget. */
const DRIVE_TEXT_LIMIT = 2_000_000;
export type DriveItem = DriveRef & { thumbnail?: boolean; path?: string; folder?: boolean };
/** Where a file's Drive copy stands: uploading shows a turning ring, synced a check, failed a mark with Google's reason. */
export type DriveSyncState = { state: "uploading" | "synced" | "failed"; error?: string };
type State = { connected: boolean | null; error?: string };
let state: State = { connected: null };
const listeners = new Set<() => void>();
const set = (next: State) => { if (next.connected === state.connected && next.error === state.error) return; state = next; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
/** `connected` is null until the first check finishes, so nothing flashes a "Connect" screen in the meantime. */
export const useDrive = () => useSyncExternalStore(subscribe, () => state);

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

/** After "Continue with Google" the browser finishes the sign-in; Clem notices on its own and carries on. */
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

/** Saves a file into a Drive folder, straight from this PC. */
export async function uploadToDrive(folder: string, file: Blob, name: string) {
  return desktop!.invoke({ action: "driveUpload", folder, name, type: file.type || "application/octet-stream", data: new Uint8Array(await file.arrayBuffer()) }) as Promise<{ id: string; modifiedTime?: string }>;
}
/** Puts a new version of a file in Drive in place of the old one. A file gone from Drive fails with "no longer in Drive". */
export async function updateInDrive(id: string, file: Blob) {
  return desktop!.invoke({ action: "driveUpdate", id, type: file.type || "application/octet-stream", data: new Uint8Array(await file.arrayBuffer()) }) as Promise<{ id: string; modifiedTime?: string }>;
}
export const renameInDrive = (id: string, name: string) => desktop!.invoke({ action: "driveRename", id, name }) as Promise<{ id: string; name: string; modifiedTime?: string }>;
/** Moves a file to Drive's trash (restorable there for 30 days). */
export const trashInDrive = (id: string) => desktop!.invoke({ action: "driveTrash", id }) as Promise<{ ok: true }>;
/** Moves a file or folder into another folder inside the linked folder `root`. */
export const moveInDrive = (root: string, id: string, to: string) => desktop!.invoke({ action: "driveMove", root, id, to }) as Promise<{ ok: true }>;
/** A Drive file's bytes, so Clem can keep a working copy to edit; Google Docs, Slides and Sheets come as PDF. */
export async function driveBytes(id: string) {
  const r = await fetch("/api/drive/live/" + id);
  if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || "Google Drive did not send the file.");
  return new Blob([await r.arrayBuffer()], { type: (r.headers.get("Content-Type") || "application/octet-stream").split(";")[0] });
}
/** Google's own formats (Docs, Slides, Sheets, Drawings) are read as PDF and cannot take an edited file back. */
export const isGoogleFormat = (mimeType: string) => mimeType.startsWith("application/vnd.google-apps.");
/** Strips Electron's wrapper from errors that come back from the desktop app. */
export const driveError = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "") || "Google Drive did not accept the file.";
export async function driveFolder(folder: string, query = "", refresh = false, limit?: number) {
  return desktop!.invoke({ action: "driveFolder", folder, query: query.slice(0, 4000), refresh, ...(limit ? { limit } : {}) }) as Promise<{ items: DriveItem[]; hits: (DriveRef & { excerpt?: string })[]; checked: number }>;
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
      const { officeText } = await import("../office");
      return (await officeText(new Blob([bytes], { type }), ref.name)).slice(0, DRIVE_TEXT_LIMIT);
    }
    const { extractAttachment } = await import("../desktop/attachment-processing");
    return extractAttachment(bytes, ref.name, type === "application/pdf" || /\.pdf$/i.test(ref.name) ? "application/pdf" : /wordprocessing/.test(type) || /\.docx$/i.test(ref.name) ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : type, DRIVE_TEXT_LIMIT).catch(() => "");
  })().then((text) => { if (text.includes("(a scanned page whose text is not read yet")) texts.delete(key); return text; }, () => { texts.delete(key); return ""; }));
  return texts.get(key)!;
}

/** Excerpts of Drive files for a question, labelled with their names so the model can cite and link them. Their whole
 *  text also goes into `library`, so the model can read past the excerpts ({"action":"read"}) instead of guessing. */
export async function driveSources(refs: DriveRef[], query: string, budget = 14000, max = 6, library?: { name: string; text: string }[]) {
  const readable = refs.filter((r) => !/^(video|audio|image)\//.test(r.mimeType)).slice(0, max);
  const texts = await Promise.all(readable.map(async (r) => ({ name: r.name, text: await driveText(r) })));
  const usable = texts.filter((t) => t.text.trim());
  if (library) for (const t of usable) if (!library.some((f) => f.name === t.name)) library.push(t);
  return usable.length ? sourceExcerpts(usable, query, budget) : "";
}

/** How a Drive file is described to the model so it can link it as [name](drive:ID). */
export const driveList = (refs: DriveRef[]) => refs.map((r, i) => `${i + 1}. id=${r.id} · ${r.name} · ${r.mimeType.replace("application/vnd.google-apps.", "Google ")}${r.durationMs ? ` · ${Math.round(r.durationMs / 60000)} min` : ""}`).join("\n");
