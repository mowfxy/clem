import {Illustration} from "../Illustrations";
import type { Scene } from "../vectorFilm";
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, Logo } from "../Icons";
import { desktop } from "./bridge";
import { FirstProvider } from "./FirstProvider";
import { bootDone } from "../boot";
import type { DesktopStatus } from "../../desktop/contracts";
import "./desktop.css";

const App = lazy(() => import("../App"));
export default function DesktopRoot() {
  return (
    <>
      <div className="desktop-titlebar" aria-hidden="true" />
      <div className="desktop-content">
        <SetupContent />
      </div>
    </>
  );
}
function SetupContent() {
  const [state, setState] = useState<DesktopStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [browserPending, setBrowserPending] = useState(false),
    [readOnly, setReadOnly] = useState(false);
  const [username, setUsername] = useState(""),
    [name, setName] = useState(""),
    [memory, setMemory] = useState(true),
    [availability, setAvailability] = useState(""),
    [aiConnected, setAiConnected] = useState(false);
  // Which way the steps are moving, and whether the current one is on its way out.
  const [direction, setDirection] = useState<"next" | "back">("next"),
    [leaving, setLeaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const loaded = useRef<DesktopStatus["setup"] | null>(null);
  // While reading offline, check quietly for the connection so sending comes back on its own.
  useEffect(() => {
    if (!readOnly) return;
    const timer = setInterval(() => void refresh().catch(() => {}), 30000);
    return () => clearInterval(timer);
  }, [readOnly]);
  async function refresh() {
    const next = (await desktop!.invoke({ action: "status" })) as DesktopStatus;
    setState(next);
    if (next.user) setBrowserPending(false);
    // A field still showing what was saved follows the saved value; one the person has changed keeps their typing.
    const was = loaded.current, now = next.setup;
    loaded.current = now;
    setUsername((v) => (!was || v === was.username ? now.username : v));
    setName((v) => (!was || v === was.displayName ? now.displayName : v));
    setMemory((v) => (!was || v === was.memory ? now.memory : v));
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const focus = () => void refresh().catch((e) => setError(e.message));
    window.addEventListener("focus", focus);
    const unsubscribe = desktop!.onAuth(focus);
    return () => {
      window.removeEventListener("focus", focus);
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [state?.setup.step, state?.user?.id]);
  useEffect(() => {
    if (!state?.user || state.setup.step !== 0) return;
    let stale = false;
    setAvailability(username ? "Checking…" : "");
    const timer = setTimeout(() => {
      if (!username) return;
      void desktop!
        .invoke({ action: "username", username })
        .then((result) => {
          if (!stale)
            setAvailability(
              !result.valid
                ? "Use 3–24 letters, numbers or underscores; start with a letter."
                : result.available
                  ? "Available"
                  : "Already taken",
            );
        })
        .catch(() => {
          if (!stale) setAvailability("Could not check. Try again.");
        });
    }, 180);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [username, state?.user?.id, state?.setup.step]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** Lets the current step slide away before the next one arrives. */
  async function move(to: number, work: () => Promise<void>) {
    setDirection(to < (state?.setup.step || 0) ? "back" : "next");
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setLeaving(true);
      await new Promise((r) => setTimeout(r, 230));
    }
    try {
      await work();
    } finally {
      setLeaving(false);
    }
  }
  async function save(step: number) {
    await desktop!.invoke({
      action: "setup",
      step,
      username,
      displayName: name,
      memory,
    });
    await refresh();
  }
  const toWorkspace = !!state?.user && ((state.setup.step >= 4 && state.entitlement.active) || (state.setup.step >= 3 && state.entitlement.reason === "offline" && readOnly));
  // The opening screen stays until there's something to show: a setup or sign-in screen here, or the loaded workspace.
  useEffect(() => { if ((state && !toWorkspace) || error) bootDone(); }, [state, toWorkspace, error]);
  // Offline, the local workspace still opens to read; sending waits for a connection.
  if (state?.user && state.setup.step >= 3 && state.entitlement.reason === "offline" && readOnly)
    return (
      <Suspense fallback={<main className="workspace-loading">Opening your workspace…</main>}>
        <App offline />
      </Suspense>
    );
  if (state?.user && state.setup.step >= 4 && state.entitlement.active)
    return (
      <Suspense
        fallback={
          <main className="workspace-loading">Opening your workspace…</main>
        }
      >
        <App />
      </Suspense>
    );
  const step = state?.setup.step || 0;
  const titles = [
    "Pick a username.",
    "What should we call you?",
    "Remember what matters?",
    "Connect your AI.",
  ];
  const lines = [
    "It’s yours alone, and how people find you.",
    "Your name, the way you like to hear it.",
    "Mowr can keep useful context between chats. It syncs to your account; files stay on this PC.",
    "Use the subscription you already have. You can add more in Settings → Models.",
  ];
  // Every screen gets its own drawing, so the setup reads as a short walk rather than one form.
  const scene: Scene = !state?.user
    ? browserPending ? "plane" : "house"
    : state.entitlement.reason === "suspended" ? "lock"
    : state.entitlement.reason === "offline" && step >= 3 ? "unlink"
    : (["key", "wave", "jar", aiConnected ? "link" : "plug"] as const)[Math.min(step, 3)];
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <main className="desktop-setup" data-step={state?.user ? Math.min(step, 3) : "welcome"}>
      <SetupBackdrop />
      <div className="setup-layout">
        {state?.user && state.entitlement.reason !== "suspended" && !(state.entitlement.reason === "offline" && step >= 3) && (
          <div className="setup-progress" role="progressbar" aria-label={`Step ${Math.min(step + 1, 4)} of 4`} aria-valuemin={1} aria-valuemax={4} aria-valuenow={Math.min(step + 1, 4)}>
            <span className="setup-progress-fill" style={{ "--progress": Math.min(step, 3) / 3 } as CSSProperties} />
            {[0, 1, 2, 3].map((index) => (
              <span key={index} className="setup-progress-dot" data-complete={index <= step} data-current={index === Math.min(step, 3)} />
            ))}
          </div>
        )}
        <section
          key={state?.user ? `step-${step}` : "welcome"}
          className="setup-card"
          aria-busy={busy}
          data-direction={direction}
          data-leaving={leaving || undefined}
        >
          <div className="setup-art" key={scene}>
            <span className="setup-halo" aria-hidden="true" />
            <Illustration scene={scene} className="setup-idle-art" />
          </div>
          {state?.user && state.entitlement.reason === "suspended" ? (
            <>
              <div className="setup-welcome-heading"><Logo size={36}/><h1 ref={heading} tabIndex={-1}>Your account is paused.</h1></div>
              <p>{state.entitlement.message || "This account has been suspended."}</p>
              {state.entitlement.until && <p className="fine">Access returns {new Date(state.entitlement.until).toLocaleDateString(undefined,{dateStyle:"long"})}.</p>}
              <p className="fine">Your chats and files stay on this PC. If you think this is a mistake, email <a href="mailto:support@mowrai.com">support@mowrai.com</a>.</p>
              <div className="setup-navigation">
                <button disabled={busy} onClick={() => void run(refresh)}>Check again</button>
                <button disabled={busy} onClick={() => void run(async () => { await desktop!.invoke({ action: "logout" }); await refresh(); })}>Sign out</button>
              </div>
            </>
          ) : state?.user && state.entitlement.reason === "offline" && state.setup.step >= 3 ? (
            <>
              <div className="setup-welcome-heading"><Logo size={36}/><h1 ref={heading} tabIndex={-1}>Can’t reach Mowr.</h1></div>
              <p>Mowr checks your account when it opens. Check your internet connection and try again — nothing on this PC has changed.</p>
              {state.error && <p className="fine">{state.error}</p>}
              <div className="setup-navigation">
                <button className="primary" disabled={busy} onClick={() => void run(refresh)}>{busy ? "Checking…" : "Try again"}</button>
                <button disabled={busy} onClick={() => setReadOnly(true)}>Open my files offline</button>
              </div>
            </>
          ) : !state ? (
            <>
              <div className="setup-welcome-heading"><Logo size={36} thinking/><h1>Opening Mowr…</h1></div>
            </>
          ) : !state.user ? (
            <>
              <div className="setup-welcome-heading"><Logo size={40} thinking={browserPending}/><h1 ref={heading} tabIndex={-1}>Welcome to Mowr.</h1></div>
              <p>
                {browserPending
                  ? "Finish signing in in your browser. We’ll bring you back automatically."
                  : "A calm place for your projects, study and documents."}
              </p>
              <button
                className="primary browser-signin"
                disabled={busy || !state.configured}
                onClick={() =>
                  void run(async () => {
                    await desktop!.invoke({ action: "browserLogin" });
                    setBrowserPending(true);
                  })
                }
              >
                {busy
                  ? "Opening…"
                  : browserPending
                    ? "Open browser again"
                    : "Sign in with browser"}
              </button>
              {!state.configured && (
                <p role="status">Sign-in is unavailable in this build.</p>
              )}
            </>
          ) : (
            <>
              <p className="eyebrow">
                MAKE YOURSELF AT HOME · {Math.min(step + 1, 4)} OF 4
              </p>
              <h1 ref={heading} tabIndex={-1}>
                {titles[Math.min(step, 3)]}
              </h1>
              <p>{lines[Math.min(step, 3)]}</p>
              {step >= 3 ? (
                <>
                  <FirstProvider onConnected={setAiConnected} />
                  <button className="primary setup-finish" data-ready={aiConnected} disabled={busy || !aiConnected} onClick={() => void run(() => move(4, () => save(4)))}>
                    {busy ? "Saving…" : "Open workspace"}
                  </button>
                </>
              ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(() => move(step + 1, () => save(step + 1)));
                }}
              >
                {step === 0 ? (
                  <>
                    <label className="setup-field">
                      <span className="setup-field-label">Username</span>
                      <span className="setup-input" data-state={availability === "Available" ? "ok" : availability && availability !== "Checking…" ? "bad" : undefined}>
                        <span className="setup-input-prefix" aria-hidden="true">@</span>
                        <input
                          autoFocus
                          aria-label="Username"
                          value={username}
                          maxLength={24}
                          onChange={(e) =>
                            setUsername(
                              e.target.value
                                .normalize("NFKC")
                                .toLowerCase()
                                .trim(),
                            )
                          }
                          autoComplete="username"
                          spellCheck={false}
                        />
                        <span className="setup-input-mark" aria-hidden="true"><Icon name="check" size={15} /></span>
                      </span>
                    </label>
                    <p
                      className="availability"
                      role="status"
                      aria-live="polite"
                      data-state={availability === "Available" ? "ok" : undefined}
                    >
                      {availability}
                    </p>
                  </>
                ) : step === 1 ? (
                  <label className="setup-field">
                    <span className="setup-field-label">Display name</span>
                    <span className="setup-input setup-input-name">
                      <span className="setup-avatar" data-filled={!!initial} aria-hidden="true">
                        <span key={initial}>{initial || "·"}</span>
                      </span>
                      <input
                        autoFocus
                        aria-label="Display name"
                        value={name}
                        maxLength={80}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="nickname"
                        required
                      />
                    </span>
                  </label>
                ) : step === 2 ? (
                  <MemoryChoice value={memory} onChange={setMemory} />
                ) : null}
                <button
                  className="primary"
                  disabled={
                    busy ||
                    (step === 0 && availability !== "Available") ||
                    (step === 1 && !name.trim())
                  }
                >
                  {busy ? "Saving…" : "Continue"}
                  <Icon name="arrow" size={15} />
                </button>
              </form>
              )}
              <div className="setup-navigation">
                {step > 0 && (
                  <button
                    disabled={busy}
                    onClick={() => void run(() => move(step - 1, () => save(step - 1)))}
                  >
                    Back
                  </button>
                )}
                {step === 3 && (
                  <button disabled={busy} onClick={() => void run(() => move(4, () => save(4)))}>
                    Skip for now
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await desktop!.invoke({ action: "logout" });
                      await refresh();
                    })
                  }
                >
                  Sign out
                </button>
              </div>
              {state.error && <p role="status">{state.error}</p>}
            </>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </section>
        <p className="setup-legal">
          <a href="https://mowrai.com/#/privacy" target="_blank" rel="noreferrer">Privacy</a>
          {" · "}
          <a href="https://mowrai.com/#/terms" target="_blank" rel="noreferrer">Terms</a>
        </p>
      </div>
    </main>
  );
}

/** Two cards instead of a checkbox: what memory does, and what starting fresh means. */
function MemoryChoice({ value, onChange }: { value: boolean; onChange: (on: boolean) => void }) {
  const options = [
    { on: true, title: "Remember", line: "Your preferences and what you’re working on carry into every chat." },
    { on: false, title: "Start fresh", line: "Every chat begins clean. Turn memory on later in Settings." },
  ];
  return (
    <div className="memory-choice" role="radiogroup" aria-label="Memory">
      {options.map((option) => (
        <label key={option.title} className="memory-option" data-on={value === option.on}>
          <input type="radio" name="memory" checked={value === option.on} onChange={() => onChange(option.on)} />
          <span className="memory-option-art" aria-hidden="true">
            {option.on ? (
              <svg viewBox="0 0 32 32"><path d="M16 4.5c-4.6 0-8 3.3-8 7.6 0 2.5 1.2 4.4 2.9 5.8 1 .8 1.6 2 1.6 3.3v1.3h7v-1.3c0-1.3.6-2.5 1.6-3.3 1.7-1.4 2.9-3.3 2.9-5.8 0-4.3-3.4-7.6-8-7.6Z" /><path d="M13 26.5h6" /><path className="memory-spark" d="M16 9v4M14 11h4" /></svg>
            ) : (
              <svg viewBox="0 0 32 32"><path d="M6 9.5h20M6 16h14M6 22.5h9" /><path className="memory-spark" d="M23 21l4 4M27 21l-4 4" /></svg>
            )}
          </span>
          <span className="memory-option-text">
            <b>{option.title}</b>
            <small>{option.line}</small>
          </span>
          <span className="memory-option-tick" aria-hidden="true"><Icon name="check" size={13} /></span>
        </label>
      ))}
    </div>
  );
}

/** Slow light behind the setup: three soft glows that drift, and settle somewhere new on every step. */
function SetupBackdrop() {
  return (
    <div className="setup-backdrop" aria-hidden="true">
      <span className="setup-glow setup-glow-a" />
      <span className="setup-glow setup-glow-b" />
      <span className="setup-glow setup-glow-c" />
      <span className="setup-motes">
        {Array.from({ length: 18 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, "--d": `${14 + ((i * 7) % 11)}s`, "--delay": `${i * -1.9}s` } as CSSProperties} />)}
      </span>
      <span className="setup-grain" />
    </div>
  );
}
