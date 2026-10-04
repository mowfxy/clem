import {boundedConversation} from "../../core/chat-context.ts";
import {contextBudget} from "../../core/context-budget.ts";
import type { DesktopBridge } from "../../desktop/contracts";
import type { FileVersion, StoredFile } from "../../core/types";
declare global {
  interface Window {
    mowrDesktop?: DesktopBridge;
  }
}
export const desktop = typeof window === "undefined" ? undefined : window.mowrDesktop;
export type ChatOptions = {
  /** A temporary chat: nothing from it is remembered or kept. */
  temporary?: boolean;
  model?: string;
  reasoning?: string;
  images?: { name: string; data: string }[];
  /** Documents Mowr made in this conversation, so a change updates that same file. */
  documents?: { id: string; name: string }[];
  /** The full text of the chat's files, for the model's file tools (core/file-tools.ts); not added to the prompt. */
  library?: { name: string; text: string }[];
  /** Text-only answer (a document edit returning JSON): Mowr's tools are off, so it can never make a new file. */
  plain?: boolean;
  /** Send the whole conversation: the main process condenses older turns into a brief when it outgrows the model's window. */
  condense?: boolean;
  /** Mowr condensed the earlier part of a long chat into a brief for this answer. */
  onCondensed?: () => void;
  /** What Mowr is doing right now ("Searching the web…", "Typesetting the PDF…"). */
  onStatus?: (text: string) => void;
  /** Pictures of pages the model asks to look at ({"action":"look"}), drawn here where the files and pdf.js are. */
  look?: (file: string, pages: number[]) => Promise<{ name: string; data: string }[]>;
  /** The model's "regions" and "crop" on the conversation's PDFs and pictures (src/desktop/pdf-tasks.ts). */
  pdfTask?: (op: string, args: any) => Promise<{ data?: unknown; images?: { name: string; data: string }[]; files?: Uint8Array[] }>;
  /** The conversation, so crops the model cuts stay available to later answers in it. */
  chat?: string;
};
/** Within the request's limits (desktop/contracts.ts): at most 400 files (as many as a chat reads, MAX_CHAT_SOURCES) and 40 MB of text, the first files first. */
function fitLibrary(files: { name: string; text: string }[]) {
  let room = 40_000_000;
  return files.slice(0, 400).flatMap((f) => { const text = f.text.slice(0, Math.min(8_000_000, room)); room -= text.length; return text ? [{ name: f.name.slice(0, 400), text }] : []; });
}
/** The most a whole chat may carry to the main process (desktop/contracts.ts): the condenser summarises the older part anyway. */
export const MAX_CHAT_CHARACTERS = 60_000_000;
/** The newest messages within `count` and `characters`; system messages (the instructions) are always kept. */
export function newestWithin<T extends { role: string; content: string }>(messages: T[], count: number, characters: number) {
  const system = messages.filter((m) => m.role === "system"), rest = messages.filter((m) => m.role !== "system");
  let room = characters - system.reduce((n, m) => n + m.content.length, 0), keep = 0;
  for (let i = rest.length - 1; i >= 0 && keep < count - system.length && rest[i].content.length <= room; i--) { room -= rest[i].content.length; keep++; }
  const kept = new Set(rest.slice(rest.length - keep));
  return messages.filter((m) => m.role === "system" || kept.has(m));
}
export async function desktopChat(
  messages: { role: string; content: string }[],
  scope: string,
  signal: AbortSignal,
  onText: (text: string) => void,
  selection?: ChatOptions,
  onArtifact?: (file: StoredFile, revised?: { version: FileVersion }) => void,
) {
  const { onStatus, onCondensed, look, pdfTask, condense, ...options } = selection || {};
  messages=condense?newestWithin(messages,2000,MAX_CHAT_CHARACTERS):boundedConversation(messages,contextBudget(options.model).conversation);
  const id = crypto.randomUUID();
  let result = "";
  return new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      unsubscribe();
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      void desktop!.invoke({ action: "cancel", id });
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const unsubscribe = desktop!.onChat((event) => {
      if (event.id !== id) return;
      if(event.type === "artifact" && event.file){window.dispatchEvent(new CustomEvent("mowr:artifact",{detail:event}));onArtifact?.(event.file,event.revised);}
      if (event.type === "status" && event.text) onStatus?.(event.text);
      if (event.type === "condensed") onCondensed?.();
      if (event.type === "look" && event.look) {
        const reply = (result: { images?: { name: string; data: string }[]; error?: string }) => void desktop!.invoke({ action: "pageImages", id: event.look!, ...result }).catch(() => {});
        if (!look) reply({ error: "Pages cannot be looked at in this conversation." });
        else look(String(event.file || ""), (event.pages || []).map(Number)).then((images) => reply({ images: images.slice(0, 8) }), (error) => reply({ error: (error as Error).message }));
      }
      if (event.type === "pdfTask" && event.task) {
        const reply = (result: { data?: unknown; images?: { name: string; data: string }[]; files?: Uint8Array[]; error?: string }) => void desktop!.invoke({ action: "pdfTaskResult", id: event.task!, ...(result.data !== undefined ? { data: JSON.stringify(result.data) } : {}), ...(result.images ? { images: result.images.slice(0, 4) } : {}), ...(result.files ? { files: result.files.slice(0, 3) as Uint8Array<ArrayBuffer>[] } : {}), ...(result.error ? { error: result.error.slice(0, 500) } : {}) }).catch(() => {});
        if (!pdfTask) reply({ error: "PDFs and pictures cannot be worked on in this conversation." });
        else pdfTask(String(event.op || ""), event.args || {}).then(reply, (error: unknown) => reply({ error: (error as Error).message || "That could not be done." }));
      }
      if (event.type === "delta") {
        result += event.text || "";
        onText(result);
      }
      if (event.type === "done") {
        cleanup();
        resolve(result);
      }
      if (event.type === "error") {
        cleanup();
        reject(Error(event.error));
      }
    });
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    void desktop!
      .invoke({ action: "chat", id, scope, messages: messages as any, ...(options.model ? { model: options.model } : {}), ...(options.reasoning ? { reasoning: options.reasoning as any } : {}), ...(options.images?.length ? { images: options.images } : {}), ...(options.documents?.length ? { documents: options.documents.slice(-20) } : {}), ...(options.plain ? { plain: true } : {}), ...(options.chat && /^[a-zA-Z0-9_-]{1,80}$/.test(options.chat) ? { chat: options.chat } : {}), ...(options.temporary ? { temporary: true } : {}), ...(options.library?.length && !options.plain ? { library: fitLibrary(options.library) } : {}) })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
}
