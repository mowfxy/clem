import {Illustration} from "../Illustrations";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Logo } from "../Icons";
import { desktop } from "./bridge";
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
  useEffect(
    () =>
      desktop!.onAttachment((event) => {
        void import("./attachment-processing")
          .then((module) =>
            module.extractAttachment(event.bytes, event.name, event.mime),
          )
          .then((text) =>
            desktop!.invoke({ action: "attachmentResult", id: event.id, text }),
          )
          .catch(() =>
            desktop!.invoke({
              action: "attachmentResult",
              id: event.id,
              error: true,
            }),
          );
      }),
    [],
  );
  const [state, setState] = useState<DesktopStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [browserPending, setBrowserPending] = useState(false),
    [pending, setPending] = useState(false),
    [readOnly, setReadOnly] = useState(false);
  const [username, setUsername] = useState(""),
    [name, setName] = useState(""),
    [memory, setMemory] = useState(true),
    [availability, setAvailability] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
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
    setUsername(next.setup.username);
    setName(next.setup.displayName);
    setMemory(next.setup.memory);
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
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [pending]);
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
  // Offline, the local workspace still opens to read; sending waits for a connection.
  if (state?.user && state.setup.step >= 4 && state.entitlement.reason === "offline" && readOnly)
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
    "Your username.",
    "Your name.",
    "Remember what matters?",
    "Make room.",
  ];
  return (
    <main className="desktop-setup">
      <div className="setup-layout">
        <section
          key={state?.user ? `step-${step}` : "welcome"}
          className="setup-card"
          aria-busy={busy}
        >
          <Illustration scene={state?.user ? (step===2?"sprout":step===3?"bridge":"pencil") : "kite"} ambient className="setup-idle-art"/>
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
              <p>Mowr checks your plan when it opens. Check your internet connection and try again — nothing on this PC has changed.</p>
              {state.error && <p className="fine">{state.error}</p>}
              <div className="setup-navigation">
                <button className="primary" disabled={busy} onClick={() => void run(refresh)}>{busy ? "Checking…" : "Try again"}</button>
                {state.setup.step >= 4 && <button disabled={busy} onClick={() => setReadOnly(true)}>Open my files offline</button>}
              </div>
            </>
          ) : !state ? (
            <>
              <div className="setup-welcome-heading"><Logo size={36} thinking/><h1>Opening Mowr…</h1></div>
            </>
          ) : !state.user ? (
            <>
              <div className="setup-welcome-heading"><Logo size={36} thinking={browserPending}/><h1 ref={heading} tabIndex={-1}>Welcome to Mowr.</h1></div>
              <p>
                {browserPending
                  ? "Finish signing in in your browser. We’ll bring you back automatically."
                  : "Your workspace starts here."}
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
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    if (step < 3) await save(step + 1);
                    else if (state.entitlement.active) await save(4);
                    else {
                      await desktop!.invoke({ action: "checkout" });
                      setPending(true);
                    }
                  });
                }}
              >
                {step === 0 ? (
                  <>
                    <p>Unique to you.</p>
                    <label>
                      Username
                      <input
                        autoFocus
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
                    </label>
                    <p
                      className="availability"
                      role="status"
                      aria-live="polite"
                    >
                      {availability}
                    </p>
                  </>
                ) : step === 1 ? (
                  <>
                    <p>A name that feels like you.</p>
                    <label>
                      Display name
                      <input
                        autoFocus
                        value={name}
                        maxLength={80}
                        onChange={(e) => setName(e.target.value)}
                        autoComplete="nickname"
                        required
                      />
                    </label>
                  </>
                ) : step === 2 ? (
                  <>
                    <p>Keep useful context for next time.</p>
                    <label className="setup-choice">
                      <input
                        type="checkbox"
                        checked={memory}
                        onChange={(e) => setMemory(e.target.checked)}
                      />
                      Enable memory
                    </label>
                    <p className="fine">
                      Memory syncs to your account. Files stay local.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="setup-price">
                      $2 <span>/ month</span>
                    </p>
                    <p>Requires your own ChatGPT subscription.</p>
                    {state.entitlement.active ? (
                      <p>Your access is ready.</p>
                    ) : (
                      <p>
                        {pending
                          ? "Waiting for payment…"
                          : "Continue to Lemon Squeezy’s secure checkout in your browser. Your setup is saved if you cancel."}
                      </p>
                    )}
                  </>
                )}
                <button
                  className="primary"
                  disabled={
                    busy ||
                    (step === 0 && availability !== "Available") ||
                    (step === 1 && !name.trim())
                  }
                >
                  {busy
                    ? "Saving…"
                    : step < 3
                      ? "Continue"
                      : state.entitlement.active
                        ? "Open workspace"
                        : pending
                          ? "Return to checkout"
                          : "Subscribe"}
                </button>
              </form>
              <div className="setup-navigation">
                {step > 0 && (
                  <button
                    disabled={busy}
                    onClick={() => void run(() => save(step - 1))}
                  >
                    Back
                  </button>
                )}
                {step === 2 && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setMemory(false);
                        await desktop!.invoke({
                          action: "setup",
                          step: 3,
                          username,
                          displayName: name,
                          memory: false,
                        });
                        await refresh();
                      })
                    }
                  >
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
          {state?.user && (
            <div
              className="setup-progress"
              aria-label={`Step ${Math.min(step + 1, 4)} of 4`}
            >
              {[0, 1, 2, 3].map((index) => (
                <span key={index} data-complete={index <= step} />
              ))}
            </div>
          )}
          <p className="setup-legal">
            <a
              href="https://mowrai.com/#/privacy"
              target="_blank"
              rel="noreferrer"
            >
              Privacy
            </a>{" "}
            ·{" "}
            <a
              href="https://mowrai.com/#/terms"
              target="_blank"
              rel="noreferrer"
            >
              Terms
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
