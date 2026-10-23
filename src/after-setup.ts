import type { Service } from "./desktop/ai-found";

/** What the last setup step asked for once the workspace opens: the sample subject, the AI to use first, or Settings →
 *  Models for someone who connects later. Kept in this window's storage until the workspace has acted on it. */
export type AfterSetup = { sample: boolean; ai?: Service; settings?: "Models" };
const KEY = "clem-after-setup";
export const afterSetup = {
  set(value: AfterSetup) { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* without storage the workspace just opens as usual */ } },
  take(): AfterSetup | null {
    try { const raw = localStorage.getItem(KEY); localStorage.removeItem(KEY); const value = raw ? JSON.parse(raw) : null; return value && typeof value === "object" ? value : null; }
    catch { return null; }
  },
};
/** Whether a model belongs to the AI chosen in setup (ids as /api/models lists them). */
export function modelOf(service: Service, id: string) {
  if (service === "claude") return id.startsWith("claude:");
  if (service === "grok") return id.startsWith("grok:");
  if (service === "antigravity") return id.startsWith("antigravity:");
  return !/^(claude:|grok|antigravity:)/.test(id);
}
