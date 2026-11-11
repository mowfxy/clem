// Settings → Connectors → VPS (docs/GUC-VPS-ENGINE.md "VPS"): a guided setup (server, key, test), then where files
// live, moving them, the cache, and Clem's background worker. The key and passwords never come back from main.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { authorizeLine, WORKER_SECRETS, type MigrationView, type VpsStatus, type VpsTest } from "../../core/vps/types";
import type { StoredFile } from "../../core/types";
import { Icon } from "../Icons";
import { desktop } from "../desktop/bridge";
import { confirmDialog } from "../dialogs";
import { SettingRow, Switch } from "../settings/SettingsParts";
import "../drive/drive.css";
import "../guc/guc.css";
import "./vps.css";

const message = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
export const bytes = (n = 0) => n < 1024 ** 2 ? `${Math.max(0, Math.round(n / 1024))} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`;
const ago = (t?: number) => { if (!t) return "not yet"; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const CAPS = [0.5, 1, 2, 5, 10, 20].map((g) => g * 1024 ** 3);

/** The VPS status, refreshed on every change main reports (a move's progress, the worker, a test). */
export function useVps() {
  const [status, setStatus] = useState<VpsStatus | null>(null), [step, setStep] = useState("");
  const refresh = async () => { if (!desktop) return; try { setStatus(await desktop.invoke({ action: "vpsStatus" })); } catch { /* keeps the last */ } };
  useEffect(() => { void refresh(); return desktop?.onVps?.((e) => { if (e.what.startsWith("progress:")) setStep(e.what.slice(9)); else void refresh(); }); }, []);
  return { status, setStatus, refresh, step };
}
type Dot = "on" | "warn" | "off";
const dotOf = (s: VpsStatus | null): Dot => !s?.connected ? "off" : s.lastTest?.ok === false || s.online === false || s.worker.error ? "warn" : s.online || s.lastTest?.ok ? "on" : "off";
const StatusDot = ({ dot, label }: { dot: Dot; label: string }) => <span className={`vps-dot is-${dot}`} role="img" aria-label={label} />;

/** Settings → Connectors → VPS, under GUC. */
export function VpsRow({ onManage }: { onManage: () => void }) {
  const { status } = useVps();
  const d = dotOf(status);
  const description = !status ? "Your own server, always on." : !status.connected ? "Your own server, always on." : [status.storage.mode === "vps" ? "Files on your VPS" : "Files on this PC", status.worker.enabled ? (status.worker.runner === "worker" ? "jobs on your VPS" : "jobs on this PC") : ""].filter(Boolean).join(" · ");
  return <SettingRow lead={<span className="connector-tile"><Icon name="server" size={22} /></span>} title={<span className="vps-row-title">VPS{status?.connected && <StatusDot dot={d} label={d === "on" ? "Online" : d === "warn" ? "Needs attention" : "Not checked yet"} />}</span>} description={description}>
    <button className="secondary" onClick={onManage}>{status?.connected ? "Manage" : "Set up"}</button>
  </SettingRow>;
}

export function VpsManage({ files = [] }: { files?: StoredFile[] }) {
  const { status, setStatus, refresh, step } = useVps();
  if (!desktop) return <div className="gd-picker gd-connect vps-manage"><p>Your VPS works in the Clem desktop app.</p></div>;
  if (!status) return <div className="gd-picker gd-connect vps-manage" aria-busy="true"><div className="gd-skeleton" /><div className="gd-skeleton" /><div className="gd-skeleton" /></div>;
  if (!status.connected || !status.lastTest?.ok && !status.config?.fingerprint) return <VpsSetup status={status} onDone={(s) => setStatus(s)} refresh={refresh} />;
  return <VpsConnected status={status} refresh={refresh} step={step} files={files} />;
}

/** Server → key → test, in plain words. */
function VpsSetup({ status, onDone, refresh }: { status: VpsStatus; onDone: (s: VpsStatus) => void; refresh: () => Promise<void> }) {
  const c = status.config;
  const [host, setHost] = useState(c?.host || ""), [port, setPort] = useState(String(c?.port || 22)), [user, setUser] = useState(c?.user || "root");
  const [keyMode, setKeyMode] = useState<"make" | "paste">("make"), [publicKey, setPublicKey] = useState(c?.publicKey || "");
  const [pasted, setPasted] = useState(""), [passphrase, setPassphrase] = useState("");
  const [advanced, setAdvanced] = useState(status.passwordAllowed), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [test, setTest] = useState<VpsTest | undefined>(status.lastTest);
  const run = async (label: string, task: () => Promise<void>) => { setBusy(label); setError(""); try { await task(); } catch (e) { setError(message(e)); } finally { setBusy(""); } };
  const generate = () => run("Making a key…", async () => { setPublicKey((await desktop!.invoke({ action: "vpsGenerateKey" })).publicKey); });
  const usePasted = () => run("Reading the key…", async () => { setPublicKey((await desktop!.invoke({ action: "vpsPasteKey", privateKey: pasted, ...(passphrase ? { passphrase } : {}) })).publicKey); setPasted(""); setPassphrase(""); });
  const save = () => run("Connecting…", async () => {
    const p = Number(port);
    if (!host.trim()) throw Error("Enter your server's address.");
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw Error("The port is a number, usually 22.");
    if (!publicKey && !(advanced && password)) throw Error(advanced ? "Make or paste a key, or enter the password." : "Make a key or paste your own first.");
    await desktop!.invoke({ action: "vpsSetup", host: host.trim(), port: p, user: user.trim(), auth: publicKey ? "key" : "password", ...(advanced && password ? { password, allowPassword: true } : { allowPassword: advanced }) });
    const t = await desktop!.invoke({ action: "vpsTest" });
    setTest(t);
    if (t.ok) { await refresh(); onDone(await desktop!.invoke({ action: "vpsStatus" })); }
  });
  return <form className="gd-picker gd-connect vps-manage vps-setup" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <div className="gd-hero" aria-hidden="true"><span className="gd-hero-tile vps-tile"><Icon name="server" size={34} /></span></div>
    <h3>Connect your VPS</h3>
    <p>Clem keeps your files and runs its background work on your own server, so it is on even when this PC is off.</p>
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
          <button type="button" role="radio" aria-checked={keyMode === "make"} onClick={() => setKeyMode("make")}>Make one for me</button>
          <button type="button" role="radio" aria-checked={keyMode === "paste"} onClick={() => setKeyMode("paste")}>Use my own</button>
        </div>
        {keyMode === "make" ? (publicKey ? <AddKey publicKey={publicKey} /> : <button type="button" className="secondary vps-small" onClick={() => void generate()} disabled={!!busy}>Generate a key for me</button>)
          : <>
            <label className="guc-field vps-wide"><span>Private key</span><textarea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" spellCheck={false} disabled={!!busy} /></label>
            <label className="guc-field"><span>Passphrase (if it has one)</span><input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} disabled={!!busy} /></label>
            {publicKey && !pasted ? <AddKey publicKey={publicKey} /> : <button type="button" className="secondary vps-small" onClick={() => void usePasted()} disabled={!pasted || !!busy}>Use this key</button>}
          </>}
        <p className="guc-note"><Icon name="lock" size={14} />The private key stays encrypted on this PC. Clem never shows it again or sends it to the AI.</p>
      </li>
      <li><h4><span>3</span>Check it works</h4>
        {test && <TestResult test={test} />}
        {busy ? <p className="guc-progress" role="status"><span className="gd-sync is-uploading" aria-hidden="true" />{busy}</p> : <button className="gd-google" type="submit">Save and test</button>}
        {error && <p className="gd-error" role="alert">{error}</p>}
      </li>
    </ol>
    <details className="vps-advanced" open={advanced}>
      <summary>Advanced</summary>
      <SettingRow title="Allow password sign-in" description="Less safe than a key. Off unless you need it."><Switch checked={advanced} onChange={setAdvanced} label="Allow password sign-in" /></SettingRow>
      {advanced && <label className="guc-field"><span>Server password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
    </details>
  </form>;
}

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="vps-copy" onClick={() => void navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); })} aria-label={label}><Icon name={done ? "check" : "copy"} size={14} />{done ? "Copied" : "Copy"}</button>;
}
/** The public key, and the one line that adds it on the server. */
function AddKey({ publicKey }: { publicKey: string }) {
  return <div className="vps-key">
    <p>Run this once on your server (in its terminal, signed in as that user):</p>
    <pre className="vps-code"><code>{authorizeLine(publicKey)}</code><Copy text={authorizeLine(publicKey)} label="Copy the command" /></pre>
    <p>Or add this public key to <code>~/.ssh/authorized_keys</code> yourself:</p>
    <pre className="vps-code"><code>{publicKey}</code><Copy text={publicKey} label="Copy the public key" /></pre>
  </div>;
}

function TestResult({ test }: { test: VpsTest }) {
  if (!test.ok) return <div className="vps-test is-bad" role="alert"><Icon name="alert" size={15} /><div><b>Couldn't connect</b><p>{test.error}</p>{test.fingerprint && <small>Server fingerprint: <code>{test.fingerprint}</code></small>}</div></div>;
  return <div className="vps-test" role="status">
    <Icon name="check" size={15} />
    <div>
      <b>Connected in {test.ms} ms</b>
      <ul>
        <li>{test.os}</li>
        {test.diskFree !== undefined && <li>{bytes(test.diskFree)} free of {bytes(test.diskTotal)}</li>}
        <li>{test.docker ? "Docker is ready" : "No Docker"} · {test.systemd ? "systemd is ready" : "no systemd"}{test.node ? ` · Node ${test.node}` : ""}</li>
      </ul>
      {test.firstTime && <small>First time here. Clem now trusts this server's fingerprint <code>{test.fingerprint}</code> and will refuse to connect if it changes.</small>}
    </div>
  </div>;
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return <section className="vps-section"><header><h4>{title}</h4>{aside}</header>{children}</section>;
}

function VpsConnected({ status, refresh, step, files }: { status: VpsStatus; refresh: () => Promise<void>; step: string; files: StoredFile[] }) {
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  const run = async (label: string, task: () => Promise<unknown>) => { setBusy(label); setError(""); try { await task(); } catch (e) { setError(message(e)); } finally { setBusy(""); await refresh(); } };
  const c = status.config!, s = status.storage, m = status.migration, w = status.worker, d = dotOf(status);
  const moving = m && ["running", "paused"].includes(m.status);
  const toVps = s.mode === "vps";
  return <div className="gd-picker gd-connect vps-manage">
    <div className="gd-hero" aria-hidden="true"><span className="gd-hero-tile vps-tile"><Icon name="server" size={34} /></span></div>
    <h3>Your VPS</h3>
    <p className="vps-where"><StatusDot dot={d} label={d === "on" ? "Online" : d === "warn" ? "Needs attention" : "Not checked yet"} /><b>{c.user}@{c.host}{c.port !== 22 ? ":" + c.port : ""}</b><span>{d === "on" ? "Online" : d === "warn" ? "Can't reach it" : "Not checked yet"}</span></p>
    {status.lastTest && <TestResult test={status.lastTest} />}
    <button className="secondary vps-small" disabled={!!busy} onClick={() => void run("Testing…", () => desktop!.invoke({ action: "vpsTest" }))}>{busy === "Testing…" ? "Testing…" : "Test connection"}</button>

    <Section title="Where your files live" aside={<span className="vps-pill">{toVps ? "On your VPS" : "On this PC"}</span>}>
      <Usage status={status} />
      {moving ? <Moving m={m!} onStop={() => void run("Stopping…", () => desktop!.invoke({ action: "vpsAbortMove" }))} />
        : <>
          {m && (m.status === "done" || m.status === "failed") && <p className={`vps-line${m.failed ? " is-warn" : ""}`}><Icon name={m.failed ? "alert" : "check"} size={14} />{m.error || `${m.done} file${m.done === 1 ? "" : "s"} moved ${m.direction === "up" ? "to your VPS" : "back to this PC"}.`}</p>}
          <button className="gd-google" disabled={!!busy} onClick={() => void (toVps
            ? confirmDialog({ title: "Move your files back to this PC?", message: `Clem copies ${s.files.vps} file${s.files.vps === 1 ? "" : "s"} (${bytes(s.vps)}) here, checks each one, then removes it from your VPS.`, confirm: "Move back" }).then((yes) => { if (yes) void run("Starting…", () => desktop!.invoke({ action: "vpsMove", direction: "down" })); })
            : run("Starting…", () => desktop!.invoke({ action: "vpsMove", direction: "up" })))}>{toVps ? "Move back to this PC" : "Move everything to my VPS"}</button>
          <p className="vps-fine">{toVps ? "New files go to your VPS. This PC keeps recent and pinned files so they open instantly." : "Each file is checked on your VPS before this PC lets go of it. You can keep using Clem while it moves."}</p>
        </>}
      {toVps && <Cache status={status} onCap={(n) => void run("Saving…", () => desktop!.invoke({ action: "vpsCap", bytes: n }))} />}
      {toVps && <Pinned files={files} />}
    </Section>

    <Section title="Background jobs" aside={<Switch checked={w.enabled} label="Run Clem's background jobs on my VPS" onChange={(on) => void run(on ? "Installing…" : "Stopping…", () => desktop!.invoke({ action: "vpsWorker", on }))} />}>
      <p className="vps-fine">Run Clem's background jobs on my VPS: GUC checks, reminders, the organizer and Telegram keep going while this PC is off.</p>
      {busy === "Installing…" && <p className="guc-progress" role="status"><span className="gd-sync is-uploading" aria-hidden="true" />{step || "Installing…"}</p>}
      {w.enabled && <ul className="vps-facts">
        <li><span>Running on</span><b>{w.runner === "worker" ? "Your VPS" : w.runner === "desktop" ? "This PC (until your VPS answers)" : "Checking…"}</b></li>
        <li><span>How</span><b>{w.kind === "docker" ? "Docker, with Postgres" : w.kind === "systemd" ? "systemd and Node" : "—"}</b></li>
        <li><span>Last heartbeat</span><b>{ago(w.heartbeat)}</b></li>
        <li><span>AI on the VPS</span><b>{w.model === "api" ? "Your API key" : w.model === "cli" ? "The CLI signed in on the server" : "None: rules only, Telegram replies wait for this PC"}</b></li>
      </ul>}
      {w.error && <p className="vps-line is-warn"><Icon name="alert" size={14} />{w.error}</p>}
      <ModelKey has={w.model === "api"} onSave={(key, model) => run("Saving…", () => desktop!.invoke({ action: "vpsModelKey", ...(key ? { key } : {}), ...(model ? { model } : {}) }))} />
      <details className="vps-advanced"><summary>What Clem sends to your VPS</summary>
        <ul className="vps-sent">{WORKER_SECRETS.map((x) => <li key={x.name}><b>{x.what}</b><small>{x.when}</small></li>)}</ul>
        <p className="vps-fine">Each is encrypted (AES-256-GCM) before it leaves this PC and travels over SSH. The worker listens only on the server itself; Clem reaches it through the SSH connection.</p>
      </details>
    </Section>
    {error && <p className="gd-error" role="alert">{error}</p>}
    <footer className="gd-foot guc-foot">
      <button className="gd-disconnect" disabled={!!busy} onClick={() => void confirmDialog({ title: "Forget this server?", message: toVps ? "Move your files back to this PC first." : "Clem forgets the address, key and fingerprint. Nothing on the server is deleted.", confirm: "Forget", danger: true }).then((yes) => { if (yes) void run("Forgetting…", () => desktop!.invoke({ action: "vpsForget" })); })}>Forget this server</button>
    </footer>
  </div>;
}

/** Device vs VPS bars. */
function Usage({ status }: { status: VpsStatus }) {
  const s = status.storage, total = Math.max(1, s.device + s.vps);
  return <div className="vps-usage" aria-label="Storage used">
    <div className="vps-bar" aria-hidden="true"><span className="is-device" style={{ width: `${(s.device / total) * 100}%` }} /><span className="is-vps" style={{ width: `${(s.vps / total) * 100}%` }} /></div>
    <dl><div><dt><i className="is-device" />This PC</dt><dd>{bytes(s.device)}{s.cache ? ` (${bytes(s.cache)} cached)` : ""}</dd></div><div><dt><i className="is-vps" />Your VPS</dt><dd>{bytes(s.vps)}</dd></div></dl>
  </div>;
}
function Cache({ status, onCap }: { status: VpsStatus; onCap: (n: number) => void }) {
  const s = status.storage;
  return <SettingRow title="Keep on this PC" description={`Recent files, up to the limit (${bytes(s.cache)} used). Pinned files always stay.`}>
    <select className="vps-select" value={CAPS.reduce((a, b) => (Math.abs(b - s.cap) < Math.abs(a - s.cap) ? b : a))} onChange={(e) => onCap(Number(e.target.value))} aria-label="Cache limit">{CAPS.map((n) => <option key={n} value={n}>{bytes(n)}</option>)}</select>
  </SettingRow>;
}
function Moving({ m, onStop }: { m: MigrationView; onStop: () => void }) {
  const pct = m.bytesTotal ? Math.round((m.bytesDone / m.bytesTotal) * 100) : m.total ? Math.round((m.done / m.total) * 100) : 0;
  return <div className="vps-moving" role="status">
    <div className="vps-progress" aria-hidden="true"><span style={{ width: pct + "%" }} /></div>
    <p><b>{m.status === "paused" ? "Paused" : m.direction === "up" ? "Moving to your VPS" : "Moving back to this PC"}</b> · {m.done} of {m.total} files · {bytes(m.bytesDone)} of {bytes(m.bytesTotal)}</p>
    {m.error && <p className="vps-fine">{m.error.replace(/^Paused: /, "")} It carries on by itself once the server answers.</p>}
    <button className="secondary vps-small" onClick={onStop}>Stop</button>
  </div>;
}
/** Files that always stay on this PC. */
function Pinned({ files }: { files: StoredFile[] }) {
  const [pinned, setPinned] = useState<string[] | null>(null), [q, setQ] = useState("");
  useEffect(() => { void desktop!.invoke({ action: "vpsPinned" }).then(setPinned, () => setPinned([])); }, []);
  const toggle = async (id: string, on: boolean) => { setPinned((p) => (on ? [...(p || []), id] : (p || []).filter((x) => x !== id))); await desktop!.invoke({ action: "vpsPin", id, on }).catch(() => {}); };
  const hits = useMemo(() => (q.trim() ? files.filter((f) => f.name.toLowerCase().includes(q.trim().toLowerCase()) && !pinned?.includes(f.id)).slice(0, 5) : []), [q, files, pinned]);
  if (!pinned) return <div className="gd-skeleton" />;
  return <div className="vps-pins">
    <h5>Pinned to this PC</h5>
    {pinned.length ? <ul>{pinned.map((id) => <li key={id}><Icon name="pin" size={13} /><span>{files.find((f) => f.id === id)?.name || id}</span><button type="button" className="vps-link" onClick={() => void toggle(id, false)}>Unpin</button></li>)}</ul> : <p className="vps-fine">Nothing pinned. Pin a file to keep it here for offline use.</p>}
    <input className="vps-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a file to pin" aria-label="Find a file to pin" />
    {hits.length > 0 && <ul>{hits.map((f) => <li key={f.id}><span>{f.name}</span><button type="button" className="vps-link" onClick={() => { void toggle(f.id, true); setQ(""); }}>Pin</button></li>)}</ul>}
  </div>;
}
function ModelKey({ has, onSave }: { has: boolean; onSave: (key?: string, model?: string) => Promise<void> }) {
  const [key, setKey] = useState("");
  return <details className="vps-advanced"><summary>{has ? "Model key for the VPS (saved)" : "Add a model key for the VPS (optional)"}</summary>
    <p className="vps-fine">Without one, the VPS uses a <code>claude</code> or <code>codex</code> CLI you signed in to on the server, or runs on rules alone. Clem never copies keys from your PC's apps.</p>
    <label className="guc-field"><span>Anthropic API key</span><input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" /></label>
    <div className="vps-row-buttons"><button type="button" className="secondary vps-small" disabled={!key} onClick={() => void onSave(key).then(() => setKey(""))}>Save key</button>{has && <button type="button" className="vps-link" onClick={() => void onSave()}>Remove key</button>}</div>
  </details>;
}
