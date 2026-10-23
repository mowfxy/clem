import { useEffect, useState, type ReactNode } from "react";
import { desktop } from "./bridge";
import { LocalProvider } from "./LocalProvider";
import { SetupButton, useCliConnect, type CliKind } from "../ModelsSettings";
import { OpenAILogo, ClaudeLogo, GrokLogo, GeminiLogo } from "../BrandLogos";
import { Icon } from "../Icons";
import "../models-settings.css";

import { foundFor, orderServices, type Cli, type Detected, type Found, type Service } from "./ai-found";
export type { Service };

const names: Record<Service, { name: string; cli: string; logo: ReactNode; account: string }> = {
  chatgpt: { name: "ChatGPT", cli: "Codex", logo: <OpenAILogo size={22} title="ChatGPT" />, account: "OpenAI" },
  claude: { name: "Claude", cli: "Claude Code", logo: <ClaudeLogo size={22} title="Claude" />, account: "Claude" },
  grok: { name: "Grok", cli: "Grok", logo: <GrokLogo size={22} title="Grok" />, account: "X or xAI" },
  antigravity: { name: "Gemini", cli: "Antigravity", logo: <GeminiLogo size={22} title="Gemini" />, account: "Google" },
};
/**
 * The last setup step: what's on this PC, read without signing in or spending anything, and one button per AI:
 * Connect (connected or signed in already), Sign in (installed), or Install and connect. Reports the AI chosen.
 */
export function FirstProvider({ onChosen }: { onChosen: (service: Service | null) => void }) {
  const [chatgpt, setChatgpt] = useState(false), [cli, setCli] = useState<Record<CliKind, Cli>>({ claude: {}, grok: {}, antigravity: {} }), [detected, setDetected] = useState<Detected>({});
  const [checked, setChecked] = useState(false), [error, setError] = useState(""), [chosen, setChosen] = useState<Service | null>(null), [codexOpen, setCodexOpen] = useState(false);
  const [waiting, setWaiting] = useState<Service | null>(null);
  async function refresh() {
    const [accounts, claude, grok, antigravity, found] = await Promise.all([
      desktop!.invoke({ action: "providerAccounts" }).catch(() => null),
      desktop!.invoke({ action: "claudeStatus" }).catch(() => ({})),
      desktop!.invoke({ action: "grokStatus" }).catch(() => ({})),
      desktop!.invoke({ action: "antigravityStatus" }).catch(() => ({})),
      desktop!.invoke({ action: "aiDetect" }).catch(() => ({})),
    ]);
    setChatgpt(!!accounts?.accounts?.some((a: { connected?: boolean }) => a.connected));
    // A status that comes back empty means not connected; it must never blank the setup screen.
    setCli({ claude: claude || {}, grok: grok || {}, antigravity: antigravity || {} });
    setDetected(found || {});
    setChecked(true);
  }
  const store = (kind: CliKind, status: Cli) => setCli((c) => ({ ...c, [kind]: status }));
  const { setup, connect } = useCliConnect(store, async () => { await refresh(); }, setError);
  useEffect(() => { void refresh(); }, []);
  const found = Object.fromEntries((["chatgpt", "claude", "grok", "antigravity"] as Service[]).map((s) => [s, foundFor(s, s === "chatgpt" ? {} : cli[s], detected, chatgpt)])) as Record<Service, Found>;
  // A sign-in started here that has finished: that AI is the one chosen.
  useEffect(() => { if (waiting && found[waiting] === "connected") { setChosen(waiting); setWaiting(null); } }, [waiting, found[waiting || "chatgpt"]]);
  useEffect(() => { onChosen(chosen); }, [chosen]);
  const press = (service: Service) => {
    setError("");
    if (found[service] === "connected") return setChosen(service);
    if (service === "chatgpt") return setCodexOpen(true);
    setWaiting(service);
    void connect(service, found[service] !== "missing");
  };
  const detail = (service: Service) => {
    const f = found[service], n = names[service], status = service === "chatgpt" ? {} : cli[service];
    if (f === "connected") return `Connected in Clem${status.email ? " as " + status.email : ""}${status.plan ? " · " + status.plan : ""}.`;
    // Clem keeps a sign-in of its own, so connecting asks once and never changes the CLI's own settings.
    if (f === "pc") return `${n.cli} is signed in on this PC${service === "claude" && detected.claude?.email ? " as " + detected.claude.email : ""}. Clem signs in once with its own copy, so your ${n.cli} settings stay as they are.`;
    if (f === "out") return service === "chatgpt" ? "Sign in with your ChatGPT account." : `${n.cli} is installed. Sign in with your ${n.account} account.`;
    return service === "antigravity" ? "Uses your Google account. What you can use without a paid Google AI plan is up to Google." : `${n.cli} isn't installed. Clem can install it for you.`;
  };
  const label = (service: Service) => found[service] === "connected" || found[service] === "pc" ? "Connect" : found[service] === "out" ? "Sign in" : "Install and connect";
  return <div className="first-provider first-ai">
    {!checked && <p className="first-ai-checking" role="status"><span className="provider-spinner" aria-hidden="true" />Looking for AI apps on this PC…</p>}
    {checked && <ul className="first-ai-list" aria-label="AI services">
      {orderServices(found).map((service) => {
        const n = names[service], on = chosen === service;
        return <li key={service} className={"first-ai-row provider-" + service} data-found={found[service]} data-chosen={on || undefined}>
          <span className="provider-logo">{n.logo}</span>
          <div className="first-ai-text"><h3>{n.name}</h3><small>{detail(service)}</small></div>
          <div className="first-ai-action">
            {on ? <span className="first-provider-done"><Icon name="check" size={16} />Connected</span>
              : service === "chatgpt" ? (!codexOpen && <button className="provider-action" disabled={!!setup} onClick={() => press(service)}>{label(service)}<Icon name="arrow" size={14} /></button>)
              : <SetupButton kind={service} setup={setup} disabled={!!setup && setup.kind !== service} label={label(service)} account={n.account} onClick={() => press(service)} />}
          </div>
          {service === "chatgpt" && codexOpen && !on && <div className="first-ai-codex"><LocalProvider onDone={() => { setCodexOpen(false); void refresh().then(() => setChosen("chatgpt")); }} /></div>}
        </li>;
      })}
    </ul>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
