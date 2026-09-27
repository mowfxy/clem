import { randomUUID } from "node:crypto";
import type { Vault } from "./vault";
import type { DesktopAuth } from "./auth";
import { GROK_PREFIX } from "./grok";

type Row = { provider: string; model: string; reasoning: string; turns: number; images: number };
type Day = { day: string; rows: Row[]; hours: number[] };
type Tally = { days: Day[]; sentAt: number };

const SEND_EVERY = 30 * 60 * 1000;
const localDay = (at: Date) => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
const clean = (text: string | undefined) => (text || "").replace(/[^\w.:\-]/g, "").slice(0, 64);

/** Which provider and model a message used, never its content. */
export function usageLabel(model: string | undefined) {
  if (model?.startsWith("claude:")) return { provider: "claude", model: clean(model.slice(7)) || "default" };
  if (model?.startsWith(GROK_PREFIX)) return { provider: "grok", model: clean(model.slice(GROK_PREFIX.length)) || "default" };
  return { provider: "chatgpt", model: clean(model) || "default" };
}

/** Counts messages per day on this PC and sends the running totals to the account service now and then, for the admin stats page. */
export class UsageTally {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private vault: Vault, private auth: DesktopAuth) {}
  private key = (owner: string) => "usage-tally-" + owner;
  record(owner: string, model: string | undefined, reasoning: string | undefined, images: number) {
    this.queue = this.queue.catch(() => {}).then(async () => {
      const now = new Date(), today = localDay(now);
      const tally = await this.vault.read<Tally>(this.key(owner), { days: [], sentAt: 0 });
      let day = tally.days.find((d) => d.day === today);
      if (!day) tally.days.push((day = { day: today, rows: [], hours: Array(24).fill(0) }));
      const label = { ...usageLabel(model), reasoning: clean(reasoning) };
      let row = day.rows.find((r) => r.provider === label.provider && r.model === label.model && r.reasoning === label.reasoning);
      if (!row && day.rows.length < 40) day.rows.push((row = { ...label, turns: 0, images: 0 }));
      if (row) { row.turns++; row.images += images; }
      day.hours[now.getHours()]++;
      tally.days = tally.days.slice(-14);
      await this.vault.write(this.key(owner), tally);
      if (Date.now() - tally.sentAt > SEND_EVERY) await this.send(owner, tally);
    });
  }
  /** Sends the last two weeks of totals. Resending is safe: the service keeps the larger count for each day. */
  flush(owner: string) {
    this.queue = this.queue.catch(() => {}).then(async () => {
      const tally = await this.vault.read<Tally>(this.key(owner), { days: [], sentAt: 0 });
      if (tally.days.length) await this.send(owner, tally);
    });
    return this.queue;
  }
  private async send(owner: string, tally: Tally) {
    try {
      if ((await this.auth.user())?.id !== owner) return;
      // One id per PC, so usage from several PCs adds up instead of overwriting.
      let device = await this.vault.read<string>("usage-device", "");
      if (!device) { device = randomUUID(); await this.vault.write("usage-device", device); }
      await this.auth.cloud("/usage", { days: tally.days, device });
      // Keep only today once older days are safely stored.
      const today = localDay(new Date());
      await this.vault.write(this.key(owner), { days: tally.days.filter((d) => d.day === today), sentAt: Date.now() });
    } catch { /* Try again with the next message or the next start. */ }
  }
}
