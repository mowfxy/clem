import { useEffect, useState, useRef } from "react";
import { confirmDialog } from "./dialogs";
import type { Model } from "../core/types";
import { desktop } from "./desktop/bridge";
import {LocalProvider} from "./desktop/LocalProvider";
import { Icon } from "./Icons";
import { OpenAILogo, ClaudeLogo } from "./BrandLogos";
import "./models-settings.css";
type WindowUsage = {
  usedPercent?: number | null;
  windowDurationMins?: number | null;
  resetsAt?: number | null;
};
type Bucket = {
  limitName?: string | null;
  primary?: WindowUsage | null;
  secondary?: WindowUsage | null;
  credits?: { balance?: string | null; unlimited?: boolean } | null;
};
export type Account = {
  id: string;
  connected: boolean;
  pending?:boolean;
  loginError?:string;
  email?: string;
  plan?: string;
  error?: string;
  usageError?: string;
  checkedAt?: number;
  usage?: {
    rateLimits?: Bucket;
    rateLimitsByLimitId?: Record<string, Bucket> | null;
    ordinaryUsageAllowed?: boolean | null;
  };
};
export type AccountsData = {active:string;accounts:Account[];resets?:{id:string;email?:string;windows:string[]}[];autoSwitch?:boolean};
function Reconnect({id,onClose,onDone}:{id:string;onClose:()=>void;onDone:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{ref.current?.showModal();},[]);
 return <dialog ref={ref} className="settings-dialog" onCancel={onClose}><header><span className="dialog-logo"><OpenAILogo size={20}/></span><h2>Connect ChatGPT</h2><button className="dialog-close" aria-label="Close connection" onClick={onClose}><Icon name="close" size={16}/></button></header><div className="settings-dialog-body"><LocalProvider accountId={id} onDone={onDone}/></div></dialog>;
}
function duration(minutes?: number | null) {
  if (!minutes) return "Usage window";
  if (minutes === 10080) return "Weekly";
  if (minutes % 1440 === 0) return minutes / 1440 + " days";
  return minutes % 60 === 0 ? minutes / 60 + " hours" : minutes + " minutes";
}
function Usage({ account }: { account: Account }) {
  const buckets =
    account.usage?.rateLimitsByLimitId &&
    Object.keys(account.usage.rateLimitsByLimitId).length
      ? Object.entries(account.usage.rateLimitsByLimitId)
      : account.usage?.rateLimits
        ? [["codex", account.usage.rateLimits] as const]
        : [];
  return (
    <div className="account-usage">
      {!buckets.length ? (
        <p className="usage-unavailable">
          {account.usageError ||
            "Usage is not available from the provider yet."}
        </p>
      ) : (
        buckets.map(([id, b]) => (
          <div className="usage-bucket" key={id}>
            <h4>{b.limitName || id}</h4>
            <div className="usage-windows">
              {[b.primary, b.secondary].filter(Boolean).map((w, i) => {
                const used =
                  typeof w!.usedPercent === "number" &&
                  Number.isFinite(w!.usedPercent)
                    ? Math.min(100, Math.max(0, w!.usedPercent))
                    : null;
                return (
                  <div className="usage-window" key={i}>
                    <div>
                      <span>{duration(w!.windowDurationMins)}</span>
                      <strong>
                        {used === null
                          ? "Unavailable"
                          : Math.round(100 - used) + "% left"}
                      </strong>
                    </div>
                    {used !== null && (
                      <progress
                        aria-label={
                          duration(w!.windowDurationMins) + " usage consumed"
                        }
                        max={100}
                        value={used}
                      />
                    )}
                    <small>
                      {w!.resetsAt
                        ? "Resets " +
                          new Date(w!.resetsAt! * 1000).toLocaleString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            },
                          )
                        : "Reset time unavailable"}
                    </small>
                  </div>
                );
              })}
            </div>
            {b.credits &&
              (b.credits.unlimited || b.credits.balance != null) && (
                <small>
                  {b.credits.unlimited
                    ? "Unlimited credits"
                    : "Credits: " + b.credits.balance}
                </small>
              )}
          </div>
        ))
      )}
      {account.usage?.ordinaryUsageAllowed === false && (
        <p role="status">
          Included usage is currently unavailable for this account.
        </p>
      )}
      {account.checkedAt && (
        <small className="usage-stamp">
          Reported by OpenAI · checked{" "}
          {new Date(account.checkedAt).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })}
        </small>
      )}
    </div>
  );
}
export function ModelsSettings({
  models,
  onConnect,
  onRefresh,
  locked = false,
  liveData,
}: {
  models: Model[];
  onConnect: () => void;
  onRefresh: () => Promise<void>;
  locked?: boolean;
  liveData?: AccountsData;
}) {
  const [data, setData] = useState<AccountsData>({
      active: "",
      accounts: [],
    }),
    [retryId,setRetryId]=useState<string|null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [claude,setClaude]=useState<{installed?:boolean;connected?:boolean;email?:string;plan?:string}>({}),
    [gemini,setGemini]=useState<{consented?:boolean;installed?:boolean;connected?:boolean;models?:string[];error?:string}>({});
  async function refresh(force = false) {
    setBusy(true);
    setError("");
    try {
      if (desktop) {
        const result = await desktop.invoke({
          action: "providerAccounts",
          refresh: force,
        });
        if (result?.accounts) setData(result);
        const [claudeStatus,geminiStatus]=await Promise.all([desktop.invoke({action:'claudeStatus'}),desktop.invoke({action:'antigravityStatus'})]);
        setClaude(claudeStatus);setGemini(geminiStatus);
      }
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(()=>{if(liveData)setData(liveData);},[liveData]);
  useEffect(()=>{
    const onFocus=()=>{if(!busy)void refresh(true);};
    window.addEventListener("focus",onFocus);
    const timer=data.accounts.some(a=>a.pending)?setTimeout(onFocus,5000):undefined;
    return()=>{window.removeEventListener("focus",onFocus);clearTimeout(timer);};
  },[busy,data.accounts]);
  async function change(id: string, remove = false) {
    if (locked) return;
    const account = data.accounts.find((a) => a.id === id);
    if (
      remove &&
      !(await confirmDialog({
        title: "Disconnect " + (account?.email || "this account") + "?",
        message: "Mowr will stop using this ChatGPT account. Your chats and files stay on this PC, and you can connect it again anytime.",
        confirm: "Disconnect",
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await desktop!.invoke({
        action: remove ? "providerAccountRemove" : "providerAccountSelect",
        id,
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="models-settings">
      <div className="models-heading">
        <div>
          <h2>Models & accounts</h2>
          <p>Your subscriptions. Your choice of model.</p>
        </div>
        <button
          className="model-refresh"
          aria-label="Refresh connections"
          disabled={busy || locked}
          onClick={() => void refresh(true)}
        >
          <Icon name="clock" size={16} />
          <span>{busy ? "Refreshing…" : "Refresh"}</span>
        </button>
      </div>
      <div className="provider-cards">
        <article className={"provider-card provider-openai" + (data.accounts.some((a) => a.connected) ? " is-connected" : "")}>
          <div className="provider-card-top">
            <span className="provider-logo"><OpenAILogo size={24} title="OpenAI" /></span>
            <span className={"provider-status" + (data.accounts.some((a) => a.connected) ? " on" : "")}>
              {data.accounts.some((a) => a.connected) ? (data.accounts.filter((a) => a.connected).length > 1 ? data.accounts.filter((a) => a.connected).length + " accounts" : "Connected") : "Not connected"}
            </span>
          </div>
          <h3>ChatGPT</h3>
          <p>Use your ChatGPT plan through Codex. Models sync from the active account.</p>
          <button className="provider-action primary" disabled={locked} onClick={onConnect}>
            <Icon name="plus" size={15} />
            {data.accounts.some((a) => a.connected) ? "Add another account" : "Connect ChatGPT"}
          </button>
        </article>
        {desktop && <article className={"provider-card provider-claude" + (claude.connected ? " is-connected" : "")}>
          <div className="provider-card-top">
            <span className="provider-logo"><ClaudeLogo size={24} title="Claude" /></span>
            <span className={"provider-status" + (claude.connected ? " on" : "")}>{claude.connected ? (claude.plan ? claude.plan.charAt(0).toUpperCase() + claude.plan.slice(1) : "Connected") : claude.installed ? "Sign-in needed" : "Not installed"}</span>
          </div>
          <h3>Claude</h3>
          <p>{claude.connected ? `${claude.email || "Claude account"} · usage limits aren’t reported by Claude Code` : claude.installed ? "Sign in with Claude Code to use your Claude subscription." : "Install the official Claude Code CLI to use your Claude subscription."}</p>
          {!claude.connected && <button className="provider-action" disabled={busy || locked} onClick={async () => { try { await desktop!.invoke({ action: claude.installed ? "claudeLogin" : "claudeInstall" }); if (claude.installed) setError("Finish Claude sign-in in the terminal, then refresh."); } catch (e) { setError((e as Error).message); } }}>{claude.installed ? "Sign in to Claude" : "Install Claude Code"}<Icon name="arrow" size={14} /></button>}
        </article>}
        {desktop && <article className={"provider-card provider-gemini" + (gemini.connected ? " is-connected" : "")}>
          <div className="provider-card-top">
            <span className="provider-logo" aria-hidden="true">G</span>
            <span className={"provider-status" + (gemini.connected ? " on" : "")}>{!gemini.consented ? "Off" : gemini.connected ? `${gemini.models?.length} models` : gemini.installed ? "Sign-in needed" : "Not installed"}</span>
          </div>
          <h3>Gemini</h3>
          <p>{!gemini.consented ? "Use your Google AI Pro or Ultra plan through Google’s Antigravity CLI." : gemini.connected ? "Signed in through Antigravity CLI · usage limits aren’t reported" : gemini.installed ? (gemini.error || "Sign in to Antigravity CLI with your Google account.") : "Install Google’s Antigravity CLI, then sign in."}</p>
          {gemini.consented && <p className="provider-risk">Google hasn’t confirmed that apps like Mowr may use Antigravity. Your account could be restricted.</p>}
          {!gemini.consented && <button className="provider-action" disabled={busy || locked} onClick={async () => {
            if (!await confirmDialog({ title: "Use Gemini through Antigravity CLI?", confirm: "I understand, turn on", danger: true,
              message: "Mowr will run Google’s official Antigravity CLI on this PC, signed in to your own Google account, and use your Google AI plan’s quota. Mowr never sees your Google password or sign-in tokens, and nothing goes through Mowr’s servers.\n\nGoogle’s Antigravity terms say that using third-party software to access the service is a breach, and Google has suspended accounts for it. Google has not said whether running its own CLI from an app like Mowr is allowed. You could lose access to Antigravity or Gemini CLI on this Google account.\n\nMowr isn’t affiliated with or endorsed by Google. You can turn this off anytime." })) return;
            try { await desktop!.invoke({ action: "antigravityConsent", accepted: true }); await refresh(true); } catch (e) { setError((e as Error).message); } }}>Turn on Gemini<Icon name="arrow" size={14} /></button>}
          {gemini.consented && !gemini.connected && <button className="provider-action" disabled={busy || locked} onClick={async () => { try { await desktop!.invoke({ action: gemini.installed ? "antigravityLogin" : "antigravityInstall" }); setError(gemini.installed ? "Finish Google sign-in in the Antigravity window, then refresh." : "Install Antigravity CLI with the command on Google’s page, then refresh."); } catch (e) { setError((e as Error).message); } }}>{gemini.installed ? "Sign in to Antigravity" : "Install Antigravity CLI"}<Icon name="arrow" size={14} /></button>}
          {gemini.consented && <button className="provider-action provider-off" disabled={busy || locked} onClick={async () => { try { await desktop!.invoke({ action: "antigravityConsent", accepted: false }); await refresh(true); } catch (e) { setError((e as Error).message); } }}>Turn off</button>}
        </article>}
      </div>
      {desktop && <div className="setting-row auto-switch-setting"><div><h3>Switch accounts automatically</h3><p>Before each request, use another connected ChatGPT account when this one falls below 10% in its short window or 5% weekly. A running response finishes on its current account.</p></div><label className="switch-label"><input type="checkbox" aria-label="Switch accounts automatically" checked={!!data.autoSwitch} disabled={busy||locked} onChange={async e=>{const enabled=e.target.checked;setBusy(true);try{await desktop!.invoke({action:'providerAutoSwitch',enabled});setData(current=>({...current,autoSwitch:enabled}));}catch(error){setError((error as Error).message);}finally{setBusy(false);}}}/></label></div>}
      {retryId&&<Reconnect id={retryId} onClose={()=>setRetryId(null)} onDone={()=>{setRetryId(null);void refresh(true);}}/>}
      {error && <p role="alert">{error}</p>}
      <div className="connected-accounts">
        {data.accounts
          .filter((a) => a.connected || a.error || a.id !== "default")
          .map((a) => (
            <article className="connected-account" key={a.id}>
              <header>
                <div>
                  <h3>{a.email || "ChatGPT account"}</h3>
                  <p>
                    {a.connected ? a.plan || "Connected" : a.pending ? "Waiting for browser sign-in" : "Connection needs attention"}
                    {a.id === data.active && a.connected && (
                      <span className="account-active">Active</span>
                    )}
                  </p>
                </div>
                <div className="account-actions">
                  {a.connected && a.id !== data.active && (
                    <button disabled={busy || locked} onClick={() => void change(a.id)}>
                      Use account
                    </button>
                  )}
                  <button
                    className="icon-button"
                    disabled={busy || locked}
                    aria-label={"Disconnect " + (a.email || "account")}
                    onClick={() => void change(a.id, true)}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              </header>
              {a.error ? (
                <p role="alert">{a.error}</p>
              ) : a.connected ? (
                <Usage account={a} />
              ) : (
                <div className="account-recovery"><div><p>{a.loginError || (a.pending?"Finish in your browser, then return here.":"Your ChatGPT account is not connected to Mowr yet.")}</p></div><button className="secondary" disabled={busy||locked} onClick={()=>setRetryId(a.id)}>{a.pending?"Continue sign-in":"Retry sign-in"}<Icon name="arrow" size={16}/></button></div>
              )}
            </article>
          ))}
      </div>
      {models.some((m) => m.connected) && (
        <details className="synced-models">
          <summary>
            {models.filter((m) => m.connected).length} available models{" "}
            <Icon name="down" size={14} />
          </summary>
          <div>
            {models
              .filter((m) => m.connected)
              .map((m) => (
                <span key={m.id}>{m.name}</span>
              ))}
          </div>
          <p>Choose a model and reasoning level in the chat composer.</p>
        </details>
      )}
      <p className="models-footnote">
        Usage covers the whole connected account, including other Codex apps.
        Each account keeps its own limits. Automatic switching applies to connected ChatGPT accounts only.
      </p>
    </section>
  );
}
