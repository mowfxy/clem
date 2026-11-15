// The engine's actions for the Telegram main thread (core/telegram/thread.ts), run the same way on the laptop
// (desktop/main.ts, for the window's src/telegram/thread.ts) and on the VPS worker (desktop/engine/vps/agent.ts): the
// organizer (clem.*), GUC (guc.*, never guc.read), an existing file sent to the chat, and the VPS (server changes asked
// once in words). Nothing here answers study questions or makes files. No electron.
import { gucAction, type ToolSubject } from "../../core/guc/ai-tools.ts";
import { clemAction } from "../../core/proactivity/tools.ts";
import { isVpsAction } from "../../core/vps/tools.ts";
import { isYes, ranReport, type VpsAsk } from "../../core/vps/ask.ts";
import { NOT_ON_TELEGRAM, telegramAllows } from "../../core/telegram/thread.ts";
import { runGucTool, runTelegramTool } from "./ai-tools.ts";
import type { Engine } from "./index.ts";

/** A question about a server change is answered within a day, or it lapses. */
export const ASK_MS = 24 * 3_600_000;
type Answer = "send" | "keep" | null | undefined;
export type ThreadVps = {
  /** vps.run_command, read_file, write_file, service_status, asking in words (VpsTools with `words`). */
  run(tool: Record<string, unknown>): Promise<unknown>;
  /** Keeps a server change Clem asked about until the person's next message. */
  hold(ask: VpsAsk): Promise<void>;
  /** What waits past the storage limit, and the standing answer (set it with `send`). */
  waiting(send?: boolean): Promise<{ items: { name: string }[]; answer: Answer }>;
  /** Where one file is kept. */
  keep(file: string, where: "pc" | "vps" | "auto"): Promise<unknown>;
};
export type ThreadToolCtx = {
  engine: Engine;
  owner: string;
  /** The person's subjects (names, exam dates): the engine knows only their ids. */
  subjects: ToolSubject[];
  changed?: () => void;
  /** One of the person's files in Clem by name or id, with its bytes; null when none is called that. */
  workspaceFile?(file: string): Promise<{ name: string; type: string; bytes: Uint8Array } | { error: string } | null>;
  /** The person's VPS, when one is connected. */
  vps?: ThreadVps;
};

const waitingText = (w: { items: { name: string }[]; answer: Answer }, set: boolean) => ({
  waiting: w.items.slice(0, 20).map((i) => i.name), count: w.items.length,
  answer: w.answer === "send" ? "they go to the PC whenever it's online" : w.answer === "keep" ? "they stay; Clem doesn't ask" : "not answered yet",
  ...(set ? { note: "Saved as the standing answer. Say so in one plain sentence." } : {}),
});

/** One action of the Telegram main thread, on this side's engine. */
export async function runThreadTool(ctx: ThreadToolCtx, tool: Record<string, any>): Promise<unknown> {
  const action = String(tool?.action || "");
  if (!telegramAllows(action)) return NOT_ON_TELEGRAM;
  const { engine, owner, subjects } = ctx;
  if (clemAction(action)) return engine.organizer.tool(tool, {}).catch((e: Error) => ({ error: e.message }));
  if (gucAction(action)) return runGucTool({ engine, owner, subjects, changed: ctx.changed }, tool);
  if (action === "telegram.sendFile") return sendFile(ctx, tool);
  if (isVpsAction(action)) {
    if (!ctx.vps) return { error: "No VPS is connected. The person can add one in Clem on their PC: Settings → Connectors → VPS." };
    try {
      if (action === "vps.waiting") { const set = typeof tool.send === "boolean"; return waitingText(await ctx.vps.waiting(set ? tool.send : undefined), set); }
      if (action === "vps.keep") return await ctx.vps.keep(String(tool.file || ""), tool.where === "pc" || tool.where === "vps" ? tool.where : "auto");
      const r = await ctx.vps.run(tool) as { needsYes?: boolean; ask?: VpsAsk; question?: string };
      if (!r?.needsYes || !r.ask) return r;
      await ctx.vps.hold(r.ask);
      return { asked: true, question: r.question };
    } catch (e) { return { error: (e as Error).message }; }
  }
  return NOT_ON_TELEGRAM;
}

/** telegram.sendFile: a CMS file (as the app sends it), else one of the person's own files in Clem. */
async function sendFile(ctx: ThreadToolCtx, tool: Record<string, any>) {
  const cms = await runTelegramTool({ engine: ctx.engine, owner: ctx.owner, subjects: ctx.subjects }, tool);
  if (typeof cms === "string" || !ctx.workspaceFile || !/^No CMS file/.test(cms.error)) return cms;
  const name = typeof tool.file === "string" ? tool.file.trim().slice(0, 300) : "";
  const f = await ctx.workspaceFile(name).catch((e: Error) => ({ error: e.message }));
  if (!f) return { error: `No file called "${name}", in CMS or in their files in Clem. List a subject's CMS files with {"action":"guc.materials","subject":…}.` };
  if ("error" in f) return f;
  try {
    const r = await ctx.engine.telegram.sendBytes(f.name, f.type, f.bytes);
    return r.sent ? `Sent ${r.name} to their Telegram. Say so in one short sentence.` : `${r.name} is ${Math.round(r.size / 1048576)} MB, over Telegram's 50 MB, so it stays in Clem on their PC. Say so briefly.`;
  } catch (e) { return { error: (e as Error).message || "Telegram couldn't be reached right now." }; }
}

/** Before the model: a "yes" to the server change Clem asked about runs it (anything else drops it), and the answer to
 *  the VPS-full question is the standing answer. The same on both sides. */
export async function threadBefore(o: { take(): Promise<VpsAsk | undefined>; perform(ask: VpsAsk): Promise<unknown>; fullReply?(text: string): Promise<string | null | undefined>; clock?: () => number }, text: string): Promise<string | null> {
  const ask = await o.take().catch(() => undefined);
  if (ask && (o.clock || Date.now)() - ask.at < ASK_MS && isYes(text)) {
    const r = await o.perform(ask).catch((e: Error) => ({ error: e.message })) as { exitCode?: number; output?: string; error?: string };
    return ranReport(ask, r);
  }
  return (await o.fullReply?.(text).catch(() => null)) || null;
}
