// Settings → Connectors → VPS (docs/GUC-VPS-ENGINE.md "VPS"): a guided setup (server, key, test), then one switch,
// "Run Clem on my VPS", and one small option under it, "Keep a copy of my files on the VPS" (this PC keeps every file). The key and passwords never come back from main.
// Copy is one short line per state. A pressed button keeps its width (its busy label sits in the same cell) and the
// others stay as they are, only inert, while it runs.
import { useState, type ReactNode } from "react";
import { authorizeLine, WORKER_SECRETS, type VpsStatus, type VpsTest } from "../../core/vps/types";
import type { StoredFile } from "../../core/types";
import { Icon } from "../Icons";
import { desktop } from "../desktop/bridge";
import { confirmDialog } from "../dialogs";
import { SettingRow, Switch } from "../settings/SettingsParts";
import "../drive/drive.css";
import "../guc/guc.css";
import "./vps.css";
import { StatusDot, bytes, dotOf, useVps } from "./VpsRow";

const message = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
const ago = (t?: number) => { if (!t) return "not yet"; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

/** A button whose busy label shares its grid cell with the label, so pressing it never changes its width. */
function Act({ label, busyLabel, busy, disabled, className = "", onClick, type = "button" }: { label: ReactNode; busyLabel: string; busy: boolean; disabled?: boolean; className?: string; onClick?: () => void; type?: "button" | "submit" }) {
  return <button type={type} className={`vps-act ${className}`} onClick={onClick} disabled={busy || disabled} aria-busy={busy || undefined} data-busy={busy || undefined}>
    <span className="vps-act-label" aria-hidden={busy || undefined}>{label}</span>
    <span className="vps-act-busy" aria-hidden={!busy || undefined}>{busyLabel}</span>
  </button>;
}
/** The one line that says what is happening; it keeps its height whatever it says. */
function Status({ spin, warn, children }: { spin?: boolean; warn?: boolean; children: ReactNode }) {
  return <p className={`vps-status${warn ? " is-warn" : ""}`} role="status">{spin ? <span className="gd-sync is-uploading" aria-hidden="true" /> : warn ? <Icon name="alert" size={14} /> : null}<span>{children}</span></p>;
}

/** The dialog behind Settings → Connectors → VPS → Manage (loaded when it opens; the row is VpsRow.tsx). */
export function VpsManage(_: { files?: StoredFile[] } = {}) {
  const { status, setStatus, refresh, step } = useVps();
  if (!desktop) return <div className="gd-picker gd-connect vps-manage"><p>Your VPS works in the Clem desktop app.</p></div>;
  if (!status) return <div className="gd-picker gd-connect vps-manage" aria-busy="true"><div className="gd-skeleton" /><div className="gd-skeleton" /><div className="gd-skeleton" /></div>;
  if (!status.connected || !status.lastTest?.ok && !status.config?.fingerprint) return <VpsSetup status={status} onDone={(s) => setStatus(s)} refresh={refresh} />;
  return <VpsConnected status={status} refresh={refresh} step={step} />;
}

/** Server → key → test, in plain words. */
function VpsSetup({ status, onDone, refresh }: { status: VpsStatus; onDone: (s: VpsStatus) => void; refresh: () => Promise<void> }) {
  const c = status.config;
  const [host, setHost] = useState(c?.host || ""), [port, setPort] = useState(String(c?.port || 22)), [user, setUser] = useState(c?.user || "root");
  const [keyMode, setKeyMode] = useState<"make" | "paste">("make"), [publicKey, setPublicKey] = useState(c?.publicKey || "");
  // Which tab the key came from, so a key made here never shows (or saves) under "Use my own", nor the other way round.
  const [keyFrom, setKeyFrom] = useState<"make" | "paste" | "">(c?.publicKey ? "make" : "");
  const key = keyFrom === keyMode ? publicKey : "";
  const [pasted, setPasted] = useState(""), [passphrase, setPassphrase] = useState("");
  const [advanced, setAdvanced] = useState(status.passwordAllowed), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [test, setTest] = useState<VpsTest | undefined>(status.lastTest);
  const run = async (what: string, task: () => Promise<void>) => { if (busy) return; setBusy(what); setError(""); try { await task(); } catch (e) { setError(message(e)); } finally { setBusy(""); } };
  const generate = () => run("key", async () => { setPublicKey((await desktop!.invoke({ action: "vpsGenerateKey" })).publicKey); setKeyFrom("make"); });
  const usePasted = () => run("paste", async () => { setPublicKey((await desktop!.invoke({ action: "vpsPasteKey", privateKey: pasted, ...(passphrase ? { passphrase } : {}) })).publicKey); setKeyFrom("paste"); setPasted(""); setPassphrase(""); });
  const save = () => run("save", async () => {
    const p = Number(port);
    if (!host.trim()) throw Error("Enter your server's address.");
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw Error("The port is a number, usually 22.");
    if (!key && !(advanced && password)) throw Error(advanced ? "Make or paste a key, or enter the password." : keyMode === "make" ? "Generate a key first." : "Paste your key and tap Use this key first.");
    await desktop!.invoke({ action: "vpsSetup", host: host.trim(), port: p, user: user.trim(), auth: key ? "key" : "password", ...(advanced && password ? { password, allowPassword: true } : { allowPassword: advanced }) });
    const t = await desktop!.invoke({ action: "vpsTest" });
    setTest(t);
    if (t.ok) { await refresh(); onDone(await desktop!.invoke({ action: "vpsStatus" })); }
  });
  return <form className="gd-picker gd-connect vps-manage vps-setup" data-busy={busy || undefined} onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <div className="gd-hero" aria-hidden="true"><span className="gd-hero-tile vps-tile"><Icon name="server" size={34} /></span></div>
    <h3>Connect your VPS</h3>
    <p>Clem stays on when this PC is off.</p>
    <ol className="vps-steps">
      <li><h4><span>1</span>Your server</h4>
        <div className="vps-fields">
          <label className="guc-field vps-host"><span>Address</span><input value={host} onChange={(e) => setHost(e.target.value)} placeholder="203.0.113.5 or vps.example.com" spellCheck={false} autoFocus disabled={!!busy} /></label>
          <label className="guc-field vps-port"><span>Port</span><input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" disabled={!!busy} /></label>
        </div>
        <label className="guc-field"><span>User</span><input value={user} onChange={(e) => setUser(e.target.value)} spellCheck={false} autoComplete="username" disabled={!!busy} /></label>
      </li>
      <li><h4><span>2</span>A key to sign in</h4>
        <div className="vps-choice" role="radiogroup" aria-label="Key">
          <button type="button" role="radio" aria-checked={keyMode === "make"} onClick={() => setKeyMode("make")} disabled={!!busy}>Make one for me</button>
          <button type="button" role="radio" aria-checked={keyMode === "paste"} onClick={() => setKeyMode("paste")} disabled={!!busy}>Use my own</button>
        </div>
        {key ? <AddKey publicKey={key} />
          : keyMode === "make" ? <Act className="secondary vps-small" label="Generate a key for me" busyLabel="Making a key…" busy={busy === "key"} disabled={!!busy} onClick={() => void generate()} />
          : <>
            <label className="guc-field vps-wide"><span>Private key</span><textarea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" spellCheck={false} disabled={!!busy} /></label>
            <label className="guc-field"><span>Passphrase (if it has one)</span><input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} disabled={!!busy} /></label>
            <Act className="secondary vps-small" label="Use this key" busyLabel="Reading…" busy={busy === "paste"} disabled={!pasted || !!busy} onClick={() => void usePasted()} />
          </>}
        {key && keyMode === "paste" && <button type="button" className="vps-link vps-again" onClick={() => setKeyFrom("")} disabled={!!busy}>Use a different key</button>}
        <p className="guc-note"><Icon name="lock" size={14} />The private key stays on this PC, encrypted.</p>
        <details className="vps-advanced" open={advanced}>
          <summary>Use a password instead</summary>
          <SettingRow title="Allow password sign-in" description="Less safe than a key."><Switch checked={advanced} onChange={setAdvanced} label="Allow password sign-in" disabled={!!busy} /></SettingRow>
          {advanced && <label className="guc-field"><span>Server password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!!busy} /></label>}
        </details>
      </li>
      <li><h4><span>3</span>Check it works</h4>
        {test && <TestResult test={test} />}
        <Act type="submit" className="gd-google" label="Save and test" busyLabel="Connecting…" busy={busy === "save"} disabled={!!busy} />
        {error && <p className="gd-error" role="alert">{error}</p>}
      </li>
    </ol>
  </form>;
}

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="vps-copy" onClick={() => void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); })} aria-label={label}><Icon name={done ? "check" : "copy"} size={14} />{done ? "Copied" : "Copy"}</button>;
}
/** The public key, and the one line that adds it on the server. */
function AddKey({ publicKey }: { publicKey: string }) {
  return <div className="vps-key">
    <p>Run this once on your server:</p>
    <pre className="vps-code"><code>{authorizeLine(publicKey)}</code><Copy text={authorizeLine(publicKey)} label="Copy the command" /></pre>
    <p>Or add this key to <code>~/.ssh/authorized_keys</code>:</p>
    <pre className="vps-code"><code>{publicKey}</code><Copy text={publicKey} label="Copy the public key" /></pre>
  </div>;
}

function TestResult({ test }: { test: VpsTest }) {
  if (!test.ok) return <div className="vps-test is-bad" role="alert"><Icon name="alert" size={15} /><div><b>Couldn't connect</b><p>{test.error}</p>{test.fingerprint && <small>Fingerprint: <code>{test.fingerprint}</code></small>}</div></div>;
  const facts = [test.os, test.diskFree !== undefined ? `${bytes(test.diskFree)} free of ${bytes(test.diskTotal)}` : "", test.docker ? "Docker ready" : ""].filter(Boolean).join(" · ");
  return <div className="vps-test" role="status">
    <Icon name="check" size={15} />
    <div>
      <b>Connected in {test.ms} ms</b>
      <p>{facts}</p>
      {test.firstTime && <small>Fingerprint saved: <code>{test.fingerprint}</code></small>}
    </div>
  </div>;
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return <section className="vps-section"><header><h4>{title}</h4>{aside}</header>{children}</section>;
}

function VpsConnected({ status, refresh, step }: { status: VpsStatus; refresh: () => Promise<void>; step: string }) {
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  // One task at a time: a second press while one runs does nothing.
  const run = async (what: string, task: () => Promise<unknown>) => { if (busy) return; setBusy(what); setError(""); try { await task(); } catch (e) { setError(message(e)); } finally { await refresh(); setBusy(""); } };
  const c = status.config!, s = status.storage, w = status.worker, d = dotOf(status);
  // The option moves the moment it is pressed, like the switch.
  const copies = busy === "copies-on" ? true : busy === "copies-off" ? false : s.mode === "vps";
  // The switch moves the moment it is pressed and stays there while Clem works on it.
  const on = busy === "worker-on" ? true : busy === "worker-off" ? false : w.enabled;
  const ai = w.model === "api" ? "AI on your key" : w.model === "cli" ? "AI signed in" : "no AI yet";
  return <div className="gd-picker gd-connect vps-manage" data-busy={busy || undefined}>
    <div className="gd-hero" aria-hidden="true"><span className="gd-hero-tile vps-tile"><Icon name="server" size={34} /></span></div>
    <h3>Your VPS</h3>
    <p className="vps-where"><StatusDot dot={d} label={d === "on" ? "Online" : d === "warn" ? "Needs attention" : "Not checked yet"} /><b>{c.user}@{c.host}{c.port !== 22 ? ":" + c.port : ""}</b><span>{d === "on" ? "Online" : d === "warn" ? (status.online === false || status.lastTest?.ok === false ? "Can't reach it" : "Online · the worker needs attention") : "Not checked yet"}</span></p>
    {status.lastTest && <TestResult test={status.lastTest} />}
    <Act className="secondary vps-small" label="Test connection" busyLabel="Testing…" busy={busy === "test"} disabled={!!busy} onClick={() => void run("test", () => desktop!.invoke({ action: "vpsTest" }))} />

    <Section title="Run Clem on my VPS" aside={<Switch checked={on} label="Run Clem on my VPS" disabled={!!busy} onChange={(v) => void run(v ? "worker-on" : "worker-off", () => desktop!.invoke({ action: "vpsWorker", on: v }))} />}>
      {busy === "worker-on" ? <Status spin>{step || "Setting up your VPS…"}</Status>
        : busy === "worker-off" ? <Status spin>Turning off…</Status>
        : w.updating ? <Status spin>Updating Clem on your VPS… this takes a few minutes</Status>
        : w.error ? <Status warn>{w.error}</Status>
        : w.enabled && w.runner === "worker" && w.aiError ? <Status warn>{/^Google no longer|signed out/.test(w.aiError) ? w.aiError : `The AI on your VPS can't answer: ${w.aiError}`}</Status>
        : w.enabled ?<Status>{w.runner === "worker" ? `Running on your VPS · ${ai} · ${ago(w.heartbeat)}` : w.runner === "desktop" ? "Running on this PC until your VPS answers" : "Checking…"}</Status>
        : <Status>GUC checks, reminders and your main thread on Telegram keep going while this PC is off.</Status>}
      <SettingRow title="Keep a copy of my files on the VPS" description={copies && s.vpsLimit ? `${bytes(s.vpsLimit.used)} of ${bytes(s.vpsLimit.max)} used on your VPS` : "This PC keeps them either way."}>
        <Switch checked={copies} label="Keep a copy of my files on the VPS" disabled={!!busy} onChange={(v) => void run(v ? "copies-on" : "copies-off", () => desktop!.invoke({ action: "vpsCopies", on: v }))} />
      </SettingRow>
      {w.enabled && w.model !== "api" && <ServerAi w={w} />}
      <ModelKey has={w.model === "api"} busy={busy === "model"} disabled={!!busy} onSave={(key, model) => run("model", () => desktop!.invoke({ action: "vpsModelKey", ...(key ? { key } : {}), ...(model ? { model } : {}) }))} />
      <details className="vps-advanced"><summary>What Clem sends to your VPS</summary>
        <ul className="vps-sent">{WORKER_SECRETS.map((x) => <li key={x.name}><b>{x.what}</b><small>{x.when}</small></li>)}</ul>
        <p className="vps-fine">Encrypted before it leaves this PC, sent over SSH.</p>
      </details>
    </Section>
    {error && <p className="gd-error" role="alert">{error}</p>}
    <footer className="gd-foot guc-foot">
      <button className="gd-disconnect" disabled={!!busy} onClick={() => void confirmDialog({ title: "Forget this server?", message: "Clem forgets the address, key and fingerprint. Your files stay on this PC; nothing on the server is deleted.", confirm: "Forget", danger: true }).then((yes) => { if (yes) void run("forget", () => desktop!.invoke({ action: "vpsForget" })); })}>Forget this server</button>
    </footer>
  </div>;
}

/** The AI on the server (Gemini, Claude Code or Codex: the one this PC uses), set up by the switch; here only its progress,
 *  the one sign-in, and a retry. */
function ServerAi({ w }: { w: VpsStatus["worker"] }) {
  const [error, setError] = useState(""), [code, setCode] = useState(""), [copied, setCopied] = useState(false), [sent, setSent] = useState(false);
  const s = w.signIn, name = s?.cli === "codex" ? "ChatGPT" : s?.cli === "antigravity" ? "Gemini" : "Claude";
  // Clem picks the AI this PC uses (Gemini, Claude or ChatGPT): a retry never repeats one the person doesn't use.
  // Gemini refused by Google, or Claude signed out on the server: Claude is what gets signed in there.
  const claude = !!w.aiError && /^Google no longer|signed out/.test(w.aiError);
  const start = () => { setError(""); setSent(true); void desktop!.invoke({ action: "vpsCli", ...(claude ? { cli: "claude" as const } : {}) }).catch((e) => setError(message(e))).finally(() => setSent(false)); };
  const paste = () => { setError(""); void desktop!.invoke({ action: "vpsCliCode", code }).then(() => setCode(""), (e) => setError(message(e))); };
  // Signed in and answering: nothing to show. Signed in but failing (w.aiError): "Try again" signs it in once more.
  if (w.model === "cli" && !s && !w.aiError) return null;
  return <div className="vps-ai">
    {!s || s.step === "failed" ? <>
      {s?.error && <Status warn>{s.error}</Status>}
      <Act className="secondary vps-small" label={claude ? "Sign in to Claude on my VPS" : s || w.aiError ? "Try again" : "Set up the AI"} busyLabel="Starting…" busy={sent} onClick={start} />
    </> : s.step === "installing" ? <Status spin>Installing {name} on your VPS…</Status>
      : s.step === "finishing" ? <Status spin>Signed in. Restarting…</Status>
      : s.cli === "codex" ? <div className="provider-challenge cx-challenge">
        <p>Enter this code on the OpenAI page</p>
        <button type="button" className="cx-code" onClick={() => void navigator.clipboard.writeText(s.code || "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })}><code>{s.code}</code><span>{copied ? "Copied" : "Copy"}</span></button>
        <a className="primary cx-go" href={s.url} target="_blank" rel="noreferrer">Open sign-in page<Icon name="arrow" size={15} /></a>
        <p className="provider-wait"><Icon name="hourglass" size={14} />Waiting for your account…</p>
      </div>
      : <div>
        <Status spin>Sign in to {name} in the window that opened.</Status>
        <details className="vps-advanced"><summary>Got a code instead?</summary>
          {s.url && <p className="vps-fine">If the window won't sign you in, <a href={s.url} target="_blank" rel="noreferrer">open the page in your browser</a> and paste the code it shows here.</p>}
          <label className="guc-field"><span>Code</span><input value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} autoComplete="off" /></label>
          <button type="button" className="secondary vps-small" disabled={code.trim().length < 4} onClick={paste}>Send</button>
        </details>
      </div>}
    {error && <p className="gd-error" role="alert">{error}</p>}
  </div>;
}
function ModelKey({ has, onSave, busy, disabled }: { has: boolean; onSave: (key?: string, model?: string) => Promise<void>; busy: boolean; disabled?: boolean }) {
  const [key, setKey] = useState("");
  return <details className="vps-advanced"><summary>{has ? "API key for the VPS (saved)" : "Use an API key instead"}</summary>
    <label className="guc-field"><span>Anthropic API key</span><input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" disabled={disabled} /></label>
    <div className="vps-row-buttons"><Act className="secondary vps-small" label="Save key" busyLabel="Saving…" busy={busy} disabled={!key || disabled} onClick={() => void onSave(key).then(() => setKey(""))} />{has && <button type="button" className="vps-link" disabled={disabled} onClick={() => void onSave()}>Remove key</button>}</div>
  </details>;
}
