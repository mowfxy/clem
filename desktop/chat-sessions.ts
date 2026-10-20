import { createHash } from "node:crypto";

/**
 * Each chat keeps its CLI session between messages, the way a CLI keeps its own conversation: the next message goes
 * on the same Claude Code / Grok session or Codex thread, so the conversation so far is not sent again as text and
 * the provider's prompt cache serves all of it (with the tool results the AI saw, which a text replay drops).
 *
 * A session is continued only when nothing about it changed: the same AI, account and model, and the same
 * conversation (no message edited, retried or deleted since). Any difference starts a new session with the whole
 * conversation, as before, so continuing is never a way to lose or confuse context. A session idle longer than the
 * providers keep a prompt cache is not continued either: replaying it then would cost more than the text it replaces.
 * One whose context has grown past COMPACT_AT_TOKENS is compacted first (desktop/main.ts).
 */
export const KEEP_MS = 55 * 60_000;
/**
 * The context (tokens) past which a kept session is compacted before the next message goes on it. Every step of a
 * continued session re-reads all of it — a finished document task leaves its sources, the whole draft and every page
 * picture there (one measured at 271k) — while Claude Code's /compact leaves a summary of a few thousand.
 */
export const COMPACT_AT_TOKENS = 100_000;
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
};

export type SessionWant = { provider: string; account: string; model: string; history: string };

/**
 * A fingerprint of a conversation: the person's messages word for word, and where each answer came, in order. An
 * answer's own words are left out: the chat stores them as shown (file cards, folded notes, shortened later), not as
 * the AI wrote them, and a retried answer already changes the messages around it.
 */
export function conversationPrint(turns: { role: string; content: string }[]) {
  const hash = createHash("sha256");
  for (const t of turns) if (t.role !== "system") hash.update(t.role === "user" ? "U\u0000" + t.content + "\u0001" : "A\u0001");
  return hash.digest("hex").slice(0, 32);
}
/** A fingerprint of one context block (a folder note, a file guide), to send each one once per session. */
export const blockPrint = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 24);
/** The fingerprint of what Clem knows about the person as one message carries it (their name and the memories chosen
 *  for it): on a kept session it goes again only when it changed. */
export const memoryPrint = (name: string | undefined, memories: { text: string }[]) => blockPrint("memory\u0000" + (name || "") + "\u0000" + JSON.stringify(memories.map((m) => m.text)));
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
  constructor(now: () => number = Date.now) { this.now = now; }

  /**
   * The chat's session to continue for this message, taken out of the store (an answer in progress owns it; it comes
   * back with keep() when that answer finishes). A session that does not match is ended and none is returned.
   */
  take(key: string, want: SessionWant): KeptSession | undefined {
    const found = this.kept.get(key);
    if (!found) return undefined;
    this.kept.delete(key);
    const usable = found.provider === want.provider && found.account === want.account && found.model === want.model
      && found.history === want.history && this.now() - found.at < KEEP_MS;
    if (usable) return found;
    found.end();
    return undefined;
  }
  /** Keeps a finished answer's session for the chat's next message (ending the one it replaces, if different). */
  keep(key: string, session: Omit<KeptSession, "at">) {
    const before = this.kept.get(key);
    if (before && before.session !== session.session) before.end();
    this.kept.delete(key);
    this.kept.set(key, { ...session, at: this.now() });
    this.sweep();
  }
  /** Notes a kept session's size once it is known (counted after its answer was shown), while it is still the chat's session. */
  note(key: string, session: string, { context, tokens }: { context?: number; tokens?: KeptSession["tokens"] }) {
    const found = this.kept.get(key);
    if (found?.session !== session) return;
    if (context !== undefined) found.context = context;
    if (tokens) found.tokens = tokens;
  }
  /** Ends a chat's session (the chat was deleted, or its answer failed). */
  drop(key: string) {
    const found = this.kept.get(key);
    this.kept.delete(key);
    found?.end();
  }
  /** Ends the sessions no message can continue any more: idle past KEEP_MS, or beyond MAX_KEPT. */
  sweep() {
    const now = this.now();
    for (const [key, s] of this.kept) if (now - s.at >= KEEP_MS) { this.kept.delete(key); s.end(); }
    while (this.kept.size > MAX_KEPT) {
      const [key, s] = this.kept.entries().next().value!;
      this.kept.delete(key);
      s.end();
    }
  }
  /** Ends every kept session (signing out, quitting). */
  clear(prefix = "") {
    for (const [key, s] of [...this.kept]) if (key.startsWith(prefix)) { this.kept.delete(key); s.end(); }
  }
  get size() { return this.kept.size; }
}
