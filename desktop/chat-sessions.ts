import { createHash } from "node:crypto";

/**
 * Each chat keeps its CLI session between messages, the way a CLI keeps its own conversation: the next message goes
 * on the same Claude Code / Grok session or Codex thread, so the conversation so far is not sent again as text and
 * the provider's prompt cache serves all of it (with the tool results the AI saw, which a text replay drops).
 *
 * A session is continued only when nothing about it changed: the same AI, account and model, and the same
 * conversation (no message edited, retried or deleted since). Any difference starts a new session with the whole
 * conversation, as before, so continuing is never a way to lose or confuse context. Every CLI keeps its sessions on disk,
 * so a chat goes on after a long break or a restart, resumed by id the way T3 Code resumes a thread (ChatSessions
 * snapshot/restore), and may change model on the same session.
 */
/** How long a session stays usable: a text replay loses every tool result the AI saw. */
export const RESUMABLE_KEEP_MS = 7 * 24 * 60 * 60_000;
export const keepFor = (_provider: string) => RESUMABLE_KEEP_MS;
/**
 * The context (tokens) past which a kept session is compacted before the next message goes on it. Every step of a
 * continued session re-reads all of it — a finished document task leaves its sources, the whole draft and every page
 * picture there (one measured at 271k) — while Claude Code's /compact leaves a summary of a few thousand.
 */
export const COMPACT_AT_TOKENS = 100_000;
/** How long after an answer a large Claude session is compacted, while its one-hour prompt cache is still warm (T3 Code's
 *  idle compaction): the person is not waiting, and it needs no uncached read. */
export const IDLE_COMPACT_MS = 50 * 60_000;
/** Past this a message waits for compaction rather than go on. Below it the session answers from its cache and idle
 *  compaction deals with it later. */
export const HARD_COMPACT_AT_TOKENS = 170_000;
/**
 * Past this a Grok or Gemini session, which cannot be compacted, ends and the next message starts a new one. It stays
 * well above what a replay can hold (replayBudget, core/chat-context.ts): were it below, a long chat would end its session
 * at every message and pay for the whole conversation uncached each time.
 */
export const END_AT_TOKENS = 180_000;
/** Chats whose sessions are kept at once; the least recently used goes first. */
export const MAX_KEPT = 40;

export type KeptSession = {
  /** "claude" | "grok" | "codex" */
  provider: string;
  account: string;
  model: string;
  /** The provider's session id (Claude Code's or Grok's session, Codex's thread). */
  session: string;
  /** conversationPrint of the chat as the session last saw it, the answer included. */
  history: string;
  /** Fingerprints of the context blocks already sent on this session (blockPrint): an unchanged one is not sent again. */
  sent: Set<string>;
  /** Tokens of context the session's last step read, when the CLI reports it. */
  context?: number;
  /** The session's token counts so far, for a CLI that reports only totals (Grok, Antigravity): the next answer's own are the difference. */
  tokens?: { input: number; cacheRead: number; cacheWrite: number; output: number };
  at: number;
  /** Removes the session (its transcript, or its thread's endpoint) when it will not be continued. */
  end: () => void;
  /** The CLI's own name for the session where it differs from Clem's (Gemini picks its own), kept across a restart. */
  native?: string;
};
/** A kept session as it is saved between runs of Clem. */
export type SavedSession = Omit<KeptSession, "sent" | "end"> & { key: string; sent: string[] };

export type SessionWant = { provider: string; account: string; model: string; history: string };

/** What the person typed: the note on parts they pointed at, and /visual's rewording, go only with the message they were
 *  sent with, so a later message sees that turn without them and must still match it. */
const spoken = (text: string) => text.replace(/\n\nThe user is pointing at these exact parts:\n[\s\S]*$/, "").replace(/^(?:\/visual\s*|Visualize: )/i, "");
/**
 * A fingerprint of a conversation: the person's messages word for word, and where each answer came, in order. An
 * answer's own words are left out: the chat stores them as shown (file cards, folded notes, shortened later), not as
 * the AI wrote them, and a retried answer already changes the messages around it.
 */
export function conversationPrint(turns: { role: string; content: string }[]) {
  const hash = createHash("sha256");
  for (const t of turns) if (t.role !== "system") hash.update(t.role === "user" ? "U\u0000" + spoken(t.content) + "\u0001" : "A\u0001");
  return hash.digest("hex").slice(0, 32);
}
/** A fingerprint of one context block (a folder note, a file guide), to send each one once per session. */
export const blockPrint = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 24);
/** The fingerprint of what Clem knows about the person as one message carries it (their name and the memories chosen
 *  for it): on a kept session it goes again only when it changed. */
export const memoryPrint = (name: string | undefined, memories: { text: string }[]) => blockPrint("memory\u0000" + (name || "") + "\u0000" + JSON.stringify(memories.map((m) => m.text)));
/** Fingerprints of the person's name and of each memory line one message carries, one each: memory is chosen for each
 *  message (the lines matching it change), so a kept session gets only the lines it has not had yet, not all of them
 *  again whenever one changed. */
export const memoryPrints = (name: string | undefined, memories: { text: string }[]) =>
  ({ name: blockPrint("memory-name\u0000" + (name || "")), items: memories.map((m) => blockPrint("memory-item\u0000" + m.text)) });
/** The fingerprint of one source excerpt (a passage of a linked file): sent once per kept session. */
export const sourcePrint = (s: { source: string; text: string }) => blockPrint("source\u0000" + s.source + "\u0000" + s.text);

/** The fingerprint of one part of a conversation's own instructions (the window sends the part that is the same on every
 *  message first, then this message's own): on a kept session each part goes again whenever it differs from the one it
 *  last received. */
export const instructionsPrint = (text: string, part = 0) => `instructions:${part}:` + blockPrint(text);
const instructionsPart = (print: string) => print.match(/^instructions:\d+:/)?.[0];
/** What a session has been sent after this message: what it had, with each part of the instructions it last received
 *  replaced by the one sent now. */
export function sentAfter(before: Iterable<string>, now: string[]) {
  const replaced = new Set(now.map(instructionsPart).filter(Boolean));
  return new Set([...[...before].filter((p) => !replaced.has(instructionsPart(p))), ...now]);
}

export class ChatSessions {
  private kept = new Map<string, KeptSession>();
  private now: () => number;
  /** Told when the sessions kept under a key change, so they can be saved. */
  changed?: (key: string) => void;
  constructor(now: () => number = Date.now) { this.now = now; }
  /** The sessions that survive a restart, of the keys with this prefix. */
  snapshot(prefix = ""): SavedSession[] {
    return [...this.kept].filter(([key]) => key.startsWith(prefix)).map(([key, { end: _end, sent, ...s }]) => ({ ...s, key, sent: [...sent] }));
  }
  /** Sessions saved by an earlier run of Clem; `end` removes one, and a session the chat has since replaced is ended. */
  restore(saved: SavedSession[], end: (session: SavedSession) => void) {
    for (const s of saved) {
      if (this.kept.has(s.key) || this.now() - s.at >= keepFor(s.provider)) { end(s); continue; }
      const { key, sent, ...rest } = s;
      this.kept.set(key, { ...rest, sent: new Set(sent), end: () => end(s) });
    }
  }

  /**
   * The chat's session to continue for this message, taken out of the store (an answer in progress owns it; it comes
   * back with keep() when that answer finishes). A session that does not match is ended and none is returned.
   */
  take(key: string, want: SessionWant): KeptSession | undefined {
    const found = this.kept.get(key);
    if (!found) return undefined;
    this.kept.delete(key);
    // A session changes model where it is (T3 Code's in-session model switch).
    const usable = found.provider === want.provider && found.account === want.account
      && found.history === want.history && this.now() - found.at < keepFor(found.provider);
    if (usable) { this.changed?.(key); return found; }
    found.end();
    this.changed?.(key);
    return undefined;
  }
  /** Whether the chat's next message would likely continue its kept session (same AI, the conversation as it left it,
   *  not idle too long, and not past `limit` tokens), without taking it: the account and model are checked when it is taken. */
  peek(key: string, want: Pick<SessionWant, "provider" | "history">, limit = Infinity) {
    const found = this.kept.get(key);
    return !!found && found.provider === want.provider && found.history === want.history && this.now() - found.at < keepFor(found.provider) && (found.context ?? 0) <= limit;
  }
  /** Keeps a finished answer's session for the chat's next message (ending the one it replaces, if different). */
  keep(key: string, session: Omit<KeptSession, "at">) {
    const before = this.kept.get(key);
    if (before && before.session !== session.session) before.end();
    this.kept.delete(key);
    this.kept.set(key, { ...session, at: this.now() });
    this.sweep();
    this.changed?.(key);
  }
  /** Notes a kept session's size once it is known (counted after its answer was shown), while it is still the chat's session. */
  note(key: string, session: string, { context, tokens }: { context?: number; tokens?: KeptSession["tokens"] }) {
    const found = this.kept.get(key);
    if (found?.session !== session) return;
    if (context !== undefined) found.context = context;
    if (tokens) found.tokens = tokens;
    this.changed?.(key);
  }
  /** Ends a chat's session (the chat was deleted, or its answer failed). */
  drop(key: string) {
    const found = this.kept.get(key);
    this.kept.delete(key);
    found?.end();
    this.changed?.(key);
  }
  /** Ends the sessions no message can continue any more: idle past RESUMABLE_KEEP_MS, or beyond MAX_KEPT. */
  sweep() {
    const now = this.now();
    for (const [key, s] of this.kept) if (now - s.at >= keepFor(s.provider)) { this.kept.delete(key); s.end(); this.changed?.(key); }
    while (this.kept.size > MAX_KEPT) {
      const [key, s] = this.kept.entries().next().value!;
      this.kept.delete(key);
      s.end();
    }
  }
  /** Ends every kept session (signing out, quitting). */
  clear(prefix = "") {
    for (const [key, s] of [...this.kept]) if (key.startsWith(prefix)) { this.kept.delete(key); s.end(); this.changed?.(key); }
  }
  get size() { return this.kept.size; }
}
