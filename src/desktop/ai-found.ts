import type { CliKind } from "../ModelsSettings";

export type Cli = { installed?: boolean; connected?: boolean; email?: string; plan?: string };
export type Service = "chatgpt" | CliKind;
/** What the step found for one AI: connected in Clem already, signed in on this PC on its own, installed but signed
 *  out, or not installed. */
export type Found = "connected" | "pc" | "out" | "missing";
export type Detected = { codex?: { signedIn: boolean }; claude?: { signedIn: boolean; email?: string }; claudeInstalled?: boolean };

const rank: Record<Found, number> = { connected: 0, pc: 1, out: 2, missing: 3 };
/** Found ones first; when nothing is found, Google's Gemini leads, since it signs in with a Google account. */
export function orderServices(found: Record<Service, Found>) {
  const services: Service[] = ["chatgpt", "claude", "grok", "antigravity"];
  const none = services.every((s) => rank[found[s]] >= rank.out);
  const key = (s: Service) => (none && s === "antigravity" ? -1 : rank[found[s]]);
  return [...services].sort((a, b) => key(a) - key(b));
}
export function foundFor(service: Service, status: Cli, detected: Detected, chatgpt: boolean): Found {
  if (service === "chatgpt") return chatgpt ? "connected" : detected.codex?.signedIn ? "pc" : "out"; // Codex comes with Clem.
  if (status.connected) return "connected";
  if (service === "claude" && detected.claude?.signedIn && (status.installed || detected.claudeInstalled)) return "pc";
  return status.installed || (service === "claude" && detected.claudeInstalled) ? "out" : "missing";
}

