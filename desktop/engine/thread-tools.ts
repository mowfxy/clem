// The engine's actions for the Telegram main thread (core/telegram/thread.ts), run the same way on the laptop
// (desktop/main.ts, for the window's src/telegram/thread.ts) and on the VPS worker (desktop/engine/vps/agent.ts): the
// organizer (clem.*), GUC (guc.*; guc.read for a course's own facts), an existing file sent to the chat, and the VPS (server changes asked
// once in words). Nothing here answers study questions or makes files. No electron.
import { gucAction, type ToolSubject } from "../../core/guc/ai-tools.ts";
import { clemAction } from "../../core/proactivity/tools.ts";
import { isVpsAction } from "../../core/vps/tools.ts";
import { isYes, ranReport, type VpsAsk } from "../../core/vps/ask.ts";
import { NOT_ON_TELEGRAM, telegramAllows } from "../../core/telegram/thread.ts";
import { runGucTool, runTelegramTool, type GucToolContext } from "./ai-tools.ts";
import type { Engine } from "./index.ts";

/** A question about a server change is answered within a day, or it lapses. */
export const ASK_MS = 24 * 3_600_000;
export type ThreadVps = {
  /** vps.run_command, read_file, write_file, service_status, asking in words (VpsTools with `words`). */
  run(tool: Record<string, unknown>): Promise<unknown>;
  /** Keeps a server change Clem asked about until the person's next message. */
  hold(ask: VpsAsk): Promise<void>;
  /** What was left off the VPS at its limit (the PC keeps everything, so this is information only). */
  waiting(): Promise<{ items: { name: string }[] }>;
  /** "Keep a copy of my files on the VPS", on or off (the person said so in words). */
  copies(on: boolean): Promise<unknown>;
  /** Where one file is kept. */
  keep(file: string, where: "pc" | "vps" | "auto"): Promise<unknown>;
};
export type ThreadToolCtx = {
  engine: Engine;
  owner: string;
  /** The time "today" and "the next 14 days" are read from (the worker's clock); the real time when left out. */
  now?: number;
  /** The person's subjects (names, exam dates): the engine knows only their ids. */
  subjects: ToolSubject[];
  changed?: () => void;
  /** One of the person's files in Clem by name or id, with its bytes; null when none is called that. */
  workspaceFile?(file: string): Promise<FileToSend>;
  /** The person's VPS, when one is connected. */
  vps?: ThreadVps;
  /** guc.* on the VPS worker while it runs Clem's jobs (GucToolContext.remote). */
  gucRemote?: GucToolContext["remote"];
};

const waitingText = (w: { items: { name: string }[] }) => ({
  leftOff: w.items.slice(0, 20).map((i) => i.name), count: w.items.length,
  note: "The PC keeps every file; these weren't copied to the VPS because it's at Clem's limit (CMS files among them are saved on the PC when it's on). Nothing to do.",
});

/** One action of the Telegram main thread, on this side's engine. */
export async function runThreadTool(ctx: ThreadToolCtx, tool: Record<string, any>): Promise<unknown> {
  const action = String(tool?.action || "");
  if (!telegramAllows(action)) return NOT_ON_TELEGRAM;
  const { engine, owner, subjects } = ctx;
  if (clemAction(action)) return engine.organizer.tool(tool, {}).catch((e: Error) => ({ error: e.message }));
  if (gucAction(action)) return runGucTool({ engine, owner, subjects, now: ctx.now, changed: ctx.changed, remote: ctx.gucRemote }, tool);
  if (action === "telegram.sendFile") return sendFileTool(ctx, tool);
  if (isVpsAction(action)) {
    if (!ctx.vps) return { error: "No VPS is connected. The person can add one in Clem on their PC: Settings → Connectors → VPS." };
    try {
      if (action === "vps.waiting") return waitingText(await ctx.vps.waiting());
      if (action === "vps.copies") { if (typeof tool.on !== "boolean") return { error: 'vps.copies needs "on": true or false.' }; return await ctx.vps.copies(tool.on); }
      if (action === "vps.keep") return await ctx.vps.keep(String(tool.file || ""), tool.where === "pc" || tool.where === "vps" ? tool.where : "auto");
      const r = await ctx.vps.run(tool) as { needsYes?: boolean; ask?: VpsAsk; question?: string };
      if (!r?.needsYes || !r.ask) return r;
      await ctx.vps.hold(r.ask);
      return { asked: true, question: r.question };
    } catch (e) { return { error: (e as Error).message }; }
  }
  return NOT_ON_TELEGRAM;
}

/** A file of the person's to send: its bytes, or `pending` when it is only on their PC and the PC is off (the worker
 *  keeps it and the PC sends it by itself when it is next online). */
export type FileToSend = { name: string; type: string; bytes: Uint8Array } | { pending: string } | { error: string } | null;
/** telegram.sendFile, the same in the app's main thread and on Telegram from either side: one of the person's own files
 *  in Clem when one is called that, else a CMS file (fetched from CMS when it isn't saved). Sending only, never making.
 *  Telegram's 50 MB limit holds for both. */
export async function sendFileTool(ctx: Pick<ThreadToolCtx, "engine" | "owner" | "subjects" | "workspaceFile">, tool: Record<string, any>) {
  const name = typeof tool.file === "string" ? tool.file.trim().slice(0, 300) : "";
  if (!name) return { error: `telegram.sendFile needs "file": a CMS file's id or name, or the name of one of their files in Clem.` };
  const t = ctx.engine.telegram;
  if (!(await t.paired().catch(() => false))) return { error: `Telegram isn't paired. Offer {"action":"telegram.pair"} so they can pair it.` };
  const own: FileToSend = ctx.workspaceFile ? await ctx.workspaceFile(name).catch((e: Error) => ({ error: e.message })) : null;
  if (own && "pending" in own) return `${own.pending} is only on their PC, which is off right now: it goes to their Telegram by itself when the PC is next online. Say so in one plain sentence; don't ask anything.`;
  if (own && "bytes" in own) {
    try {
      const r = await t.sendBytes(own.name, own.type, own.bytes);
      return r.sent ? `Sent ${r.name} to their Telegram. Say so in one short sentence.` : `${r.name} is ${Math.round(r.size / 1048576)} MB, over Telegram's 50 MB, so it stays in Clem. Say so briefly.`;
    } catch (e) { return { error: (e as Error).message || "Telegram couldn't be reached right now." }; }
  }
  const cms = await runTelegramTool({ engine: ctx.engine, owner: ctx.owner, subjects: ctx.subjects }, tool);
  if (typeof cms !== "string" && /^No CMS file/.test(cms.error)) return own && "error" in own ? own : { error: `No file called "${name}", in CMS or in their files in Clem. List a subject's CMS files with {"action":"guc.materials","subject":…}.` };
  return cms;
}

/** Before the model: a "yes" to the server change Clem asked about runs it (anything else drops it). The same on both
 *  sides. */
export async function threadBefore(o: { take(): Promise<VpsAsk | undefined>; perform(ask: VpsAsk): Promise<unknown>; clock?: () => number }, text: string): Promise<string | null> {
  const ask = await o.take().catch(() => undefined);
  if (ask && (o.clock || Date.now)() - ask.at < ASK_MS && isYes(text)) {
    const r = await o.perform(ask).catch((e: Error) => ({ error: e.message })) as { exitCode?: number; output?: string; error?: string };
    return ranReport(ask, r);
  }
  return null;
}
