import { readPlanBlock, newPlan, type SpacePlan } from "../core/plans";
import { set } from "idb-keyval";
import {
  packSubject,
  unpackSubject,
  type SubjectArchive,
} from "../core/subject-archive";
import { getBlob, storeBlob, deleteBlob, download, type State } from "./store";
import type { Space } from "../core/types";
import { loadEdits } from "./document-state";
export async function exportSubject(state: State, space: Space) {
  const chats = state.chats.filter((c) => c.spaceId === space.id),
    ids = new Set([
      ...space.sources,
      ...chats.flatMap((c) => c.messages.flatMap((m) => m.attachments || [])),
    ]);
  const files = state.files.filter(
    (f) => f.spaceId === space.id || ids.has(f.id),
  );
  const blobs: Record<string, Uint8Array> = {},
    edits: SubjectArchive["edits"] = {};
  for (const file of files) {
    const blob = await getBlob(file.id);
    if (!blob) throw Error("Cannot export: " + file.name + " is missing.");
    blobs[file.id] = new Uint8Array(await blob.arrayBuffer());
    edits[file.id] = await loadEdits(file);
  }
  const manifest: SubjectArchive = {
    format: "mowr-subject",
    version: 1,
    space: { ...space, kind: "subject" },
    files: files.map((f) => ({ ...f, size: blobs[f.id].length })),
    chats,
    studySets: state.studySets.filter((s) => s.spaceId === space.id),
    spacePlan: planForArchive((state.plans || []).find((p) => p.spaceId === space.id)),
    edits,
  };
  const bytes = await packSubject(manifest, blobs);
  download(
    new Blob([bytes], { type: "application/zip" }),
    space.name.replace(/[<>:"/\\|?*]/g, "-") + ".mowr.zip",
  );
}
export async function importSubject(file: File, owner: string) {
  const { manifest, files } = await unpackSubject(
    new Uint8Array(await file.arrayBuffer()),
  );
  const newId = () => crypto.randomUUID(),
    spaceId = newId(),
    fileIds = new Map(manifest.files.map((f) => [f.id, newId()])),
    folderIds = new Map((manifest.space.folders || []).map((f) => [f.id, newId()])),
    chatIds = new Map(manifest.chats.map((c) => [c.id, newId()]));
  const addedFiles = manifest.files.map((f) => ({
    ...f,
    id: fileIds.get(f.id)!,
    spaceId,
    folderId: f.folderId ? folderIds.get(f.folderId) ?? null : null,
    remote: false,
  }));
  const written: string[] = [];
  try {
    for (const f of manifest.files) {
      const id = fileIds.get(f.id)!;
      written.push(id);
      await storeBlob(
        id,
        new Blob([new Uint8Array(files[f.id])], { type: f.type }),
        owner,
      );
      if (manifest.edits[f.id])
        await set("mowr-document-" + id, manifest.edits[f.id]);
    }
  } catch (error) {
    await Promise.allSettled(written.map((id) => deleteBlob(id, owner)));
    throw error;
  }
  return {
    space: {
      ...manifest.space,
      id: spaceId,
      // Within the instructions editor's limit, which also keeps the note inside the sync schema (30 000 characters).
      memory: manifest.space.memory.slice(0, 8000),
      folders: manifest.space.folders?.map((f) => ({ ...f, id: folderIds.get(f.id)!, parentId: f.parentId ? folderIds.get(f.parentId) ?? null : null })),
      sources: manifest.space.sources.flatMap((id) =>
        fileIds.has(id) ? [fileIds.get(id)!] : [],
      ),
    },
    files: addedFiles,
    chats: manifest.chats.map((c) => ({
      ...c,
      id: chatIds.get(c.id)!,
      spaceId,
      messages: c.messages.map((m) => ({
        ...m,
        id: newId(),
        attachments: m.attachments?.flatMap((id) =>
          fileIds.has(id) ? [fileIds.get(id)!] : [],
        ),
        plan: m.plan
          ? {
              ...m.plan,
              id: newId(),
              approved: false,
              tasks: m.plan.tasks.map((t) => ({
                ...t,
                status:
                  t.status === "running" ? ("pending" as const) : t.status,
              })),
            }
          : undefined,
      })),
    })),
    studySets: manifest.studySets.map((s) => ({
      ...s,
      id: newId(),
      spaceId,
      chatId: s.chatId ? chatIds.get(s.chatId) : undefined,
    })),
    plan: planFromArchive(manifest.spacePlan, spaceId),
  };
}
/** A plan as the archive keeps it: the same shape the model writes, with when each task was done. */
function planForArchive(plan: SpacePlan | undefined) {
  if (!plan) return undefined;
  return { action: "create", title: plan.title, goal: plan.goal, start: plan.start, tasks: plan.tasks.map(({ done, ...t }) => ({ ...t, ...(done ? { done: true, doneAt: done } : {}) })) };
}
function planFromArchive(raw: unknown, spaceId: string): SpacePlan | undefined {
  if (!raw) return undefined;
  const block = readPlanBlock(JSON.stringify(raw));
  return block?.action === "create" ? newPlan(spaceId, block) : undefined;
}
