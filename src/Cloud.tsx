import {signOutSupabase} from './supabase';
import {desktop} from './desktop/bridge';
import { useEffect, useState } from "react";
import { Icon } from "./Icons";
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
type DriveFile = { id: string; name: string; mimeType: string; size?: string };
export function DrivePicker({
  session,
  onFile,
}: {
  session: Session;
  onFile: (file: File) => void;
}) {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [error, setError] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<string>();
  async function load(next?: string) {
    setBusy(true);
    try {
      const data = await api<{ files: DriveFile[]; nextPageToken?: string }>(
        `drive/files?folder=${encodeURIComponent(folder)}${next ? "&page=" + encodeURIComponent(next) : ""}`,
      );
      setFiles((f) => (next ? [...f, ...data.files] : data.files));
      setPage(data.nextPageToken);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (session.user && session.drive) void load();
  }, [folder]);
  return (
    <div>
      <p className="muted">
        Choose a document or open a folder. Only selected documents are added to
        this conversation.
      </p>
      {session.user && session.drive ? (
        <>
          <div className="modal-actions">
            <button
              onClick={() => {
                window.location.href = "/api/drive/connect";
              }}
            >
              Connect / reconnect Drive
            </button>
            {folder && <button onClick={() => setFolder("")}>All files</button>}
          </div>
          {busy && <p className="fine">Loading Drive…</p>}
          <div className="drive-list">
            {files.map((f) => (
              <button
                key={f.id}
                onClick={async () => {
                  if (f.mimeType === "application/vnd.google-apps.folder") {
                    setFolder(f.id);
                    return;
                  }
                  setBusy(true);
                  try {
                    const r = await fetch(`/api/drive/file/${f.id}`);
                    if (!r.ok) throw new Error((await r.json()).error);
                    const blob = await r.blob();
                    onFile(
                      new File(
                        [blob],
                        f.mimeType === "application/vnd.google-apps.document"
                          ? f.name + ".txt"
                          : f.name,
                        { type: blob.type },
                      ),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Icon
                  name={
                    f.mimeType === "application/vnd.google-apps.folder"
                      ? "projects"
                      : "files"
                  }
                  size={19}
                />
                <span>{f.name}</span>
                <Icon name="arrow" size={16} />
              </button>
            ))}
          </div>
          {page && <button onClick={() => void load(page)}>Load more</button>}
        </>
      ) : (
        <p className="setup-note">
          Sign in and configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL,
          and DATABASE_URL in .env.local. Add APP_URL/api/drive/callback as your
          Google OAuth redirect URL.
        </p>
      )}
      {error && <p className="inline-error">{error}</p>}
    </div>
  );
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
