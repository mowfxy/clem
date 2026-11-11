import { desktop } from "./desktop/bridge.ts";
import { withoutTemporary } from "../core/temporary-chat.ts";
import { settleRoom } from "../core/coordinator.ts";
import { get, set, del } from "idb-keyval";
import type {
  Chat,
  Space,
  StoredFile,
  Skill,
  VisualRecord,
  Automation,
  StudySet,
  FileVersion,
  ProjectRoom,
} from "../core/types";
import type { SpacePlan } from "../core/plans";
import type { UsageArchive } from "./settings/UsageSettings";
export type State = {
  studySets: StudySet[];
  /** One plan per subject or project at most (core/plans.ts). Absent in workspaces saved before plans existed. */
  plans?: SpacePlan[];
  /** Each project's coordinator chat and its threads (core/coordinator.ts). Absent in workspaces saved before them. */
  rooms?: ProjectRoom[];
  essentialNotes?: { id: string; text: string }[];
  /**
   * This workspace did not come from the last sync: its file was missing and it started again. The sync baseline says
   * what the skills and notes held then, so an empty list here would read as the person deleting everything. Saved with
   * the workspace, so it lasts until a sync has worked, and cleared by that sync (src/essential-state.ts).
   */
  essentialsUnsynced?: boolean;
  chats: Chat[];
  spaces: Space[];
  files: StoredFile[];
  skills: Skill[];
  visuals: VisualRecord[];
  automations: Automation[];
  avatar?: string;
  /** Usage totals of deleted chats, so the Usage tab keeps counting them (src/settings/UsageSettings.tsx). */
  usageArchive?: UsageArchive;
  name: string;
  memory: string;
  quiet: boolean;
  /** Clem's organizer (Settings → Proactivity): the model that runs the main thread and Clem's own jobs. Unset: the default model. */
  organizer?: { model?: string; reasoning?: string };
  /** One-time workspace migrations already applied (core/main-thread/migrate.ts). */
  migrations?: string[];
};
export const emptyState: State = {
  studySets: [],
  plans: [],
  chats: [],
  spaces: [],
  files: [],
  skills: [],
  visuals: [],
  automations: [],
  name: "Thinker",
  memory: "",
  quiet: false,
};
let namespace = "guest";
/** The signed-in owner the stores on this device are keyed by ("guest" before sign-in). */
export const storageNamespace = () => namespace;
export function setStorageNamespace(value: string) {
  namespace = value;
}
const stateKey = (ns = namespace) =>
  ns === "guest" ? "clem-state-v1" : `clem-state-${ns}`;
const blobKey = (id: string, owner = namespace) =>
  owner === "guest" ? `file-${id}` : `file-${owner}-${id}`;
async function local(
  path: string,
  method = "GET",
  body?: BodyInit,
  owner = namespace,
) {
  if (owner !== namespace) throw Error("Account changed. Try again.");
  const response = await fetch("/api/local/" + path, {
    method,
    body,
    headers: { "X-Clem-Owner": owner },
  });
  if (!response.ok)
    throw Error(
      "Could not access local workspace. Check disk space and permissions.",
    );
  return response;
}
function restoreState(value: unknown): State {
  if (!value || typeof value !== "object")
    throw Error("Invalid workspace data.");
  const saved = value as Record<string, unknown>;
  for (const key of [
    "chats",
    "spaces",
    "files",
    "skills",
    "visuals",
    "automations",
  ])
    if (!Array.isArray(saved[key]))
      throw Error(
        "Your saved workspace is incomplete. Restore a backup before continuing.",
      );
  if (typeof saved.name !== "string" || typeof saved.memory !== "string")
    throw Error("Invalid workspace settings.");
  const state = { ...structuredClone(emptyState), ...saved } as State;
  // A project reply or thread cut off when the app closed is shown as stopped, not as still working.
  if (Array.isArray(state.rooms)) state.rooms = state.rooms.map(settleRoom);
  // 0.3.6 filed uploads sent in a subject or project chat under it. Sent files belong in the normal Files tab; ones kept
  // there on request carry no chat, so a file still tagged with its chat is moved back.
  const sent = new Set(state.files.filter((f) => f.chatId && !f.made && f.spaceId).map((f) => f.id));
  if (!sent.size) return state;
  return { ...state, files: state.files.map((f) => (sent.has(f.id) ? { ...f, spaceId: null, folderId: null } : f)), spaces: state.spaces.map((s) => ({ ...s, sources: s.sources.filter((id) => !sent.has(id)) })) };
}
export async function loadState(): Promise<State> {
  const owner = namespace;
  if (desktop) {
    const saved = await (await local("state", "GET", undefined, owner)).json();
    if (saved) return restoreState(saved);
    const legacy = await get<State>(stateKey(owner));
    // No workspace on disk or in the browser: it starts again, marked so a sync does not read empty lists as deletions.
    if (!legacy) return { ...structuredClone(emptyState), essentialsUnsynced: true };
    // Validated and migrated like any saved workspace, so the copy moved to disk is the one the app then uses.
    const restored = restoreState(legacy);
    for (const file of legacy.files) {
      const blob = await get<Blob>(blobKey(file.id, owner));
      if (blob) await local("files/" + file.id, "PUT", blob, owner);
    }
    await local("state", "PUT", JSON.stringify(restored), owner);
    return restored;
  }
  const stored = await get<State>(stateKey(owner));
  return stored ? restoreState(stored) : structuredClone(emptyState);
}
export async function saveState(state: State, ns = namespace) {
  state = withoutTemporary(state);
  if (desktop) {
    if (ns !== namespace) throw Error("Account changed before saving.");
    await local("state", "PUT", JSON.stringify(state));
  } else await set(stateKey(ns), state);
}
export async function storeBlob(id: string, file: Blob, owner = namespace) {
  if (owner !== namespace) throw Error("Account changed. Try again.");
  if (desktop) await local("files/" + id, "PUT", file, owner);
  else await set(blobKey(id), file);
  // The file's text changed: drop its cached extracted text.
  await del(`clem-source:${owner}:${id}`);
}
export async function getBlob(id: string) {
  // GUC CMS files ("guc_<material>") are fetched by the engine for viewing; Google Drive files shown in chat are
  // streamed into memory. Neither is written to the workspace.
  if (desktop && id.startsWith("guc_")) {
    const response = await fetch("/api/local/guc/file/" + id.slice(4), { headers: { "X-Clem-Owner": namespace } });
    if (!response.ok) throw Error((await response.json().catch(() => ({}))).error || "This CMS file could not be opened.");
    return response.blob();
  }
  if (desktop && id.startsWith("drive_")) {
    const response = await fetch("/api/drive/live/" + id.slice(6));
    if (!response.ok) throw Error((await response.json().catch(() => ({}))).error || "This Drive file could not be opened.");
    return response.blob();
  }
  if (desktop) {
    const response = await fetch("/api/local/files/" + id, {
      headers: { "X-Clem-Owner": namespace },
    });
    if (response.status === 404) return undefined;
    if (!response.ok) throw Error("Could not read this local file.");
    return response.blob();
  }
  const local = await get<Blob>(blobKey(id));
  if (local) return local;
  if (namespace === "guest") return undefined;
  const r = await fetch("/api/files/" + id);
  if (!r.ok) return undefined;
  const { url } = await r.json();
  const remote = await fetch(url);
  if (!remote.ok)
    throw new Error("File download failed. Check storage CORS configuration.");
  return remote.blob();
}
export async function deleteBlob(id: string, owner = namespace) {
  if (owner !== namespace) throw Error("Account changed. Try again.");
  if (desktop) await local("files/" + id, "DELETE", undefined, owner);
  await del(blobKey(id, owner));
  await del("clem-document-" + id);
  await del(`clem-source:${owner}:${id}`);
}
/** How many earlier versions of a file are kept for Undo. */
export const VERSIONS_KEPT = 20;
/** A file's versions with `version` first; the ones past the limit are dropped from the list and deleted from disk,
 *  so revising a file many times does not leave its old copies behind. */
export function addVersion(versions: FileVersion[] | undefined, version: FileVersion) {
  const all = [version, ...(versions || [])];
  for (const old of all.slice(VERSIONS_KEPT)) for (const id of [old.blob, "spec-" + old.blob]) void deleteBlob(id).catch(() => {});
  return all.slice(0, VERSIONS_KEPT);
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const sizeLabel = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(2)} GB`
    : bytes >= 1e6
      ? `${(bytes / 1e6).toFixed(1)} MB`
      : bytes >= 1e3
        ? `${(bytes / 1e3).toFixed(1)} KB`
        : `${Math.max(0, Math.round(bytes))} bytes`;

export async function downloadMade(blob: Blob, name: string) {
  const { markContent } = await import("../core/provenance");
  download(await markContent(blob, name), name);
}
