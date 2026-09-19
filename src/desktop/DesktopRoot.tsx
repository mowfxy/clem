import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Logo } from "../Icons";
import { desktop } from "./bridge";
import type { DesktopStatus } from "../../desktop/contracts";
import "./desktop.css";
import { MfaChallenge } from "./MfaChallenge";
const App = lazy(() => import("../App"));
const Illustration = lazy(() =>
  import("./SetupIllustration").then((module) => ({
    default: module.SetupIllustration,
  })),
);
export default function DesktopRoot() {
  useEffect(()=>desktop!.onAttachment(event=>{void import('./attachment-processing').then(module=>module.extractAttachment(event.bytes,event.name,event.mime)).then(text=>desktop!.invoke({action:'attachmentResult',id:event.id,text})).catch(()=>desktop!.invoke({action:'attachmentResult',id:event.id,error:true}));}),[]);
  const [state, setState] = useState<DesktopStatus | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [signup, setSignup] = useState(false),
    [pending, setPending] = useState(false);
  const [username, setUsername] = useState(""),
    [name, setName] = useState(""),
    [memory, setMemory] = useState(true),
    [availability, setAvailability] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  async function refresh() {
    const next = (await desktop!.invoke({ action: "status" })) as DesktopStatus;
    setState(next);
    setUsername(next.setup.username);
    setName(next.setup.displayName);
    setMemory(next.setup.memory);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const focus = () => void refresh().catch((e) => setError(e.message));
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
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
  if (state?.mfaFactor)
    return <MfaChallenge factorId={state.mfaFactor} onComplete={refresh} />;
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
    "Choose your username.",
    "What should Mowr call you?",
    "Remember what matters?",
    "A little room for your next thought.",
  ];
  return (
    <main className="desktop-setup">
      <header>
        <Logo size={30} />
        <span>mowr</span>
        <small>YOUR SPACE, ON YOUR PC</small>
      </header>
      <div className="setup-layout">
        <div className="setup-art">
          <Suspense fallback={<Logo size={160} />}>
            <Illustration
              scene={
                !state?.user
                  ? "kite"
                  : step === 0
                    ? "conversation"
                    : step === 1
                      ? "sprout"
                      : step === 2
                        ? "bridge"
                        : "telescope"
              }
            />
          </Suspense>
          <p>
            Room to think.
            <br />
            Space to make something of it.
          </p>
        </div>
        <section className="setup-card" aria-busy={busy}>
          {!state ? (
            <>
              <h1>Opening Mowr…</h1>
              <p>Checking your saved account.</p>
            </>
          ) : !state.user ? (
            <>
              <p className="eyebrow">WELCOME TO MOWR</p>
              <h1 ref={heading} tabIndex={-1}>
                {signup
                  ? "Make yourself at home."
                  : "Your next thought starts here."}
              </h1>
              <p>
                Sign in or create an account, then make this space yours. No
                payment is needed to set up.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget,
                    data = new FormData(form);
                  void run(async () => {
                    const next = await desktop!.invoke({
                      action: signup ? "signup" : "login",
                      email: String(data.get("email")),
                      password: String(data.get("password")),
                    });
                    form.reset();
                    setState(next);
                    if (!next.user)
                      setError(
                        "Check your inbox to verify your account before signing in.",
                      );
                    else await refresh();
                  });
                }}
              >
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    name="password"
                    type="password"
                    autoComplete={signup ? "new-password" : "current-password"}
                    minLength={signup ? 12 : 1}
                    required
                  />
                </label>
                <button
                  className="primary"
                  disabled={busy || !state.configured}
                >
                  {signup ? "Create account" : "Sign in"}
                </button>
              </form>
              <button
                className="secondary"
                disabled={busy || !state.configured}
                onClick={() =>
                  void run(async () => {
                    await desktop!.invoke({ action: "google" });
                    setError(
                      "Finish signing in in your browser, then return here.",
                    );
                  })
                }
              >
                Continue with Google in browser
              </button>
              <button className="login-text" onClick={() => setSignup(!signup)}>
                {signup
                  ? "Already have an account? Sign in"
                  : "New here? Create an account"}
              </button>
              <button
                className="login-text"
                onClick={() => {
                  const email =
                    document.querySelector<HTMLInputElement>(
                      "input[name=email]",
                    )?.value;
                  if (!email) {
                    setError("Enter your email address first.");
                    return;
                  }
                  void run(async () => {
                    await desktop!.invoke({ action: "reset", email });
                    setError(
                      "If an account exists, a recovery email will arrive.",
                    );
                  });
                }}
              >
                Forgot password?
              </button>
              {!state.configured && (
                <p role="status">
                  This build needs its public authentication settings before
                  sign-in is available.
                </p>
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
                    <p>
                      Your unique name in Mowr. You can choose a separate
                      display name next.
                    </p>
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
                    <p>
                      Keep useful facts with their sources in the conversation,
                      project or subject where they belong.
                    </p>
                    <label className="setup-choice">
                      <input
                        type="checkbox"
                        checked={memory}
                        onChange={(e) => setMemory(e.target.checked)}
                      />
                      Enable local memory
                    </label>
                    <p className="fine">
                      You can inspect, correct or forget memories.
                      Synchronization is off by default.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="setup-price">
                      $2 <span>/ month</span>
                    </p>
                    <p>
                      Use your own ChatGPT subscription. Provider usage limits
                      apply. Mowr runs its tools locally on your PC.
                    </p>
                    {state.entitlement.active ? (
                      <p>Full access is active for this account.</p>
                    ) : (
                      <p>
                        {pending
                          ? "Waiting for payment confirmation. You can safely close Mowr and return later."
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
                          : "Continue to secure checkout"}
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
