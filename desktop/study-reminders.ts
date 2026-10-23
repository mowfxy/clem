import { dueBySubject, hasFlashcards, localDay, reminderFor, reminderTime, validTime } from "../core/study-due.ts";

type Vault = { read<T>(key: string, fallback: T): Promise<T>; write(key: string, value: unknown): Promise<void> };
/** What is kept: `enabled` is absent until the person changes it (then reminders are on once they have flashcards). */
type Saved = { enabled?: boolean; time?: string; lastSent?: string };
export const DEFAULT_TIME = "08:00";

/**
 * A Windows notification when flashcards are due, from the main process (so it works with Clem in the tray): at most
 * once a day, at the time the person picks, and never when nothing is due. It reads the workspace on this PC and
 * calls no model.
 */
export class StudyReminders {
  private vault: Vault;
  private workspace: (owner: string) => Promise<unknown>;
  private notify: (reminder: { title: string; body: string; spaceId: string; silent: boolean }) => void;
  constructor(o: { vault: Vault; workspace: (owner: string) => Promise<unknown>; notify: StudyReminders["notify"] }) { this.vault = o.vault; this.workspace = o.workspace; this.notify = o.notify; }
  private key(owner: string) { return "reminders-" + owner; }
  async settings(owner: string) {
    const saved = await this.vault.read<Saved>(this.key(owner), {});
    const enabled = saved.enabled ?? hasFlashcards(await this.workspace(owner).catch(() => null));
    return { enabled, time: validTime(saved.time) ? saved.time : DEFAULT_TIME, lastSent: saved.lastSent };
  }
  async configure(owner: string, change: { enabled?: boolean; time?: string }) {
    const saved = await this.vault.read<Saved>(this.key(owner), {});
    if (change.time !== undefined && !validTime(change.time)) throw Error("Pick a time like 08:00.");
    await this.vault.write(this.key(owner), { ...saved, ...(change.enabled !== undefined ? { enabled: change.enabled } : {}), ...(change.time ? { time: change.time } : {}) });
    return this.settings(owner);
  }
  /** Sends today's reminder when it is time and something is due. Returns what was sent, if anything. */
  async tick(owner: string, now = new Date()) {
    const settings = await this.settings(owner);
    if (!reminderTime(settings, now)) return null;
    const workspace = await this.workspace(owner).catch(() => null);
    if (!workspace) return null;
    const reminder = reminderFor(dueBySubject(workspace, now.getTime()));
    // Nothing due: nothing is sent, and cards that come due later in the evening still get today's one reminder.
    if (!reminder) return null;
    await this.vault.write(this.key(owner), { ...(await this.vault.read<Saved>(this.key(owner), {})), lastSent: localDay(now) });
    const quiet = !!(workspace as { quiet?: boolean }).quiet;
    this.notify({ ...reminder, silent: quiet });
    return reminder;
  }
}
