// When the VPS is full (docs/GUC-VPS-ENGINE.md "Storage limit"): Clem tells the person once, in one plain message in
// the main thread (and on Telegram when paired), that the VPS is at its limit and which files are waiting, and asks
// once whether to send them to the PC when it's online. "Yes" is the standing answer (waiting files go to the PC
// whenever it comes online, CMS files the worker skipped included, which the PC fetches itself); "no" leaves them and
// Clem doesn't ask again; either is changed later by saying so (vps.waiting). Never per file, never twice.
import { randomUUID } from "node:crypto";
import { isYes } from "../../../core/vps/ask.ts";
import { mainThreadOf, putMessage } from "../../../core/workspace/apply.ts";
import type { WorkerState } from "./state.ts";
import type { Waiting } from "./limit.ts";
import type { WorkerWorkspace } from "./workspace.ts";

export type FullAnswer = "send" | "keep";
export const isNo = (text: string) => /^\s*(no|nope|nah|no thanks|no,? (leave|keep) them( there)?|leave them( there)?|keep them( there)?|don'?t|not now)\s*[.!]*\s*$/i.test(text);

/** The question, in one plain message: full, what waits (names, or a count and the first few), and the one ask. */
export function fullText(names: string[]) {
  const list = !names.length ? "New files stay on your PC for now." : names.length <= 4 ? `Waiting: ${names.join(", ")}.` : `${names.length} files are waiting, among them ${names.slice(0, 3).join(", ")}.`;
  return `Your VPS is full: Clem keeps it at most 82% used, and it's there now. ${list} Should Clem send waiting files to your PC whenever it's online? Say yes or no; you can change it any time.`;
}

export class FullNotice {
  private d: { state: WorkerState; waiting: Waiting; ws: WorkerWorkspace; post?: (text: string) => Promise<unknown>; full?: () => boolean; clock?: () => number; log?: (m: string) => void };
  constructor(d: FullNotice["d"]) { this.d = d; }
  answer() { return this.d.state.get<FullAnswer>("full-answer"); }
  private checking: Promise<boolean> = Promise.resolve(false);
  /** Tells the person, if files wait (or the disk is at the limit) and they were never told. True when it did now.
   *  Checks run one after another, so files added back to back are told once. */
  check(): Promise<boolean> { return (this.checking = this.checking.catch(() => false).then(() => this.checkOnce())); }
  private async checkOnce(): Promise<boolean> {
    if (await this.d.state.get("full-told") || await this.answer()) return false;
    const items = await this.d.waiting.items();
    if (!items.length && !this.d.full?.()) return false;
    await this.d.state.set("full-told", { at: (this.d.clock || Date.now)(), items: items.length });
    await this.d.state.set("full-asked", true);
    const text = fullText([...new Set(items.map((i) => i.name))]);
    if (await this.d.ws.ready()) {
      const s = await this.d.ws.state(), main = s && mainThreadOf(s);
      if (main) await this.d.ws.change((w) => putMessage(w, main.id, { id: randomUUID(), role: "assistant", content: text, at: (this.d.clock || Date.now)(), model: "vps" }));
    }
    await this.d.post?.(text).catch((e: Error) => this.d.log?.("[worker] full: " + e.message));
    return true;
  }
  /** The person's next message after the question: "yes" or "no" is the standing answer (and what to say back);
   *  anything else leaves it unanswered, and the question isn't asked again. */
  async reply(text: string): Promise<string | undefined> {
    if (!(await this.d.state.take("full-asked"))) return undefined;
    if (isYes(text)) { await this.set("send"); return "Okay: waiting files go to your PC whenever it's online, from now on."; }
    if (isNo(text)) { await this.set("keep"); return "Okay: they stay where they are, and Clem won't ask again. Say \"send waiting files to my PC\" any time to change it."; }
    return undefined;
  }
  async set(answer: FullAnswer) { await this.d.state.set("full-answer", answer); await this.d.state.delete("full-asked"); }
}
