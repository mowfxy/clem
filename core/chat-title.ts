// Chat titles and summaries follow what a conversation is about, not just its first message. The answering model adds
// hidden <!--title: …--> and <!--summary: …--> markers at the end of a reply, so naming costs no extra request and
// never waits on the single-request desktop runtime. The markers are removed before anything is shown or saved.
import type { Chat } from './types.ts';

const MARKER = /<!--\s*(title|summary|mark|chapter):\s*([\s\S]*?)-->/gi;

/** Appended to the system prompt. `current` is null before the chat has a model-made title. `mark` asks the model to pick the sidebar mark of the chat's subject or project. */
export function titleInstruction(current: string | null, mark?: { kind: string; name: string; description: string; keys: readonly string[] }, chapters: string[] = []) {
  const title = current
    ? `This chat is titled “${current}”. Only if the conversation as a whole has clearly moved on to a different subject, end your reply with <!--title: New Title--> (2–6 words naming what the whole chat is now about).`
    : `End your reply with <!--title: Short Title--> (2–6 words naming what this chat is about, in the user's language, no quotes).`;
  const chapter = chapters.length
    ? ` This chat is divided into chapters by topic: ${chapters.map((c) => `“${c}”`).join(", ")}. Only if the user's latest message starts a clearly different topic or task from the current chapter “${chapters.at(-1)}” (not a follow-up, clarification or next step of it), also add <!--chapter: Name--> (2–5 words naming the new topic).`
    : ` Also add <!--chapter: Name--> (2–5 words naming the topic of the user's request).`;
  return `${title}${chapter} Then always add <!--summary: …--> with one plain sentence (at most 25 words, in the user's language, no Markdown, LaTeX or dollar signs) saying what the whole conversation so far covers, written so the person can recognise the chat in a list, for example “Why partial derivatives are slopes along the x and y directions, with a worked example at (1, 1).”${mark ? ` Also add <!--mark: key--> naming the discipline of this ${mark.kind} “${mark.name}”${mark.description ? ` (${mark.description.slice(0, 200)})` : ""}, judged from its name, description and this conversation, as exactly one of: ${mark.keys.join(", ")}. Use “other” when none fits.` : ""} Never mention the title, summary, chapter or mark.`;
}

function clean(title: string) {
  const t = title.replace(/[\r\n]+/g, " ").replace(/^["'“”‘’\s]+|["'“”‘’.\s]+$/g, "").replace(/\s+/g, " ").trim();
  return t.length >= 2 ? (t.length > 60 ? t.slice(0, 60).replace(/\s+\S*$/, "") + "…" : t) : undefined;
}
function cleanSummary(summary: string) {
  const s = plainText(summary).replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "");
  return s.length >= 8 ? (s.length > 220 ? s.slice(0, 220).replace(/\s+\S*$/, "") + "…" : s) : undefined;
}

/** Splits a finished reply into what the user sees, the suggested title and the chat summary (the last marker of each wins). */
export function takeTitle(reply: string): { content: string; title?: string; summary?: string; mark?: string; chapter?: string } {
  let title: string | undefined, summary: string | undefined, mark: string | undefined, chapter: string | undefined;
  for (const m of reply.matchAll(MARKER)) {
    if (m[1].toLowerCase() === "title") title = clean(m[2]) ?? title;
    else if (m[1].toLowerCase() === "mark") mark = m[2].trim().toLowerCase() || mark;
    else if (m[1].toLowerCase() === "chapter") chapter = clean(m[2])?.slice(0, 48) ?? chapter;
    else summary = cleanSummary(m[2]) ?? summary;
  }
  return { content: reply.replace(MARKER, "").replace(/\s+$/, ""), title, ...(summary ? { summary } : {}), ...(mark ? { mark } : {}), ...(chapter ? { chapter } : {}) };
}

/** For text still streaming in: hides finished markers and one that has started but not closed. */
export function hideTitleMarker(text: string) {
  return text.replace(MARKER, "")
    // An unclosed marker hides everything after it, even a ">" in "A -> B", and "<!-- " before its name arrives.
    .replace(/<!-{0,2}(?:\s*(?:t(?:i(?:t(?:l(?:e(?::(?:(?!-->)[\s\S])*)?)?)?)?)?|s(?:u(?:m(?:m(?:a(?:r(?:y(?::(?:(?!-->)[\s\S])*)?)?)?)?)?)?)?|m(?:a(?:r(?:k(?::(?:(?!-->)[\s\S])*)?)?)?)?|c(?:h(?:a(?:p(?:t(?:e(?:r(?::(?:(?!-->)[\s\S])*)?)?)?)?)?)?)?))?\s*$/i, "")
    .replace(/\s+$/, "");
}

export type Chapter = { id: string; title: string };

/** A long chat's topics in order. Each starts at the question whose reply named it; chats from before chapters start with their title. */
export function chaptersOf(chat: Pick<Chat, "title" | "messages">): Chapter[] {
  const chapters: Chapter[] = [];
  chat.messages.forEach((m, i) => {
    if (m.role !== "assistant" || !m.chapter || chapters.at(-1)?.title.toLowerCase() === m.chapter.toLowerCase()) return;
    const question = chat.messages[i - 1];
    chapters.push({ id: question?.role === "user" ? question.id : m.id, title: m.chapter });
  });
  const first = chat.messages[0];
  if (first && chapters[0]?.id !== first.id) chapters.unshift({ id: first.id, title: chat.title });
  return chapters;
}

/** Markdown, LaTeX and code reduced to readable text for one-line previews. */
export function plainText(text: string) {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\\(?:frac|dfrac|tfrac)\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
    .replace(/\\partial\b\s*/g, "∂").replace(/\\(?:times|cdot)\b/g, "×").replace(/\\to\b|\\rightarrow\b/g, "→")
    .replace(/\\(alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega|phi|Delta|Omega)\b/g, (_, g: string) => ({ alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", omega: "ω", phi: "φ", Delta: "Δ", Omega: "Ω" })[g] || g)
    .replace(/\\(?:ce|text|mathrm|mathbf|operatorname|vec|hat)\{([^{}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/\$+/g, "")
    .replace(/[{}]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/(\*\*|__|\*|_|`|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
    .replace(/^\s*[-*+>]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** What a chat list shows under the title: the model's summary, else what the person asked, never the answer text. */
export function chatPreview(chat: Pick<Chat, "summary" | "messages">) {
  if (chat.summary) return chat.summary;
  const asks = chat.messages.filter((m) => m.role === "user").map((m) => plainText(m.content)).filter(Boolean);
  if (!asks.length) return "";
  const text = asks.length === 1 ? asks[0] : `${asks[0]} · then ${asks.slice(1).join(" · ")}`;
  return text.length > 200 ? text.slice(0, 200).replace(/\s+\S*$/, "") + "…" : text;
}
