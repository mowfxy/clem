import { desktop } from "./desktop/bridge";
import { withoutTemporary } from "../core/temporary-chat";
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
} from "../core/types";
import type { SpacePlan } from "../core/plans";
import type { UsageArchive } from "./settings/UsageSettings";
export type State = {
  studySets: StudySet[];
  /** One plan per subject or project at most (core/plans.ts). Absent in workspaces saved before plans existed. */
  plans?: SpacePlan[];
  essentialNotes?: { id: string; text: string }[];
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
  return { ...structuredClone(emptyState), ...saved } as State;
}
export async function loadState(): Promise<State> {
  const owner = namespace;
  if (desktop) {
    const saved = await (await local("state", "GET", undefined, owner)).json();
    if (saved) return restoreState(saved);
    const legacy = await get<State>(stateKey(owner));
    if (legacy) {
      restoreState(legacy);
      for (const file of legacy.files) {
        const blob = await get<Blob>(blobKey(file.id, owner));
        if (blob) await local("files/" + file.id, "PUT", blob, owner);
      }
      await local("state", "PUT", JSON.stringify(legacy), owner);
    }
    return { ...structuredClone(emptyState), ...legacy };
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
  // Google Drive files shown in chat are streamed into memory for viewing and never written to this PC.
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
