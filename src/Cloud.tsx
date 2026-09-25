import {signOutSupabase} from './supabase';
import {desktop} from './desktop/bridge';
import { useEffect, useState, useRef } from "react";
import { Icon, Logo } from "./Icons";
export type Session = {
  user: { id: string; name: string; email?: string } | null;
  database: boolean;
  auth: boolean;
  storage: boolean;
  drive: boolean;
  scheduler: boolean;
};
export const defaultSession: Session = {
  user: null,
  database: false,
  auth: false,
  storage: false,
  drive: false,
  scheduler: false,
};
export async function api<T = Record<string, unknown>>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if(path==="auth/logout"&&desktop){await desktop.invoke({action:'logout'});location.reload();return {} as T;}
  if(path==="auth/logout")await signOutSupabase();
  const r = await fetch("/api/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || "Request failed.");
  return json;
}
export function AuthPanel({
  session,
  onChange,
}: {
  session: Session;
  onChange: () => void;
}) {
  const [mode, setMode] = useState<"login" | "signup" | "unlock">(
    session.database ? "login" : "unlock",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth-panel">
      <h2>
        {session.user
          ? "Your account."
          : mode === "signup"
            ? "A space of your own."
            : "Welcome back."}
      </h2>
      {session.user ? (
        <>
          <p>Signed in as {session.user.email || session.user.name}.</p>
          <button
            onClick={async () => {
              await api("auth/logout", "POST", {});
              onChange();
            }}
          >
            Sign out <Icon name="arrow" size={17} />
          </button>
          {session.database && (
            <details>
              <summary>Change password</summary>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  try {
                    await api("account/password", "POST", {
                      current: f.get("current"),
                      password: f.get("password"),
                    });
                    setError("Password updated.");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <label className="field">
                  Current password
                  <input
                    type="password"
                    name="current"
                    required
                    autoComplete="current-password"
                  />
                </label>
                <label className="field">
                  New password
                  <input
                    type="password"
                    name="password"
                    required
                    minLength={10}
                    autoComplete="new-password"
                  />
                </label>
                <button className="primary">Update password</button>
              </form>
            </details>
          )}
        </>
      ) : (
        <>
          <p className="muted">
            {session.database
              ? "Sign in to sync your workspace and connect your models."
              : "Unlock your private workspace with the password configured by its owner."}
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                await api(`auth/${mode}`, "POST", {
                  ...(mode !== "unlock" ? { email: f.get("email") } : {}),
                  ...(mode === "signup" ? { name: f.get("name") } : {}),
                  password: f.get("password"),
                });
                onChange();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {mode === "signup" && (
              <label className="field">
                Your name
                <input
                  name="name"
                  required
                  maxLength={80}
                  autoComplete="name"
                />
              </label>
            )}
            {mode !== "unlock" && (
              <label className="field">
                Email
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                />
              </label>
            )}
            <label className="field">
              {mode === "unlock" ? "Workspace password" : "Password"}
              <input
                type="password"
                name="password"
                required
                minLength={8}
                maxLength={128}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account"
                  : mode === "unlock"
                    ? "Unlock workspace"
                    : "Sign in"}
              <Icon name="arrow" size={17} />
            </button>
          </form>
          {session.database && (
            <button
              onClick={() => {
                setError("");
                setMode(mode === "signup" ? "login" : "signup");
              }}
            >
              {mode === "signup"
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </button>
          )}
          {!session.auth && (
            <div className="setup-note">
              <p>
                Add SESSION_SECRET and either DATABASE_URL or
                MOWR_ACCESS_PASSWORD to .env.local to enable sign-in. Run{" "}
                <code>npm run setup</code> to generate the secret.
              </p>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="inline-error" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
export function ConnectModel({
  session,
  onDone,
}: {
  session: Session;
  onDone: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        try {
          await api("providers", "POST", {
            provider: f.get("provider"),
            key: f.get("key"),
            model: f.get("model"),
            context: Number(f.get("context")),
          });
  
          onDone();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">
        Your key is encrypted on the server. It is never stored in browser
        storage.
      </p>
      <label className="field">
        Provider
        <select name="provider">
          <option value="openai">OpenAI</option>
          <option value="anthropic" disabled>Claude — Coming soon</option>
          
          <option value="xai">xAI / Grok</option>
        </select>
      </label>
      <label className="field">
        API key
        <input
          name="key"
          type="password"
          required
          minLength={10}
          autoComplete="off"
        />
      </label>
      <label className="field">
        Model identifier
        <input
          name="model"
          required
          placeholder="The model ID from your provider"
        />
      </label>
      <label className="field">
        Context window (tokens)
        <input
          name="context"
          type="number"
          defaultValue={32000}
          min={1000}
          max={2000000}
        />
      </label>
      {(!session.user || !session.database) && (
        <p className="fine">
          Sign in to an account with database storage to save your own key. For
          a private workspace, configure provider keys and model IDs directly in
          .env.local.
        </p>
      )}
      <button
        className="primary"
        disabled={busy || !session.user || !session.database}
      >
        {busy ? "Saving…" : "Connect model"}
        <Icon name="connectors" size={18} />
      </button>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </form>
  );
}
type DriveFile = { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string };
export function DrivePicker({
  session,
  onFile,
}: {
  session: Session;
  onFile: (file: File) => void;
}) {
  const [connected,setConnected]=useState(false);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const loadVersion=useRef(0);
  const [error, setError] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<string>();
  async function load(next?: string) {
    const version=++loadVersion.current;
    setBusy(true);
    try {
      const data = await api<{ files: DriveFile[]; nextPageToken?: string }>(
        `drive/files?folder=${encodeURIComponent(folder)}${next ? "&page=" + encodeURIComponent(next) : ""}`,
      );
      if(version!==loadVersion.current)return;
      setFiles((f) => (next ? [...f, ...data.files] : data.files));
      setPage(data.nextPageToken);
      setConnected(true);
      setError("");
    } catch (e) {
      if(version===loadVersion.current)setError((e as Error).message);
    } finally {
      if(version===loadVersion.current)setBusy(false);
    }
  }
  useEffect(() => {
    if (session.user && session.drive) void load();
    const refresh = () => { if (session.user && session.drive) void load(); };
    window.addEventListener("focus", refresh);
    return () => {loadVersion.current++;window.removeEventListener("focus", refresh);};
  }, [folder, session.user?.id, session.drive]);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [started, setStarted] = useState(false);
  const connect = () => { setStarted(true); if (desktop) void desktop.invoke({ action: "driveConnect" }).catch((e) => setError(e.message)); else window.location.href = "/api/drive/connect"; };
  const open = (f: DriveFile) => { setTrail((t) => [...t, { id: f.id, name: f.name }]); setFolder(f.id); };
  const up = (index: number) => { const next = trail.slice(0, index); setTrail(next); setFolder(next.at(-1)?.id || ""); };
  async function pick(f: DriveFile) {
    setBusy(true);
    try {
      const r = await fetch(`/api/drive/file/${f.id}`);
      if (!r.ok) throw new Error((await r.json()).error);
      const blob = await r.blob();
      onFile(new File([blob], decodeURIComponent(r.headers.get("X-Mowr-File-Name") || encodeURIComponent(f.name)), { type: blob.type }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  if (!session.user || !session.drive) return <div className="drive-picker drive-intro">
    <DriveHero />
    <h3>Google Drive</h3>
    <p>Sign in to Mowr to bring files in from your Drive.</p>
  </div>;
  if (!connected) return <div className="drive-picker drive-intro">
    <DriveHero />
    <h3>Connect Google Drive</h3>
    <p>Bring documents, slides and PDFs from your Drive into a conversation.</p>
    <ul className="drive-points">
      <li><Icon name="check" size={14} />You pick each file. Nothing else is read.</li>
      <li><Icon name="check" size={14} />Picked files are copied into Mowr and stay on this PC.</li>
      <li><Icon name="check" size={14} />Disconnect anytime from this window.</li>
    </ul>
    <button className="drive-go" disabled={busy} onClick={connect}><GoogleG />{busy ? "Checking…" : started ? "Continue in your browser, then come back" : "Continue with Google"}</button>
    {error && started && <p className="inline-error">{error}</p>}
  </div>;
  return (
    <div className="drive-picker">
      <div className="drive-bar">
        <nav className="drive-trail" aria-label="Folder">
          <button className={trail.length ? "" : "here"} onClick={() => up(0)}><DriveMark />My Drive</button>
          {trail.map((t, i) => <span key={t.id}><span className="drive-sep">/</span><button className={i === trail.length - 1 ? "here" : ""} onClick={() => up(i + 1)}>{t.name}</button></span>)}
        </nav>
        <button className="drive-icon" title="Refresh" aria-label="Refresh" disabled={busy} onClick={() => void load()}><Icon name="undo" size={15} /></button>
        <button className="drive-text" title="Disconnect Drive" aria-label="Disconnect Drive" disabled={busy} onClick={() => { setBusy(true); void api("drive/connection", "DELETE").then(() => { setConnected(false); setFiles([]); setPage(undefined); setTrail([]); setFolder(""); setError(""); setStarted(false); }).catch((e) => setError(e.message)).finally(() => setBusy(false)); }}>Disconnect</button>
      </div>
      <div className={"drive-list" + (busy ? " loading" : "")}>
        {files.map((f) => {
          const folderRow = f.mimeType === "application/vnd.google-apps.folder";
          return <button key={f.id} disabled={busy} onClick={() => (folderRow ? open(f) : void pick(f))}>
            <FileKind mime={f.mimeType} name={f.name} />
            <span className="drive-name">{f.name}</span>
            <small>{f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString([], { month: "short", day: "numeric", year: new Date(f.modifiedTime).getFullYear() === new Date().getFullYear() ? undefined : "numeric" }) : ""}</small>
            <span className="drive-add">{folderRow ? <Icon name="arrow" size={14} /> : "Add"}</span>
          </button>;
        })}
        {busy && !files.length && Array.from({ length: 5 }, (_, i) => <div key={i} className="drive-skeleton" />)}
        {!busy && !error && !files.length && <p className="drive-empty">This folder is empty.</p>}
      </div>
      {page && <button className="drive-more" disabled={busy} onClick={() => void load(page)}>Show more</button>}
      {error && <p className="inline-error">{error}</p>}
    </div>
  );
}

function DriveMark() {
  return <svg width="15" height="15" viewBox="0 0 87.3 78" aria-hidden="true"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" /><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" /><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" /><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" /><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" /><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" /></svg>;
}
function DriveHero() {
  return <div className="drive-hero" aria-hidden="true"><span className="drive-tile mowr"><Logo size={26} /></span><span className="drive-wire"><i /><i /><i /></span><span className="drive-tile"><DriveMark /></span></div>;
}
function GoogleG() {
  return <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" /><path fill="#FBBC05" d="M10.6 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8-6.1z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-10l-8 6.1C6.6 42.6 14.6 48 24 48z" /></svg>;
}
function FileKind({ mime, name }: { mime: string; name: string }) {
  const kind = mime.endsWith(".folder") ? "folder" : /document|msword|wordprocessing/.test(mime) ? "doc" : /spreadsheet|excel|csv/.test(mime) ? "sheet" : /presentation|powerpoint/.test(mime) ? "slides" : /pdf/.test(mime) || /\.pdf$/i.test(name) ? "pdf" : mime.startsWith("image/") ? "image" : "file";
  const label = { folder: "", doc: "W", sheet: "X", slides: "P", pdf: "PDF", image: "", file: "" }[kind];
  return <span className={"drive-kind " + kind} aria-hidden="true">{kind === "folder" ? <Icon name="projects" size={15} /> : kind === "image" ? <Icon name="capture" size={14} /> : label || <Icon name="files" size={14} />}</span>;
}

type Scheduled = {
  id: string;
  name: string;
  prompt: string;
  model: string;
  schedule: string;
  enabled: boolean;
  next_run_at: string;
  last_result?: string;
  last_error?: string;
};
export function AutomationPanel({
  session,
  models,
}: {
  session: Session;
  models: import("../core/types").Model[];
}) {
  const [items, setItems] = useState<Scheduled[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false);
  async function refresh() {
    try {
      setItems(await api<Scheduled[]>("automations"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (session.user && session.database) void refresh();
  }, [session.user?.id]);
  return (
    <div>
      <h2>A thought for later.</h2>
      <p className="muted">
        Run a recurring prompt with your chosen model. Results stay here for you
        to review. All built-in skills remain available.
      </p>
      {session.user && session.database ? (
        <>
          <button className="primary" onClick={() => setCreating(!creating)}>
            <Icon name="plus" size={18} />
            Create automation
          </button>
          <button onClick={() => void refresh()}>Refresh results</button>
          {creating && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                try {
                  await api("automations", "POST", Object.fromEntries(f));
                  setCreating(false);
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                Name
                <input name="name" required maxLength={100} />
              </label>
              <label className="field">
                What should happen?
                <textarea name="prompt" required maxLength={20000} />
              </label>
              <label className="field">
                Model
                <select name="model" required defaultValue="">
                  <option value="" disabled>
                    Choose a connected model
                  </option>
                  {models
                    .filter((m) => m.connected)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Schedule
                <select name="schedule">
                  <option value="daily">Every day · 08:00 UTC</option>
                  <option value="weekdays">Weekdays · 08:00 UTC</option>
                  <option value="weekly">Mondays · 08:00 UTC</option>
                </select>
              </label>
              <p className="fine">
                Scheduled requests use your provider account. Execution follows
                the configured scheduler's dispatch window.
              </p>
              <button className="primary" disabled={busy}>
                {busy ? "Saving…" : "Schedule"}
              </button>
            </form>
          )}
          {items.map((a) => (
            <div key={a.id} className="automation-item">
              <div className="setting-row">
                <div>
                  <h3>{a.name}</h3>
                  <p>
                    {a.enabled
                      ? `Next: ${new Date(a.next_run_at).toLocaleString()}`
                      : "Paused"}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await api("automations/" + a.id, "PATCH", {
                        enabled: !a.enabled,
                      });
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {a.enabled ? "Pause" : "Resume"}
                </button>
                <button
                  aria-label={"Delete " + a.name}
                  onClick={async () => {
                    try {
                      await api("automations/" + a.id, "DELETE");
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
              {a.last_result && (
                <details>
                  <summary>Read latest result</summary>
                  <p className="preserve">{a.last_result}</p>
                </details>
              )}
              {a.last_error && <p className="inline-error">{a.last_error}</p>}
            </div>
          ))}
        </>
      ) : (
        <p className="setup-note">
          Sign in with database storage to schedule work. Configure DATABASE_URL
          and CRON_SECRET in .env.local; the deployment includes a daily
          scheduler.
        </p>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
