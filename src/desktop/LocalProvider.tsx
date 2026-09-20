import { useEffect, useState } from "react";
import { desktop } from "./bridge";
export function LocalProvider({ onDone }: { onDone: () => void }) {
  const [connected, setConnected] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [challenge, setChallenge] = useState<{ url: string; code: string } | null>(
      null,
    );
  useEffect(() => {
    let active = true;
    const check = () =>
      void desktop!
        .invoke({ action: "providerStatus" })
        .then((result) => {
          if (active) {
            setConnected(result.connected);
            if (result.connected) {
              setChallenge(null);
              onDone();
            }
          }
        })
        .catch(() => {});
    check();
    const timer = setInterval(check, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <div className="desktop-provider">
      <h3>Codex · your ChatGPT subscription</h3>
      <p>
        {connected
          ? "Connected on this PC."
          : "Connect through the official Codex CLI. No API key is used."}
      </p>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError("");
          void desktop!
            .invoke({ action: connected ? "providerLogout" : "providerLogin" })
            .then((result) => {
              if (connected) {
                setConnected(false);
                onDone();
              } else setChallenge(result);
            })
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy
          ? "Connecting…"
          : connected
            ? "Disconnect"
            : "Connect subscription"}
      </button>
      {challenge && (
        <>
          <p>Sign in with ChatGPT, then enter this code. Device code login must be enabled in your ChatGPT security settings.</p>
          <a className="secondary" href={challenge.url} target="_blank" rel="noreferrer">Open sign-in page</a>
          <code>{challenge.code}</code>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <p className="fine">
        Credentials stay in the Windows credential store. The official Codex
        CLI is included. Grok Build is not enabled in this build.
      </p>
    </div>
  );
}
