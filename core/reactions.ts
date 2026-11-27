// Reactions in chats (the main thread, subject and project chats). Saved on the message (Message.reactions), so they
// persist and sync with it; older messages without them load as they are. The AI reads them as feedback in its next
// turn and may react itself with [[react: emoji]]; no rule acts on a reaction by itself.
import type { Reaction } from "./types";

/** The small set the person picks from. 👎 is here so "less of that" can be said without words. */
export const CHAT_REACTIONS = ["👍", "👎", "❤️", "😂", "🎉", "🤔", "🙏"];
/** Who reacted: the person, or the AI in a chat. */
export const PERSON = "you", AI = "clem";

/** Adds the reaction, or removes it when `by` already gave that emoji (tap again to remove). */
export function toggle(reactions: Reaction[] | undefined, emoji: string, by: string, at = Date.now()): Reaction[] {
  const list = reactions || [];
  return list.some((r) => r.by === by && r.emoji === emoji) ? list.filter((r) => !(r.by === by && r.emoji === emoji)) : [...list, { emoji, by, at }];
}

/** Grouped by emoji for display, in first-given order. */
export function groups(reactions: Reaction[] | undefined): { emoji: string; by: string[] }[] {
  const m = new Map<string, string[]>();
  for (const r of reactions || []) m.set(r.emoji, [...(m.get(r.emoji) || []), r.by]);
  return [...m].map(([emoji, by]) => ({ emoji, by }));
}

/** What a chip says to a screen reader and on hover. */
export function label(emoji: string, by: string[]) {
  const who = by.map((b) => (b === PERSON ? "you" : "Clem"));
  return `${emoji} from ${who.join(" and ")}${by.includes(PERSON) ? ". Press to remove yours" : ""}`;
}

/** Whether a message gets the reaction row: anything said (the person's, the AI's, Clem's own posts), not a quiet
 *  size-cap note, not an answer still being written, not an empty placeholder. */
export const canReact = (m: { content: string; trim?: unknown }, streaming = false) => !m.trim && !streaming && !!m.content.trim();

/** A chat's messages with one message's reaction toggled. */
export function reactIn<M extends { id: string; reactions?: Reaction[] }>(messages: M[], id: string, emoji: string, by: string, at = Date.now()): M[] {
  return messages.map((m) => (m.id === id ? { ...m, reactions: toggle(m.reactions, emoji, by, at) } : m));
}

/** The AI answered with only a reaction: its empty answer goes, and the reaction lands on the person's message it
 *  answered (the last one from them before it). Nothing changes when there is no such message. */
export function settleReactionOnly<M extends { id: string; role: string; reactions?: Reaction[] }>(messages: M[], answerId: string, emoji: string, at = Date.now()): M[] {
  const i = messages.findIndex((m) => m.id === answerId);
  let target = -1;
  for (let j = i - 1; j >= 0; j--) if (messages[j].role === "user") { target = j; break; }
  if (i < 0 || target < 0) return messages;
  const to = messages[target];
  const reactions = (to.reactions || []).some((r) => r.by === AI && r.emoji === emoji) ? to.reactions! : [...(to.reactions || []), { emoji, by: AI, at }];
  return messages.flatMap((m, j) => (j === i ? [] : j === target ? [{ ...m, reactions }] : [m]));
}

const REACT = /^\s*\[\[\s*react\s*:\s*(\S+?)\s*\]\]\s*/i;
/** A reply that is only a reaction ("ok thanks" needs no words): its emoji, else null. */
export function reactionOnly(reply: string): string | null {
  const m = REACT.exec(reply);
  return m && !reply.slice(m[0].length).trim() && CHAT_REACTIONS.includes(m[1]) ? m[1] : null;
}
/** The reply without a leading react directive (shown while streaming, or when words follow it). */
export const withoutReact = (reply: string) => reply.replace(REACT, "");

type Msg = { id: string; role: string; content: string; reactions?: Reaction[]; own?: string };
const snippet = (text: string) => { const t = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim(); return t.length > 80 ? t.slice(0, 77) + "…" : t; };

/** A turn's note, appended when it is sent again: what was reacted to it, read as feedback. */
export function turnNote(m: Msg): string {
  const mine = (m.reactions || []).filter((r) => r.by === PERSON).map((r) => r.emoji);
  const ai = (m.reactions || []).filter((r) => r.by !== PERSON).map((r) => r.emoji);
  const parts = [mine.length ? `they reacted ${mine.join(" ")}` : "", ai.length ? `you reacted ${ai.join(" ")}${m.role === "user" ? " instead of replying" : ""}` : ""].filter(Boolean);
  return parts.length ? `\n\n[${parts.join("; ")}]` : "";
}

/** One system line on the person's latest reactions, newest first: feedback for the AI to weigh, never a rule. */
export function feedback(messages: Msg[], max = 8): string {
  const lines: { at: number; text: string }[] = [];
  for (const m of messages) for (const r of m.reactions || []) {
    if (r.by !== PERSON) continue;
    const what = m.role === "user" ? "their own message" : m.own ? `your own post (${m.own})` : "your answer";
    lines.push({ at: r.at || 0, text: `${r.emoji} on ${what}: “${snippet(m.content)}”` });
  }
  if (!lines.length) return "";
  const kept = lines.sort((a, b) => b.at - a.at).slice(0, max);
  return `The person's reactions, newest first (feedback for you to weigh, e.g. 👎 on a kind of post means they want less of it; nothing acts on them unless you do):\n${kept.map((l) => "- " + l.text).join("\n")}`;
}

/** What the AI is told it may do. */
export const REACT_NOTE = `You may react instead of replying: when a message asks for nothing (thanks, ok, a sign-off), answer with only [[react: emoji]] (one of ${CHAT_REACTIONS.join(" ")}). Otherwise never add one.`;
