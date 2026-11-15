// When the VPS is full (docs/GUC-VPS-ENGINE.md "Storage limit"): Clem tells the person once, in one plain message in
// the main thread (and on Telegram when paired), that the VPS is at its limit and that new files stay on their PC only.
// Nothing is waiting to come back and nothing is asked: the PC keeps every file (owner, 2026-11-15: "files live on
// both"), and CMS files the worker couldn't keep are fetched by the PC itself when it is on. Never per file, never twice.
import { randomUUID } from "node:crypto";
import { mainThreadOf, putMessage } from "../../../core/workspace/apply.ts";
import type { WorkerState } from "./state.ts";
import type { Waiting } from "./limit.ts";
import type { WorkerWorkspace } from "./workspace.ts";

/** The one message: full, and what that means, in a sentence each. */
export const FULL_TEXT = "Your VPS is full: Clem keeps it at most 82% used, and it's there now. New files stay on your PC only, which keeps everything anyway, so there's nothing to do.";

export class FullNotice {
  private d: { state: WorkerState; waiting: Waiting; ws: WorkerWorkspace; post?: (text: string) => Promise<unknown>; full?: () => boolean; clock?: () => number; log?: (m: string) => void };
  constructor(d: FullNotice["d"]) { this.d = d; }
  private checking: Promise<boolean> = Promise.resolve(false);
  /** Tells the person, if something was left off the VPS (or the disk is at the limit) and they were never told. True
   *  when it did now. Checks run one after another, so things added back to back are told once. */
  check(): Promise<boolean> { return (this.checking = this.checking.catch(() => false).then(() => this.checkOnce())); }
  private async checkOnce(): Promise<boolean> {
    if (await this.d.state.get("full-told")) return false;
    // Files left off because copies are off ("pc:") aren't the VPS being full.
    const items = (await this.d.waiting.items()).filter((i) => !i.item.startsWith("pc:"));
    if (!items.length && !this.d.full?.()) return false;
    await this.d.state.set("full-told", { at: (this.d.clock || Date.now)(), items: items.length });
    if (await this.d.ws.ready()) {
      const s = await this.d.ws.state(), main = s && mainThreadOf(s);
      if (main) await this.d.ws.change((w) => putMessage(w, main.id, { id: randomUUID(), role: "assistant", content: FULL_TEXT, at: (this.d.clock || Date.now)(), model: "vps" }));
    }
    await this.d.post?.(FULL_TEXT).catch((e: Error) => this.d.log?.("[worker] full: " + e.message));
    return true;
  }
}
