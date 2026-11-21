// Clem's agent on the VPS worker (docs/GUC-VPS-ENGINE.md "Workspace on the VPS"): with the worker holding the lease, a
// Telegram message is answered here by the Telegram main thread (desktop/telegram-thread.ts), the same code, guide and
// actions as the window's (core/telegram/thread.ts): the person's day and term, never study questions or files. What
// it changes goes into the worker's copy of the workspace (WorkerWorkspace), from where the desktop picks it up. Due
// routines run here too, as the window runs them. The model is the server's own (an API key, or the Claude Code or
// Codex CLI Clem signed in there).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { nextAutomation } from "../../../core/automation-schedule.ts";
import { mainThreadOf, putMessage } from "../../../core/workspace/apply.ts";
import { ownTurn, telegramTurn, type OwnBrief, type ThreadDeps } from "../../telegram-thread.ts";
import { runThreadTool, threadBefore, type ThreadVps } from "../thread-tools.ts";
import type { VpsAsk } from "../../../core/vps/ask.ts";
import type { StoredFile } from "../../../core/types.ts";
import { sha256 } from "../storage.ts";
import type { Engine } from "../index.ts";
import type { TelegramTurn } from "../host.ts";
import type { Complete } from "./headless.ts";
import type { WorkerState } from "./state.ts";
import type { WorkerWorkspace, WsState } from "./workspace.ts";

/** Where a workspace file's bytes are on the VPS (the desktop says so in its push). */
export type FileBlob = { sha256: string; ext: string; size: number };
/** A workspace file as the worker's copy has it: `blob` on the VPS, `inline` bytes kept for the PC past the limit. */
export type WorkerFile = StoredFile & { blob?: FileBlob; inline?: string; keep?: "pc" | "vps" | "auto" };
export type AgentDeps = {
  owner: string;
  complete: Complete;
  engine: () => Engine;
  ws: WorkerWorkspace;
  /** The VPS's files folder (the same content-addressed names as VpsStore). */
  files: string;
  /** vps.* on this server itself (desktop/engine/vps/tools.ts over a local link, asking in words). */
  vps?: (tool: Record<string, unknown>) => Promise<unknown>;
  /** Runs a server change the person said yes to. */
  vpsPerform?: (ask: VpsAsk) => Promise<unknown>;
  /** The worker's standing state (a question waiting for its answer). */
  state?: WorkerState;
  /** What waits for the PC past the storage limit. */
  waiting?: () => Promise<{ item: string; name: string; bytes: number }[]>;
  log?: (m: string) => void;
  clock?: () => number;
  /** How long one answer may take (Telegram waits ten minutes). */
  deadline?: number;
};

/** worker_state key: files asked for on Telegram while only on the PC (desktop/engine/vps/manager.ts sends them). */
export const PENDING_SENDS = "tg-pending-sends";
export type PendingSend = { id: string; name: string; at: number };

export class WorkerAgent {
  private d: AgentDeps;
  private clock: () => number;
  constructor(d: AgentDeps) { this.d = d; this.clock = d.clock || Date.now; }
  private log(m: string) { this.d.log?.(m); }
  /** Kept for the worker's shutdown: nothing runs in the background any more (no hand-offs on Telegram). */
  async idle() {}

  /** A workspace file's bytes on the server: from the VPS store (checksum checked), held for the PC, or a saved CMS file. */
  async bytes(f: WorkerFile): Promise<Uint8Array> {
    if (f.inline) return new Uint8Array(Buffer.from(f.inline, "base64"));
    if (f.blob) {
      const bytes = new Uint8Array(await readFile(join(this.d.files, f.blob.sha256 + (f.blob.ext ? "." + f.blob.ext : ""))));
      if (sha256(bytes) !== f.blob.sha256) throw Error(`${f.name} didn't match its checksum on the server.`);
      return bytes;
    }
    if (f.id.startsWith("guc_")) return new Uint8Array(await readFile((await this.d.engine().file(f.id.slice(4))).path));
    throw Error(`${f.name} is only on the person's PC right now, so it can be sent once the PC is on.`);
  }
  /** One of the person's files by id or name: exact name first, then the only one that contains the words. */
  private fileNamed(s: WsState, name: unknown): WorkerFile | { error: string } | null {
    const want = String(name || "").trim().toLowerCase();
    if (!want) return { error: 'Give "file": its name or id.' };
    const files = s.files as WorkerFile[];
    const hits = files.filter((f) => f.id === name || f.name.toLowerCase() === want);
    const near = hits.length ? hits : files.filter((f) => f.name.toLowerCase().includes(want));
    if (!near.length) return null;
    if (near.length > 1) return { error: `"${name}" matches ${near.length} files: ${near.slice(0, 8).map((f) => f.name).join(", ")}. Use the exact name.` };
    return near[0];
  }

  // ---------- Telegram ----------
  /** The deps of the Telegram main thread on this side: the worker's copy of the workspace, the server's model, the
   *  worker's engine. The window's are src/telegram/thread.ts. */
  deps(): ThreadDeps<WsState> {
    const engine = this.d.engine();
    const vps: ThreadVps | undefined = this.d.vps ? {
      run: (tool) => this.d.vps!(tool),
      hold: async (ask) => { await this.d.state?.set("vps-ask", ask); },
      waiting: async () => ({ items: await this.d.waiting?.().catch(() => []) || [] }),
      // With the PC off, copies on or off is a wish the PC carries out when it is next on (it holds the files).
      copies: async (on) => { await this.d.state?.set("copies-wish", on); return { ok: true, copies: on, note: "Done when their PC is next on: " + (on ? "it copies their files to the VPS." : "the VPS copies are removed once the PC has each file.") + " Say so in one plain sentence." }; },
      keep: (file, where) => this.keepFile(file, where),
    } : undefined;
    return {
      ws: { state: () => this.d.ws.state(), change: async (fn) => { await this.d.ws.change(fn); } },
      complete: ({ system, user }) => this.d.complete({ system, user }),
      run: async (tool) => {
        const s = await this.d.ws.state();
        const subjects = (s?.spaces || []).filter((x) => x.kind === "subject").map((x) => ({ id: x.id, name: x.name, description: x.description, examDate: x.examDate }));
        return runThreadTool({ engine, owner: this.d.owner, subjects, vps, changed: () => {},
          workspaceFile: async (name) => {
            const st = await this.d.ws.state(), f = st && this.fileNamed(st, name);
            if (!f || "error" in f) return f || null;
            // Only on the PC, which is off: the PC sends it by itself when it is next online (pendingSends).
            if (!f.blob && !f.inline && !f.id.startsWith("guc_")) { await this.pendingSend(f); return { pending: f.name }; }
            return { name: f.name, type: f.type || "application/octet-stream", bytes: await this.bytes(f) };
          } }, tool);
      },
      before: (text) => threadBefore({
        take: async () => this.d.state?.take<VpsAsk>("vps-ask"),
        perform: async (ask) => this.d.vpsPerform ? this.d.vpsPerform(ask) : { error: "The VPS tools aren't available here." },
        clock: this.clock,
      }, text),
      guc: async () => await engine.now().catch(() => null) as Awaited<ReturnType<NonNullable<ThreadDeps["guc"]>>>,
      model: "vps", clock: this.clock, deadline: this.d.deadline, log: (m) => this.log(m),
    };
  }
  /** Clem speaking by itself on the VPS: the organizer's briefing, told by the server's AI (desktop/telegram-thread.ts). */
  speak(own: OwnBrief) { return ownTurn(this.deps(), own); }
  /** One Telegram message, or a tap on an older message's button, answered here as the window's main thread would. */
  async converse(turn: TelegramTurn): Promise<{ text: string }> {
    if ("text" in turn) return telegramTurn(this.deps(), turn.text);
    if ("own" in turn) return { text: JSON.stringify(await this.speak(turn.own)) };
    const tap = turn.tap, o = this.d.engine().organizer;
    if (tap.t === "undo") { const u = await o.undo(tap.key); if (!u) return { text: "That can’t be undone any more." }; const { undoAction } = await import("../../../core/proactivity/actions.ts"); await this.d.ws.change((s) => undoAction(s, u, this.clock())); return { text: "Undone." }; }
    if (tap.t === "confirm") { const got = await o.confirm(tap.key); if (!got) return { text: "That couldn’t be done." }; await this.d.ws.drain(o); return { text: "Done." }; }
    // An older lecture message's Summarize or Make flashcards: study, done in the app (declined like the words would be).
    if (tap.t === "summarize" || tap.t === "flashcards") return telegramTurn(this.deps(), tap.t === "summarize" ? `Summarize ${tap.name} in 3 lines, then what I should remember for the exam.` : `Make flashcards from ${tap.name} for this subject.`);
    return { text: "Done." };
  }
  /** Files asked for on Telegram that are only on the PC: the PC sends each when it is next online, once. */
  private async pendingSend(f: WorkerFile) {
    const list = (await this.d.state?.get<PendingSend[]>(PENDING_SENDS)) || [];
    if (!list.some((x) => x.id === f.id)) await this.d.state?.set(PENDING_SENDS, [...list, { id: f.id, name: f.name, at: this.clock() }].slice(-20));
  }
  /** vps.keep: where one file is kept, recorded on the file (the PC moves it when it next syncs). */
  private async keepFile(file: string, where: "pc" | "vps" | "auto") {
    const s = (await this.d.ws.state())!;
    const f = this.fileNamed(s, file);
    if (!f) return { error: `No file named "${file}".` };
    if ("error" in f) return f;
    await this.d.ws.change((w) => ({ ...w, files: w.files.map((x) => (x.id === f.id ? { ...x, keep: where, updated: this.clock() } : x)) }));
    return { ok: true, file: f.name, keep: where, note: where === "pc" ? "It moves to their PC and off the VPS when the PC next syncs; Clem won't move it back. Say so plainly." : where === "vps" ? "Kept on the VPS from now on." : "Clem decides again." };
  }

  // ---------- Routines ----------
  /** The person's routines (State.automations) that are due, run as the window runs them: the prompt answered
   *  without tools, posted in the main thread (or a new chat in its subject). One at a time. */
  async routines() {
    const s = await this.d.ws.state();
    const task = s?.automations.find((a) => a.enabled && a.nextRun && a.nextRun <= this.clock());
    if (!s || !task) return false;
    await this.d.ws.change((w) => ({ ...w, automations: w.automations.map((a) => (a.id === task.id ? { ...a, nextRun: nextAutomation(a.schedule, a.nextRun, this.clock()), lastRun: this.clock(), lastError: undefined } : a)) }));
    try {
      const space = s.spaces.find((x) => x.id === task.spaceId);
      const result = await this.d.complete({ system: "Complete this user-scheduled task. Do not claim external actions you cannot perform. User memory: " + (space ? space.memory : s.memory), user: task.prompt });
      const main = !task.spaceId ? mainThreadOf(s) : undefined;
      const id = () => crypto.randomUUID();
      if (main) await this.d.ws.change((w) => putMessage(w, main.id, { id: id(), role: "assistant", content: `**${task.name}**\n\n${result}`, at: this.clock(), model: "vps" }));
      else { const chatId = id(); await this.d.ws.change((w) => putMessage(putMessage(w, chatId, { id: id(), role: "user", content: task.prompt, at: this.clock() }, { id: chatId, title: task.name, spaceId: task.spaceId }), chatId, { id: id(), role: "assistant", content: result, at: this.clock() })); }
    } catch (e) {
      await this.d.ws.change((w) => ({ ...w, automations: w.automations.map((a) => (a.id === task.id ? { ...a, lastError: (e as Error).message.slice(0, 200) } : a)) }));
    }
    return true;
  }
}
