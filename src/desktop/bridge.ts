import {boundedConversation} from "../../core/chat-context.ts";
import type { DesktopBridge } from "../../desktop/contracts";
declare global {
  interface Window {
    mowrDesktop?: DesktopBridge;
  }
}
export const desktop = typeof window === "undefined" ? undefined : window.mowrDesktop;
export async function desktopChat(
  messages: { role: string; content: string }[],
  scope: string,
  signal: AbortSignal,
  onText: (text: string) => void,
  selection?: {model?:string;reasoning?:string},
  onArtifact?: (file:import("../../core/types").StoredFile)=>void,
) {
  messages=boundedConversation(messages);
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
      if(event.type === "artifact" && event.file){window.dispatchEvent(new CustomEvent("mowr:artifact",{detail:event}));onArtifact?.(event.file);}
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
      .invoke({ action: "chat", id, scope, messages: messages as any, ...selection as any })
      .catch((error) => {
        cleanup();
        reject(error);
      });
  });
}
