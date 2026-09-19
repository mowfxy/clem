import { useState } from "react";
import { desktop } from "./bridge";
export function MfaChallenge({
  factorId,
  onComplete,
}: {
  factorId: string;
  onComplete: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="desktop-setup">
      <section className="setup-card">
        <h1>Verify your sign-in.</h1>
        <p>Enter the code from your authenticator app.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const code = String(new FormData(e.currentTarget).get("code"));
            setBusy(true);
            void desktop!
              .invoke({ action: "mfa", factorId, code })
              .then(onComplete)
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            Six-digit code
            <input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              required
              autoFocus
            />
          </label>
          <button className="primary" disabled={busy}>
            Verify
          </button>
        </form>
        <button
          onClick={() =>
            void desktop!.invoke({ action: "logout" }).then(onComplete)
          }
        >
          Back to sign in
        </button>
        {error && <p role="alert">{error}</p>}
      </section>
    </main>
  );
}
