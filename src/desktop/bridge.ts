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
  model?: string;
  reasoning?: string;
  images?: { name: string; data: string }[];
  /** Documents Mowr made in this conversation, so a change updates that same file. */
  documents?: { id: string; name: string }[];
  /** Text-only answer (a document edit returning JSON): Mowr's tools are off, so it can never make a new file. */
  plain?: boolean;
  /** What Mowr is doing right now ("Searching the web…", "Typesetting the PDF…"). */
  onStatus?: (text: string) => void;
};
export async function desktopChat(
  messages: { role: string; content: string }[],
  scope: string,
  signal: AbortSignal,
  onText: (text: string) => void,
  selection?: ChatOptions,
  onArtifact?: (file: StoredFile, revised?: { version: FileVersion }) => void,
) {
  const { onStatus, ...options } = selection || {};
  messages=boundedConversation(messages,contextBudget(options.model).conversation);
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
      .invoke({ action: "chat", id, scope, messages: messages as any, ...(options.model ? { model: options.model } : {}), ...(options.reasoning ? { reasoning: options.reasoning as any } : {}), ...(options.images?.length ? { images: options.images } : {}), ...(options.documents?.length ? { documents: options.documents.slice(-20) } : {}), ...(options.plain ? { plain: true } : {}) })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
}
