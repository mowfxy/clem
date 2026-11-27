/**
 * What of a chat's earlier messages goes to the AI when it has to be sent the conversation as text: a new chat, a
 * message edited or retried, or a switch to another AI (a different provider never continues the old one's CLI session,
 * desktop/chat-sessions.ts). Whichever AI answers next must pick up exactly where the last one left off:
 * - A reply that failed (not signed in, out of usage, a broken connection) is Clem's notice, not an answer: it is left
 *   out, so the next AI never reads "Your Claude plan has no usage left" as something it said.
 * - The files each earlier message carried are named on it (the person's attachments, the files an answer made), so
 *   "the PDF I sent earlier" or "the deck you made" still points at the right file on an AI that never saw that turn.
 */
export type TurnMessage = { id: string; role: string; content: string; failed?: boolean; attachments?: string[] };

/** How the files of an earlier message are named on it. A kept session's fingerprint ignores it (chat-sessions.ts spoken). */
export const FILES_NOTE = "\n\n[Files with this message: ";
const FILES_NOTE_AT_END = /\n\n\[Files with this message: [^\n]*\]$/;

/** The files note on one message, or "" when it carried none that still exist. */
export function filesNote(ids: string[] | undefined, nameOf: (id: string) => string | undefined) {
  const names = [...new Set((ids || []).map(nameOf).filter((n): n is string => !!n && !!n.trim()))].slice(0, 12);
  return names.length ? FILES_NOTE + names.map((n) => n.replace(/[\]\n]/g, " ").slice(0, 120)).join(", ") + "]" : "";
}

/** A message's text without its files note (its own words, as the person typed them or the AI wrote them). */
export const withoutFilesNote = (text: string) => text.replace(FILES_NOTE_AT_END, "");

/** How a reply that broke off part-way ends: the words it wrote stay, Clem's notice after them is not the AI's. */
export const CUT_OFF_NOTE = "\n\n*The reply was cut off: ";
const CUT_OFF_AT_END = /\n\n\*The reply was cut off: [^\n]*\*$/;
/** A reply's own words, without the cut-off notice Clem added after them. */
export const withoutCutOff = (text: string) => text.replace(CUT_OFF_AT_END, "");

/** Whether a message goes to the AI as part of the conversation: a failed reply and an empty one do not. */
export const sendable = (m: TurnMessage) => !m.failed && !!m.content.trim();

/**
 * The earlier messages as the AI gets them: failed and empty replies left out, and each earlier message's files named.
 * `current` is the message being answered: its own files go with the request (pictures, PDFs, the working folder's
 * list), so it is left as it is.
 */
export function replayTurns<M extends TurnMessage>(messages: M[], { current, nameOf }: { current?: string; nameOf: (id: string) => string | undefined }) {
  return messages.filter(sendable).map((m) => m.id === current ? m : { ...m, content: (m.role === "assistant" ? withoutCutOff(m.content) : m.content) + filesNote(m.attachments, nameOf) });
}

/**
 * What the chat says when its AI cannot answer because it is not signed in (signed out, a failed sign-in) or no AI is
 * connected: which AI, that the message is kept, and the two ways back. Said once, as a plain reply, never a pop-up.
 */
export function notReadyNotice(model: string, models: { id: string; name: string; provider?: string; connected: boolean }[]) {
  const chosen = models.find((m) => m.id === model);
  const others = models.filter((m) => m.connected && m.id !== model);
  if (!others.length) return chosen
    ? `**${chosen.name}** isn't signed in right now, so it couldn't answer. Your message is kept: sign in again in **Settings → Models**, then press Retry on your message.`
    : "Connect an AI in **Settings → Models** to start. Your message is kept: press Retry on it once one is connected.";
  return `**${chosen?.name || "The AI chosen for this chat"}** isn't signed in right now, so it couldn't answer. Your message is kept: pick another AI in the model menu (the conversation goes with it), or sign in again in **Settings → Models**, then press Retry on your message.`;
}
