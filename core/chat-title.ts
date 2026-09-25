// Chat titles follow what a conversation is about, not just its first message. The answering model adds a hidden
// <!--title: …--> marker at the end of a reply when a chat needs a (new) title, so naming costs no extra request and
// never waits on the single-request desktop runtime. The marker is removed before anything is shown or saved.

const MARKER = /<!--\s*title:\s*([\s\S]*?)-->/gi;

/** Appended to the system prompt. `current` is null before the chat has a model-made title. */
export function titleInstruction(current: string | null) {
  return current
    ? `This chat is titled “${current}”. Only if the conversation as a whole has clearly moved on to a different subject, end your reply with <!--title: New Title--> (2–6 words naming what the whole chat is now about). Otherwise add nothing. Never mention the title.`
    : `End your reply with <!--title: Short Title--> (2–6 words naming what this chat is about, in the user's language, no quotes). Never mention the title.`;
}

function clean(title: string) {
  const t = title.replace(/[\r\n]+/g, " ").replace(/^["'“”‘’\s]+|["'“”‘’.\s]+$/g, "").replace(/\s+/g, " ").trim();
  return t.length >= 2 ? (t.length > 60 ? t.slice(0, 60).replace(/\s+\S*$/, "") + "…" : t) : undefined;
}

/** Splits a finished reply into what the user sees and the suggested title (the last marker wins). */
export function takeTitle(reply: string): { content: string; title?: string } {
  let title: string | undefined;
  for (const m of reply.matchAll(MARKER)) title = clean(m[1]) ?? title;
  return { content: reply.replace(MARKER, "").replace(/\s+$/, ""), title };
}

/** For text still streaming in: hides finished markers and one that has started but not closed. */
export function hideTitleMarker(text: string) {
  return text.replace(MARKER, "").replace(/<!-{0,2}(?:\s*t(?:i(?:t(?:l(?:e(?::[^>]*)?)?)?)?)?)?$/i, "").replace(/\s+$/, "");
}
