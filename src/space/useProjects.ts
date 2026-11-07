import { useRef, useState } from "react";
import { coordinatorTurn, emptyRoom, modelsOf, reportsWaiting, teamOf, toggleReaction, workThread, type Ask, type Room } from "../../core/coordinator";
import { entry, foldTopics, forget, parseMemory, remember, serializeMemory, type MemoryEntry } from "../../core/project-memory";
import type { ProjectRoom, RoomFile, RoomMessage, Space } from "../../core/types";
import { getBlob, storeBlob, type State } from "../store";

/** The blob that holds a project's memory file (Markdown, core/project-memory.ts), beside its other files. */
export const projectMemoryId = (spaceId: string) => "project-memory-" + spaceId;

/** Where a reaction goes: a message in the coordinator chat, or in a thread. */
export type MessageRef = { thread?: string; message: string };

/**
 * Projects' coordinator chats, their threads and memory files. Turns keep running when the person leaves the page; each
 * project runs one coordinator turn at a time, and each thread one reply at a time. Threads run beside the coordinator, so
 * the person can keep talking to it; when the last one ends, the coordinator answers their reports.
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
      // Older files hold one fact per line. They read as topics at once; the file itself changes on the next save.
      const list = foldTopics(parseMemory(text));
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
  // Only the run that owns the key clears it: a newer run under the same key keeps its busy mark.
  const finish = (key: string, c: AbortController) => { if (runs.current.get(key) !== c) return; runs.current.delete(key); setBusy((b) => { const n = { ...b }; delete n[key]; return n; }); };
  const failed = (e: unknown, c: AbortController) => { if (!c.signal.aborted) onError((e as Error)?.message || "That didn’t go through. Try again."); };

  /** One coordinator reply, then the threads it opened start on their own. */
  async function turn(space: Space, message: RoomMessage | null) {
    const c = start(space.id);
    try {
      await loadMemory(space.id);
      const opened = await coordinatorTurn(space, modelsOf(teamOf(space), fallbackModel()), message, io(space), ask, c.signal);
      for (const id of opened) void work(space, id);
    } catch (e) { failed(e, c); }
    finally { finish(space.id, c); answerReports(space); }
  }
  /** Runs a thread under its own key, so its Stop button reaches it. */
  async function work(space: Space, threadId: string) {
    const key = "thread:" + threadId, c = start(key);
    try { await loadMemory(space.id); await workThread(space, modelsOf(teamOf(space), fallbackModel()).agent, threadId, io(space), ask, c.signal); }
    catch (e) { failed(e, c); }
    finally { finish(key, c); answerReports(space); }
  }
  /** Once the coordinator is free and no thread is left working, it answers what the threads sent. */
  function answerReports(space: Space) {
    const room = roomOf(stateRef.current, space.id);
    if (!runs.current.has(space.id) && !room.threads.some((t) => t.status === "working") && reportsWaiting(room)) void turn(space, null);
  }
  function send(space: Space, text: string, files: RoomFile[] = []) {
    if (runs.current.has(space.id)) return;
    const message: RoomMessage = { id: crypto.randomUUID(), from: "you", content: text, at: Date.now(), ...(files.length ? { files } : {}) };
    setRoom(space.id, (r) => ({ ...r, messages: [...r.messages, message] }));
    return turn(space, message);
  }
  /** The person writes in a thread: its subagent answers there, then tells the coordinator. */
  function reply(space: Space, threadId: string, text: string, files: RoomFile[] = []) {
    if (runs.current.has("thread:" + threadId)) return;
    if (!roomOf(stateRef.current, space.id).threads.some((t) => t.id === threadId)) return;
    setRoom(space.id, (r) => ({ ...r, threads: r.threads.map((t) => t.id === threadId ? { ...t, updated: Date.now(), messages: [...t.messages, { id: crypto.randomUUID(), from: "you", content: text, at: Date.now(), ...(files.length ? { files } : {}) }] } : t) }));
    return work(space, threadId);
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
      // An edit that now says what another line says replaces both with one (ids come from the text).
      const fact = entry(text, tags), next = list.filter((e) => e.id !== id && e.id !== fact.id);
      next.splice(Math.min(at, next.length), 0, fact);
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
