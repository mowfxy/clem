import { useEffect, useState, useRef, type ReactNode } from "react";
import { confirmDialog } from "./dialogs";
import type { Model } from "../core/types";
import { desktop } from "./desktop/bridge";
import {LocalProvider} from "./desktop/LocalProvider";
import { Icon } from "./Icons";
import { OpenAILogo, ClaudeLogo, GrokLogo, GeminiLogo } from "./BrandLogos";
import { ModelSelector } from "./ModelSelector";
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
  installed?: boolean;
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
  if (!minutes) return "Usage";
  if (minutes === 10080) return "Weekly";
  if (minutes === 43200) return "Monthly";
  if (minutes % 1440 === 0) return minutes / 1440 + " days";
  return minutes % 60 === 0 ? minutes / 60 + " hours" : minutes + " minutes";
}
const when = (seconds: number) => {
  const date = new Date(seconds * 1000), soon = date.getTime() - Date.now() < 20 * 3600_000;
  return date.toLocaleString(undefined, soon ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const VENDOR: Record<Service, string> = { chatgpt: "OpenAI", claude: "Anthropic", grok: "xAI", antigravity: "Google" };
/** Each usage window as a thin meter of what is left, with when it resets. */
function Usage({ account, service }: { account: Account; service: Service }) {
  const buckets =
    account.usage?.rateLimitsByLimitId && Object.keys(account.usage.rateLimitsByLimitId).length
      ? Object.entries(account.usage.rateLimitsByLimitId)
      : account.usage?.rateLimits ? [["", account.usage.rateLimits] as const] : [];
  const windows = buckets.flatMap(([id, b]) => [b.primary, b.secondary].filter((w): w is WindowUsage => !!w).map((w) => ({ name: (buckets.length > 1 ? (b.limitName || id) + " · " : "") + duration(w.windowDurationMins), w })));
  const credits = buckets.map(([, b]) => b.credits).find((c) => c && (c.unlimited || c.balance != null));
  return <div className="account-usage">
    {!windows.length
      ? <p className="usage-unavailable">{account.usageError || (service === "claude" ? "Usage appears after this account's first answer." : "Usage is not available from the provider yet.")}</p>
      : <div className="usage-meters">{windows.map(({ name, w }, i) => {
          const used = typeof w.usedPercent === "number" && Number.isFinite(w.usedPercent) ? Math.min(100, Math.max(0, w.usedPercent)) : null;
          const left = used === null ? null : Math.round(100 - used);
          return <div className={"usage-meter" + (left !== null && left < 10 ? " is-low" : left !== null && left < 25 ? " is-warn" : "")} key={i}>
            <div className="usage-meter-line"><span>{name}</span><b>{left === null ? "—" : left + "% left"}</b></div>
            <div className="usage-meter-track" role={left === null ? undefined : "meter"} aria-label={name + " usage left"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={left ?? undefined}><span style={{ width: (left ?? 0) + "%" }} /></div>
            <small>{w.resetsAt ? "Resets " + when(w.resetsAt) : "Reset time unavailable"}</small>
          </div>;
        })}</div>}
    {(credits || account.usage?.ordinaryUsageAllowed === false || account.checkedAt) && <div className="usage-foot">
      {account.usage?.ordinaryUsageAllowed === false && <span className="usage-out">No usage left until it resets</span>}
      {credits && <span>{credits.unlimited ? "Unlimited credits" : "Credits: " + credits.balance}</span>}
      {account.checkedAt && <span>{VENDOR[service]} · checked {new Date(account.checkedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>}
    </div>}
  </div>;
}
const LOGO: Record<Service, (size: number) => ReactNode> = {
  chatgpt: (size) => <OpenAILogo size={size} title="OpenAI" />,
  claude: (size) => <ClaudeLogo size={size} title="Claude" />,
  grok: (size) => <GrokLogo size={size} title="Grok" />,
  antigravity: (size) => <GeminiLogo size={size} title="Gemini" />,
};
const NAME: Record<Service, string> = { chatgpt: "ChatGPT", claude: "Claude", grok: "Grok", antigravity: "Gemini" };
/** One connected account: who it is, its plan, whether it is in use, and what it has left. */
function AccountRow({ account, index, service, active, busy, onUse, onRemove, onSignIn }: {
  account: Account; index: number; service: Service; active: boolean; busy: boolean;
  onUse: () => void; onRemove: () => void; onSignIn: () => void;
}) {
  const label = account.email || NAME[service] + " account" + (index ? " " + (index + 1) : "");
  // Google names its plans itself ("Google AI Pro").
  const plan = account.plan ? (service === "grok" ? planName(account.plan) : service === "antigravity" ? account.plan : account.plan.charAt(0).toUpperCase() + account.plan.slice(1)) : "";
  return <article className={"account-row" + (active && account.connected ? " is-active" : "")}>
    <div className="account-row-head">
      <span className="account-avatar" aria-hidden="true">{(account.email || NAME[service]).charAt(0).toUpperCase()}</span>
      <div className="account-id">
        <b title={label}>{label}</b>
        <small>{account.connected ? <>{plan || "Connected"}{active && <span className="account-active"><Icon name="check" size={11} />In use</span>}</> : account.pending ? "Waiting for browser sign-in" : "Not signed in"}</small>
      </div>
      <div className="account-actions">
        {account.connected && !active && <button type="button" className="account-use" disabled={busy} onClick={onUse}>Use</button>}
        <button type="button" className="icon-button" disabled={busy} aria-label={"Disconnect " + label} onClick={onRemove}><Icon name="close" size={14} /></button>
      </div>
    </div>
    {account.error ? <p className="account-note" role="alert">{account.error}</p>
      : account.connected ? <Usage account={account} service={service} />
      : <div className="account-recovery"><p>{account.loginError || (account.pending ? "Finish in your browser, then return here." : `This ${NAME[service]} account is not signed in.`)}</p><button type="button" className="secondary" disabled={busy} onClick={onSignIn}>{account.pending ? "Open sign-in again" : "Sign in"}<Icon name="arrow" size={14} /></button></div>}
  </article>;
}
type CliStatus = { installed?: boolean; connected?: boolean; email?: string; plan?: string; models?: string[]; error?: string };
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
    [claude,setClaude]=useState<CliStatus>({}),
    [grok,setGrok]=useState<CliStatus>({}),
    [antigravity,setAntigravity]=useState<CliStatus>({}),
    [cli,setCli]=useState<Record<CliKind,AccountsData>>({claude:{active:"default",accounts:[]},grok:{active:"default",accounts:[]},antigravity:{active:"default",accounts:[]}}),
    [tab,setTab]=useState<Service|null>(()=>{try{const saved=localStorage.getItem("clem-provider-tab");return saved==="chatgpt"||saved==="claude"||saved==="grok"||saved==="antigravity"?saved:null;}catch{return null;}});
  const store=(kind:CliKind,status:any)=>kind==="claude"?setClaude(status):kind==="grok"?setGrok(status):setAntigravity(status);
  const {setup,connect:connectCli}=useCliConnect(store,async()=>{await loadCli("claude");await loadCli("grok");await loadCli("antigravity");await onRefresh();},setError);
  async function loadCli(kind: CliKind, force = false) {
    const result = await desktop!.invoke({ action: "cliAccounts", kind, refresh: force }) as AccountsData;
    if (result?.accounts) setCli((current) => ({ ...current, [kind]: result }));
    return result;
  }
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
        const [claudeStatus,grokStatus,antigravityStatus]=await Promise.all([desktop.invoke({action:'claudeStatus'}),desktop.invoke({action:'grokStatus'}),desktop.invoke({action:'antigravityStatus'}),loadCli("claude",force),loadCli("grok",force),loadCli("antigravity",force)]);
        setClaude(claudeStatus);setGrok(grokStatus);setAntigravity(antigravityStatus);
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
    // An account waiting for its browser sign-in is checked every few seconds until it connects.
    const waiting=data.accounts.some(a=>a.pending);
    const cliWaiting=(["claude","grok","antigravity"] as const).filter(kind=>cli[kind].accounts.some(a=>a.pending));
    const timer=waiting?setTimeout(onFocus,5000):undefined;
    const cliTimer=cliWaiting.length?setInterval(()=>{for(const kind of cliWaiting)void loadCli(kind,true).then(()=>onRefresh()).catch(()=>{});},4000):undefined;
    return()=>{window.removeEventListener("focus",onFocus);clearTimeout(timer);clearInterval(cliTimer);};
  },[busy,data.accounts,cli]);
  async function run(work: () => Promise<unknown>) {
    if (locked) return;
    setBusy(true);
    setError("");
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function confirmRemove(service: Service, account: Account) {
    return confirmDialog({
      title: "Disconnect " + (account.email || "this " + NAME[service] + " account") + "?",
      message: `Clem will stop using this ${NAME[service]} account. Your chats and files stay on this PC, and you can connect it again anytime.`,
      confirm: "Disconnect",
      danger: true,
    });
  }
  async function change(id: string, remove = false) {
    const account = data.accounts.find((a) => a.id === id);
    if (remove && account && !(await confirmRemove("chatgpt", account))) return;
    await run(async () => {
      await desktop!.invoke({ action: remove ? "providerAccountRemove" : "providerAccountSelect", id });
      await refresh();
    });
  }
  async function changeCli(kind: CliKind, id: string, what: "use" | "remove" | "signin") {
    const account = cli[kind].accounts.find((a) => a.id === id);
    if (what === "remove" && account && !(await confirmRemove(kind, account))) return;
    await run(async () => {
      await desktop!.invoke(what === "use" ? { action: "cliAccountSelect", kind, id } : what === "remove" ? { action: "cliAccountRemove", kind, id } : { action: "cliAccountSignIn", kind, id });
      await loadCli(kind, true);
      if (what !== "signin") await onRefresh();
    });
  }
  const addCli = (kind: CliKind) => run(async () => { await desktop!.invoke({ action: "cliAccountAdd", kind }); await loadCli(kind); });
  const chatgptAccounts = data.accounts.filter((a) => a.connected).length;
  const counts: Record<Service, number> = { chatgpt: chatgptAccounts, claude: cli.claude.accounts.filter((a) => a.connected).length || (claude.connected ? 1 : 0), grok: cli.grok.accounts.filter((a) => a.connected).length || (grok.connected ? 1 : 0), antigravity: cli.antigravity.accounts.filter((a) => a.connected).length || (antigravity.connected ? 1 : 0) };
  const services: Service[] = desktop ? ["chatgpt", "claude", "grok", "antigravity"] : ["chatgpt"];
  // Until someone picks a tab, open on the first connected service.
  const current = services.find((x) => x === tab) || services.find((x) => counts[x] > 0) || services[0];
  const pick = (id: Service) => { setTab(id); try { localStorage.setItem("clem-provider-tab", id); } catch {} };
  const status = current === "claude" ? claude : current === "grok" ? grok : current === "antigravity" ? antigravity : null;
  const listed: AccountsData = current === "chatgpt" ? data : cli[current];
  const rows = listed.accounts.filter((a) => a.connected || a.pending || a.error || a.id !== "default");
  const count = counts[current];
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
      <section className="provider-panel">
        {services.length > 1 && <div className="provider-switch" role="tablist" aria-label="AI services">
          {services.map((x) => <button key={x} type="button" role="tab" aria-selected={x === current} className={"provider-switch-tab provider-" + x + (x === current ? " on" : "")} onClick={() => pick(x)}>
            <span className="provider-switch-logo">{LOGO[x](16)}</span>{NAME[x]}{counts[x] > 0 && <span className="provider-dot" aria-label="connected"><Icon name="plug" size={13} /></span>}
          </button>)}
        </div>}
        <div key={current} className={"provider-group provider-" + current} role="tabpanel">
          <div className={"provider-head" + (count ? " is-connected" : "")}>
            <span className="provider-logo">{LOGO[current](20)}</span>
            <div className="provider-title">
              <h3>{NAME[current]}</h3>
              <small>{count ? count + (count > 1 ? " accounts" : " account") + " connected" : status && !status.installed && current !== "chatgpt" ? `${CLI[current].name} is not installed` : "Not connected"}</small>
            </div>
            {current === "chatgpt"
              ? <button className="provider-action" disabled={locked} onClick={onConnect}>{count ? "Add account" : "Connect ChatGPT"}<Icon name={count ? "plus" : "arrow"} size={14} /></button>
              : count
                ? <button className="provider-action" disabled={busy || locked} onClick={() => void addCli(current)}>Add account<Icon name="plus" size={14} /></button>
                : <SetupButton kind={current} setup={setup} disabled={busy || locked} label={status?.installed ? "Sign in to " + NAME[current] : "Install " + CLI[current].name} account={current === "claude" ? "Claude" : current === "antigravity" ? "Google" : "X or xAI"} onClick={() => void connectCli(current, status?.installed)} />}
          </div>
          {current === "grok" && !count && grok.installed && grok.error && <p className="provider-hint">{grok.error}</p>}
          {current === "antigravity" && !count && antigravity.installed && antigravity.error && <p className="provider-hint">{antigravity.error}</p>}
          {rows.length > 0 && <div className="account-list">
            {rows.map((a, i) => <AccountRow key={a.id} account={a} index={i} service={current} active={a.id === listed.active} busy={busy || locked}
              onUse={() => void (current === "chatgpt" ? change(a.id) : changeCli(current, a.id, "use"))}
              onRemove={() => void (current === "chatgpt" ? change(a.id, true) : changeCli(current, a.id, "remove"))}
              onSignIn={() => current === "chatgpt" ? setRetryId(a.id) : void changeCli(current, a.id, "signin")} />)}
          </div>}
        </div>
      </section>
      {desktop && <div className="setting-row auto-switch-setting"><div><h3>Switch accounts automatically</h3><p>Moves to another account when one runs low.</p></div><label className="switch-label"><input type="checkbox" aria-label="Switch accounts automatically" checked={!!data.autoSwitch} disabled={busy||locked} onChange={async e=>{const enabled=e.target.checked;setBusy(true);try{await desktop!.invoke({action:'providerAutoSwitch',enabled});setData(current=>({...current,autoSwitch:enabled}));}catch(error){setError((error as Error).message);}finally{setBusy(false);}}}/></label></div>}
      {desktop && <HelperModelSetting models={models} locked={locked} />}
      {retryId&&<Reconnect id={retryId} onClose={()=>setRetryId(null)} onDone={()=>{setRetryId(null);void refresh(true);}}/>}
      {error && <p role="alert">{error}</p>}
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
        </details>
      )}
    </section>
  );
}

type HelperChoice = { model?: string; reasoning?: string };
/**
 * The model for Clem's side jobs (naming uploaded files, memory notes, condensing a long chat), never the person's own
 * tasks. Automatic keeps them on the AI being chatted with, at its lightest; a chosen model that later cannot answer
 * (signed out, off the plan) falls back to automatic for that job (desktop/main.ts quickAsk).
 */
function HelperModelSetting({ models, locked }: { models: Model[]; locked: boolean }) {
  const [choice, setChoice] = useState<HelperChoice | null>(null), [error, setError] = useState("");
  useEffect(() => { let live = true; desktop!.invoke({ action: "helperModel" }).then((c) => { if (live) setChoice((c as HelperChoice) || {}); }, () => { if (live) setChoice({}); }); return () => { live = false; }; }, []);
  const missing = !!choice?.model && !models.some((m) => m.connected && m.id === choice.model);
  const save = async (next: HelperChoice) => {
    const before = choice;
    setChoice(next); setError("");
    try { setChoice((await desktop!.invoke({ action: "helperModel", set: next })) as HelperChoice); }
    catch (e) { setChoice(before); setError((e as Error).message || "Could not save the choice."); }
  };
  return <div className="setting-row helper-model-setting">
    <div>
      <h3>Background tasks</h3>
      <p>{missing ? "Your chosen model isn't available right now, so Automatic is used." : "Naming files, memory and condensing long chats."}</p>
      {error && <p role="alert">{error}</p>}
    </div>
    {/* The composer's own picker, so choosing here looks and works the same; Automatic keeps the chat's AI, at its lightest. */}
    <div className="helper-model-picker">
      <ModelSelector models={models} value={missing ? "" : choice?.model || ""} auto="Automatic" label="Model for background tasks" disabled={!choice || locked}
        onChange={(id) => void save(id ? { model: id } : {})}
        effort={choice?.reasoning} onEffort={choice?.model ? (level) => void save({ model: choice.model, reasoning: level }) : undefined} />
    </div>
  </div>;
}
export type CliKind = "claude" | "grok" | "antigravity";
type Service = "chatgpt" | CliKind;
const CLI = {
  claude: { name: "Claude Code", owner: "Anthropic", terms: "anthropic.com/legal/consumer-terms", status: "claudeStatus", install: "claudeInstall", login: "claudeLogin" },
  grok: { name: "Grok", owner: "xAI", terms: "x.ai/legal/terms-of-service", status: "grokStatus", install: "grokInstall", login: "grokLogin" },
  antigravity: { name: "Gemini", owner: "Google", terms: "antigravity.google/terms", status: "antigravityStatus", install: "antigravityInstall", login: "antigravityLogin" },
} as const;
/** SUPERGROK_PRO → SuperGrok Pro, X_PREMIUM_PLUS → X Premium+ */
function planName(tier: string) {
  const t = tier.replace(/^SUBSCRIPTION_TIER_/i, "").toLowerCase();
  if (/premium.?plus|premium\+/.test(t)) return "X Premium+";
  return t.split(/[_\s-]+/).filter(Boolean).map(w => w === "supergrok" ? "SuperGrok" : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
/** One button that walks through install → sign-in, showing where it's up to. */
export function SetupButton({ kind, setup, disabled, label, account, onClick }: { kind: CliKind; setup: { kind: CliKind; step: "installing" | "signing" } | null; disabled: boolean; label: string; account: string; onClick: () => void }) {
  const mine = setup?.kind === kind ? setup.step : null;
  return <>
    <button className={"provider-action" + (mine ? " is-working" : "")} disabled={disabled || !!setup} onClick={onClick} aria-busy={mine === "installing" || undefined}>
      {mine === "installing" ? <><span className="provider-spinner" aria-hidden="true" />Installing…</> : mine === "signing" ? <><span className="provider-spinner" aria-hidden="true" />Waiting for sign-in…</> : <>{label}<Icon name="arrow" size={14} /></>}
    </button>
    {mine === "installing" && <p className="provider-hint">Downloading and installing. This takes about a minute.</p>}
    {mine === "signing" && <p className="provider-hint">Sign in with your {account} account in the browser. Clem connects automatically when you’re done.</p>}
  </>;
}

/** Installs Claude Code, Grok or Antigravity from inside Clem when needed, opens its sign-in, then checks every few seconds until
 *  the account is connected. Shared by Settings → Models and the last setup step. */
export function useCliConnect(onStatus:(kind:CliKind,status:any)=>void,onConnected:()=>Promise<void>|void,onError:(message:string)=>void){
  const [setup,setSetup]=useState<{kind:CliKind;step:"installing"|"signing"}|null>(null);
  const latest=useRef({onStatus,onConnected});latest.current={onStatus,onConnected};
  useEffect(()=>{
    if(setup?.step!=="signing")return;
    const started=Date.now();
    const timer=setInterval(async()=>{
      try{
        const status=await desktop!.invoke({action:CLI[setup.kind].status});
        latest.current.onStatus(setup.kind,status);
        if(status.connected){setSetup(null);onError("");await latest.current.onConnected();}
      }catch{}
      if(Date.now()-started>15*60_000)setSetup(null);
    },4000);
    return()=>clearInterval(timer);
  },[setup]);
  async function connect(kind:CliKind,installed:boolean|undefined){
    const vendor=CLI[kind];
    onError("");
    try{
      if(!installed){
        if(!await confirmDialog({title:`Install ${vendor.name}?`,confirm:"Install",message:`Clem will download ${vendor.name} from ${vendor.owner} and install it for your Windows account. It takes about a minute and doesn’t need administrator rights.\n\nBy installing, you agree to ${vendor.owner}’s terms (${vendor.terms}).`}))return;
        setSetup({kind,step:"installing"});
        const status=await desktop!.invoke({action:vendor.install});
        latest.current.onStatus(kind,status);
        if(status.connected){setSetup(null);await latest.current.onConnected();return;}
      }
      await desktop!.invoke({action:vendor.login});
      setSetup({kind,step:"signing"});
    }catch(e){setSetup(null);onError((e as Error).message);}
  }
  return {setup,connect};
}
