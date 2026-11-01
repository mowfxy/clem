import { useRef, useState } from "react";
import { coordinatorTurn, emptyRoom, modelsOf, runThread, teamOf, toggleReaction, type Ask, type Room } from "../../core/coordinator";
import { entry, forget, parseMemory, remember, serializeMemory, type MemoryEntry } from "../../core/project-memory";
import type { ProjectRoom, RoomMessage, Space } from "../../core/types";
import { getBlob, storeBlob, type State } from "../store";

/** The blob that holds a project's memory file (Markdown, core/project-memory.ts), beside its other files. */
export const projectMemoryId = (spaceId: string) => "project-memory-" + spaceId;

/** Where a reaction goes: a message in the coordinator chat, or in a thread. */
export type MessageRef = { thread?: string; message: string };

/**
 * Projects' coordinator chats, their threads and memory files. Turns keep running when the person leaves the page; each
 * project runs one coordinator turn at a time, and each thread one reply at a time.
 */
export function useProjects({ stateRef, patch, ask, fallbackModel, onError }: {
  stateRef: { current: State };
  patch: (fn: (s: State) => State) => void;
  ask: Ask;
  fallbackModel: () => string | undefined;
  onError: (message: string) => void;
}) {
  const runs = useRef(new Map<string, AbortController>());
  const [busy, setBusy] = useState<Record<string, true>>({});
  const memory = useRef(new Map<string, MemoryEntry[]>());
  const loading = useRef(new Map<string, Promise<MemoryEntry[]>>());
  const writes = useRef(new Map<string, Promise<unknown>>());
  const [, setStamp] = useState(0);

  const roomOf = (s: State, spaceId: string) => (s.rooms || []).find((r) => r.spaceId === spaceId) || emptyRoom(spaceId);
  const setRoom = (spaceId: string, fn: (r: ProjectRoom) => ProjectRoom) => patch((s) => {
    const rooms = s.rooms || [], at = rooms.findIndex((r) => r.spaceId === spaceId);
    const next = fn(at >= 0 ? rooms[at] : emptyRoom(spaceId));
    return { ...s, rooms: at >= 0 ? rooms.map((r, i) => i === at ? next : r) : [...rooms, next] };
  });

  /** The memory file, read once per project and kept here after. */
  function loadMemory(spaceId: string) {
    if (memory.current.has(spaceId)) return Promise.resolve(memory.current.get(spaceId)!);
    if (!loading.current.has(spaceId)) loading.current.set(spaceId, getBlob(projectMemoryId(spaceId)).then((b) => b ? b.text() : "").catch(() => "").then((text) => {
      const list = parseMemory(text);
      if (!memory.current.has(spaceId)) memory.current.set(spaceId, list);
      setStamp((n) => n + 1);
      return memory.current.get(spaceId)!;
    }));
    return loading.current.get(spaceId)!;
  }
  /** Saves the memory file; writes for one project go one after another so an older list never lands last. */
  function saveMemory(space: Space, entries: MemoryEntry[]) {
    memory.current.set(space.id, entries);
    setStamp((n) => n + 1);
    const text = serializeMemory(entries, `${space.name} · project memory`);
    const write = (writes.current.get(space.id) || Promise.resolve()).then(() => storeBlob(projectMemoryId(space.id), new Blob([text], { type: "text/markdown" })));
    writes.current.set(space.id, write.catch(() => onError("The project memory could not be saved. Check disk space.")));
    return write;
  }
  const io = (space: Space): Room => ({
    get: () => roomOf(stateRef.current, space.id),
    set: (fn) => setRoom(space.id, fn),
    memory: () => memory.current.get(space.id) || [],
    saveMemory: (entries) => saveMemory(space, entries),
  });
  const start = (key: string) => { const c = new AbortController(); runs.current.set(key, c); setBusy((b) => ({ ...b, [key]: true })); return c; };
  const finish = (key: string, c: AbortController) => { if (runs.current.get(key) === c) runs.current.delete(key); setBusy((b) => { const n = { ...b }; delete n[key]; return n; }); };
  const failed = (e: unknown, c: AbortController) => { if (!c.signal.aborted) onError((e as Error)?.message || "That didn’t go through. Try again."); };

  async function send(space: Space, text: string) {
    if (runs.current.has(space.id)) return;
    const c = start(space.id);
    const message: RoomMessage = { id: crypto.randomUUID(), from: "you", content: text, at: Date.now() };
    setRoom(space.id, (r) => ({ ...r, messages: [...r.messages, message] }));
    try {
      await loadMemory(space.id);
      await coordinatorTurn(space, modelsOf(teamOf(space), fallbackModel()), message, io(space), ask, c.signal);
    } catch (e) { failed(e, c); }
    finally { finish(space.id, c); }
  }
  /** The person writes in a thread: its subagent answers there. */
  async function reply(space: Space, threadId: string, text: string) {
    const key = "thread:" + threadId;
    if (runs.current.has(key)) return;
    const thread = roomOf(stateRef.current, space.id).threads.find((t) => t.id === threadId);
    if (!thread) return;
    setRoom(space.id, (r) => ({ ...r, threads: r.threads.map((t) => t.id === threadId ? { ...t, updated: Date.now(), messages: [...t.messages, { id: crypto.randomUUID(), from: "you", content: text, at: Date.now() }] } : t) }));
    const c = start(key);
    try { await loadMemory(space.id); await runThread(space, modelsOf(teamOf(space), fallbackModel()).agent, threadId, io(space), ask, c.signal); }
    catch (e) { failed(e, c); }
    finally { finish(key, c); }
  }
  function stop(key: string) {
    runs.current.get(key)?.abort();
    // A coordinator turn also stops the threads it started.
    if (!key.startsWith("thread:")) for (const t of roomOf(stateRef.current, key).threads) if (t.status === "working") runs.current.get("thread:" + t.id)?.abort();
  }
  function react(spaceId: string, ref: MessageRef, emoji: string) {
    const toggle = (m: RoomMessage) => m.id === ref.message ? { ...m, reactions: toggleReaction(m.reactions, emoji, "you") } : m;
    setRoom(spaceId, (r) => ref.thread ? { ...r, threads: r.threads.map((t) => t.id === ref.thread ? { ...t, messages: t.messages.map(toggle) } : t) } : { ...r, messages: r.messages.map(toggle) });
  }
  const memoryActions = (space: Space) => ({
    add: (text: string, tags: string[]) => void saveMemory(space, remember(memory.current.get(space.id) || [], [entry(text, tags)])),
    edit: (id: string, text: string, tags: string[]) => {
      const list = memory.current.get(space.id) || [], at = list.findIndex((e) => e.id === id);
      if (at < 0) return;
      const next = forget(list, id);
      next.splice(at, 0, entry(text, tags));
      void saveMemory(space, next);
    },
    forget: (id: string) => void saveMemory(space, forget(memory.current.get(space.id) || [], id)),
    clear: () => void saveMemory(space, []),
  });
  /** Clears the coordinator chat and threads; the memory file stays. */
  function clearRoom(spaceId: string) { stop(spaceId); patch((s) => ({ ...s, rooms: (s.rooms || []).filter((r) => r.spaceId !== spaceId) })); }

  return {
    busy, send, reply, stop, react, clearRoom, loadMemory, memoryActions,
    memoryOf: (spaceId: string) => memory.current.get(spaceId),
    roomOf: (spaceId: string) => roomOf(stateRef.current, spaceId),
  };
}
