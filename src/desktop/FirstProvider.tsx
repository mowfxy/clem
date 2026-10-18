import { useEffect, useState, type ReactNode } from "react";
import { desktop } from "./bridge";
import { LocalProvider } from "./LocalProvider";
import { SetupButton, useCliConnect, type CliKind } from "../ModelsSettings";
import { OpenAILogo, ClaudeLogo, GrokLogo, AntigravityLogo } from "../BrandLogos";
import { Icon } from "../Icons";
import "../models-settings.css";

type Cli = { installed?: boolean; connected?: boolean; email?: string };
type Service = "chatgpt" | CliKind;

/** The last setup step: connect the AI subscription someone already has. Reports whether any is connected. */
export function FirstProvider({ onConnected }: { onConnected: (connected: boolean) => void }) {
  const [chatgpt, setChatgpt] = useState(false), [claude, setClaude] = useState<Cli>({}), [grok, setGrok] = useState<Cli>({}), [antigravity, setAntigravity] = useState<Cli>({});
  const [tab, setTab] = useState<Service>("chatgpt"), [error, setError] = useState(""), [checked, setChecked] = useState(false);
  async function refresh() {
    const [accounts, claudeStatus, grokStatus, antigravityStatus] = await Promise.all([
      desktop!.invoke({ action: "providerAccounts" }).catch(() => null),
      desktop!.invoke({ action: "claudeStatus" }).catch(() => ({})),
      desktop!.invoke({ action: "grokStatus" }).catch(() => ({})),
      desktop!.invoke({ action: "antigravityStatus" }).catch(() => ({})),
    ]);
    setChatgpt(!!accounts?.accounts?.some((a: { connected?: boolean }) => a.connected));
    // A status that comes back empty means not connected; it must never blank the setup screen.
    setClaude(claudeStatus || {}); setGrok(grokStatus || {}); setAntigravity(antigravityStatus || {}); setChecked(true);
  }
  const store = (kind: CliKind, status: Cli) => kind === "claude" ? setClaude(status) : kind === "grok" ? setGrok(status) : setAntigravity(status);
  const { setup, connect } = useCliConnect(store, refresh, setError);
  useEffect(() => { void refresh(); }, []);
  const connected = { chatgpt, claude: !!claude.connected, grok: !!grok.connected, antigravity: !!antigravity.connected };
  const any = connected.chatgpt || connected.claude || connected.grok || connected.antigravity;
  useEffect(() => { onConnected(any); }, [any]);
  // Someone who already connected one (on another PC, or before setup changed) starts on it.
  useEffect(() => { if (checked) setTab((t) => connected[t] ? t : connected.chatgpt ? "chatgpt" : connected.claude ? "claude" : connected.grok ? "grok" : connected.antigravity ? "antigravity" : t); }, [checked]);
  const services: { id: Service; name: string; logo: ReactNode }[] = [
    { id: "chatgpt", name: "ChatGPT", logo: <OpenAILogo size={16} /> },
    { id: "claude", name: "Claude", logo: <ClaudeLogo size={16} /> },
    { id: "grok", name: "Grok", logo: <GrokLogo size={16} /> },
    { id: "antigravity", name: "Antigravity", logo: <AntigravityLogo size={16} /> },
  ];
  const cli = tab === "claude" ? claude : tab === "grok" ? grok : antigravity;
  const card = { claude: { name: "Claude", install: "Claude Code", logo: <ClaudeLogo size={24} title="Claude" />, about: "Use your Claude plan through Claude Code.", account: "Claude" }, grok: { name: "Grok", install: "Grok", logo: <GrokLogo size={24} title="Grok" />, about: "Use your SuperGrok or X Premium plan.", account: "X or xAI" }, antigravity: { name: "Antigravity", install: "Antigravity", logo: <AntigravityLogo size={24} title="Antigravity" />, about: "Use your Google AI plan through Google Antigravity.", account: "Google" } };
  return <div className="first-provider">
    <div className="provider-switch" role="tablist" aria-label="AI services">
      {services.map((s) => <button key={s.id} type="button" role="tab" aria-selected={s.id === tab} className={"provider-switch-tab provider-" + s.id + (s.id === tab ? " on" : "")} onClick={() => setTab(s.id)}>
        <span className="provider-switch-logo">{s.logo}</span>{s.name}{connected[s.id] && <span className="provider-dot" aria-label="connected"><Icon name="plug" size={13} /></span>}
      </button>)}
    </div>
    <div key={tab} className="first-provider-body" role="tabpanel">
      {connected[tab]
        ? <p className="first-provider-done"><Icon name="check" size={16} />{services.find((s) => s.id === tab)!.name} is connected.{tab !== "chatgpt" && cli.email ? " " + cli.email : ""}</p>
        : tab === "chatgpt"
          ? <LocalProvider onDone={() => void refresh()} />
          : <article className={"provider-card provider-" + tab}>
            <div className="provider-card-top">
              <span className="provider-logo">{card[tab].logo}</span>
              <div className="provider-title"><h3>{card[tab].name}</h3><small>{card[tab].about}</small></div>
            </div>
            <SetupButton kind={tab} setup={setup} disabled={!checked} label={cli.installed ? `Sign in to ${card[tab].name}` : `Install ${card[tab].install}`} account={card[tab].account} onClick={() => void connect(tab, cli.installed)} />
          </article>}
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
