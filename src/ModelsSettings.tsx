import { useEffect, useState, useRef } from "react";
import type { Model } from "../core/types";
import { desktop } from "./desktop/bridge";
import {LocalProvider} from "./desktop/LocalProvider";
import { Icon } from "./Icons";
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
type Account = {
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
function Reconnect({id,onClose,onDone}:{id:string;onClose:()=>void;onDone:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{ref.current?.showModal();},[]);
 return <dialog ref={ref} className="settings-dialog" onCancel={onClose}><div className="modal-heading"><h2>Connect ChatGPT</h2><button aria-label="Close connection" onClick={onClose}><Icon name="close"/></button></div><LocalProvider accountId={id} onDone={onDone}/></dialog>;
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
}: {
  models: Model[];
  onConnect: () => void;
  onRefresh: () => Promise<void>;
  locked?: boolean;
}) {
  const [data, setData] = useState<{ active: string; accounts: Account[] }>({
      active: "",
      accounts: [],
    }),
    [retryId,setRetryId]=useState<string|null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
  useEffect(()=>{
    const onFocus=()=>{if(!busy)void refresh(true);};
    window.addEventListener("focus",onFocus);
    const timer=data.accounts.some(a=>a.pending)?setTimeout(onFocus,5000):undefined;
    return()=>{window.removeEventListener("focus",onFocus);clearTimeout(timer);};
  },[busy,data.accounts]);
  async function change(id: string, remove = false) {
    if (locked) return;
    if (
      remove &&
      !window.confirm(
        "Disconnect this account from Mowr? Your chats and files will stay.",
      )
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
      <div className="model-provider-summary">
        <span className="model-provider-mark">
          <Icon name="visuals" size={25} />
        </span>
        <div>
          <h3>Codex</h3>
          <p>
            Connect with ChatGPT. Available models sync from your active
            account.
          </p>
        </div>
        <button className="primary" disabled={locked} onClick={onConnect}>
          <Icon name="plus" size={15} />
          {data.accounts.some((a) => a.connected)
            ? "Add account"
            : "Connect account"}
        </button>
      </div>
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
        Each account keeps its own limits. Mowr uses the account you select.
      </p>
    </section>
  );
}
