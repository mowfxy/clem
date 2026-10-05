import { SettingsPopup } from "../SettingsPopup";
import "../dialogs.css";
import { useEffect, useState } from "react";
import { desktop } from "./bridge";
/** Changing a password proves who you are first: the current password (or an emailed code
 *  for accounts created with Google) plus the authenticator code when one is enabled. */
function PasswordChange({ hasPassword, mfa, busy, run, onError }: {
  hasPassword: boolean; mfa: boolean; busy: boolean;
  run: (fn: () => Promise<unknown>, message?: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [sent, setSent] = useState(false);
  return (
    <form
      className="password-change"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget, fields = new FormData(form),
          password = String(fields.get("password")),
          confirm = String(fields.get("confirm"));
        if (password !== confirm) { onError("The new passwords do not match."); return; }
        if (!hasPassword && !sent) { onError("Send yourself a verification code first."); return; }
        void run(async () => {
          await desktop!.invoke({
            action: "passwordChange",
            password,
            ...(hasPassword ? { currentPassword: String(fields.get("current")) } : { nonce: String(fields.get("nonce")).trim() }),
            ...(mfa ? { code: String(fields.get("code")) } : {}),
          });
          form.reset();
          setSent(false);
        }, "Password changed. Other devices were signed out.");
      }}
    >
      <h3>{hasPassword ? "Change password" : "Set a password"}</h3>
      <p className="fine">
        {hasPassword
          ? "Confirm it’s you with your current password."
          : "Your account uses Google sign-in. We’ll email a code to confirm it’s you."}
      </p>
      {hasPassword ? (
        <label>
          Current password
          <input name="current" type="password" maxLength={128} autoComplete="current-password" required />
        </label>
      ) : (
        <div className="password-code">
          <label>
            Email code
            <input name="nonce" inputMode="text" autoComplete="one-time-code" pattern="[A-Za-z0-9]{6,10}" required={sent} disabled={!sent} placeholder={sent ? "Code from your email" : ""} />
          </label>
          <button type="button" className="secondary" disabled={busy} onClick={() => void run(async () => { await desktop!.invoke({ action: "passwordReauth" }); setSent(true); }, "Check your email for a verification code.")}>
            {sent ? "Send again" : "Email me a code"}
          </button>
        </div>
      )}
      <label>
        New password
        <input name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required />
        <small>At least 12 characters.</small>
      </label>
      <label>
        Confirm new password
        <input name="confirm" type="password" minLength={12} maxLength={128} autoComplete="new-password" required />
      </label>
      {mfa && (
        <label>
          Authenticator code
          <input name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required />
        </label>
      )}
      <button className="primary" disabled={busy}>{busy ? "Checking…" : "Change password"}</button>
    </form>
  );
}
export function LocalSecurity() {
  const [info, setInfo] = useState<{
      email: string;
      google: boolean;
      verified: boolean;
      password?: boolean;
      factors: { id: string; name: string }[];
    }>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [enrollment, setEnrollment] = useState<{ id: string; qr: string } | null>(
      null,
    );
  const refresh = () =>
    desktop!.invoke({ action: "securityInfo" }).then(setInfo);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<unknown>, message = "Saved.") {
    setBusy(true);
    try {
      await fn();
      await refresh();
      setError(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="security-settings">
      <h2>Account security</h2>
      <p>
        {info?.email} · {info?.verified ? "Verified" : "Verification required"}
      </p>
      <SettingsPopup
        title="Password"
        description="Update the password you use to sign in."
        action="Change"
      >
        <PasswordChange
          hasPassword={!!info?.password}
          mfa={!!info?.factors.length}
          busy={busy}
          run={run}
          onError={setError}
        />
        {error && <p role="status">{error}</p>}
      </SettingsPopup>
      <SettingsPopup
        title="Email address"
        description={info?.email}
        action="Change"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const email = String(new FormData(e.currentTarget).get("email"));
            void run(
              () => desktop!.invoke({ action: "emailChange", email }),
              "Confirm the change using the links sent by email.",
            );
          }}
        >
          <h3>Email</h3>
          <label>
            New email
            <input name="email" type="email" required />
          </label>
          <button disabled={busy}>Change email</button>
        </form>
        {error && <p role="status">{error}</p>}
      </SettingsPopup>
      <SettingsPopup
        title="Authenticator"
        description="Protect your account with a verification code."
        action="Manage"
      >
        {" "}
        <h3>Authenticator</h3>
        {info?.factors.map((factor) => (
          <form
            key={factor.id}
            onSubmit={(e) => {
              e.preventDefault();
              const code = String(new FormData(e.currentTarget).get("code"));
              void run(() =>
                desktop!.invoke({
                  action: "mfaRemove",
                  factorId: factor.id,
                  code,
                }),
              );
            }}
          >
            <p>{factor.name}</p>
            <label>
              Current code
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                required
              />
            </label>
            <button disabled={busy}>Verify and remove</button>
          </form>
        ))}
        {enrollment ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const code = String(new FormData(e.currentTarget).get("code"));
              void run(async () => {
                await desktop!.invoke({
                  action: "mfa",
                  factorId: enrollment.id,
                  code,
                });
                setEnrollment(null);
              });
            }}
          >
            <img
              width="220"
              height="220"
              src={
                "data:image/svg+xml;charset=utf-8," +
                encodeURIComponent(enrollment.qr)
              }
              alt="Scan this QR code with your authenticator"
            />
            <label>
              Authenticator code
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                required
              />
            </label>
            <button disabled={busy}>Verify and enable</button>
          </form>
        ) : (
          <button
            disabled={busy || !!info?.factors.length}
            onClick={() =>
              void run(
                async () =>
                  setEnrollment(await desktop!.invoke({ action: "mfaEnroll" })),
                "Scan the code to finish setup.",
              )
            }
          >
            Add authenticator
          </button>
        )}
        {error && <p role="status">{error}</p>}
      </SettingsPopup>{" "}
      <div className="settings-action"><div><h3>Sign out</h3><p>Sign out of Mowr on this PC. Your files stay here.</p></div>
      <button
        disabled={busy}
        onClick={() =>
          void (async () => {
            setBusy(true);
            try {
              await desktop!.invoke({ action: "logout" });
              // The app shell notices the signed-out state when the window regains focus.
              window.dispatchEvent(new Event("focus"));
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          })()
        }
      >
        Sign out
      </button>
      </div>
      <div className="settings-action"><div><h3>Sessions</h3><p>Sign out your other devices.</p></div>
      <button
        disabled={busy}
        onClick={() =>
          void run(
            () => desktop!.invoke({ action: "revokeOtherSessions" }),
            "Other refresh sessions were revoked. Existing access tokens expire according to the authentication service policy.",
          )
        }
      >
        Revoke other sessions
      </button>
      </div>
      {info?.google && (
        <SettingsPopup
          title="Google account"
          description="Manage your linked Google sign-in."
          action="Manage"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                password = String(new FormData(form).get("password"));
              void run(async () => {
                await desktop!.invoke({ action: "unlinkGoogle", password });
                form.reset();
              });
            }}
          >
            <h3>Linked Google account</h3>
            <p>
              Verify a working password before unlinking, so you can still sign
              in.
            </p>
            <label>
              Current password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button disabled={busy}>Verify password and unlink</button>
          </form>
          {error && <p role="status">{error}</p>}
        </SettingsPopup>
      )}
      {error && <p role="status">{error}</p>}
    </section>
  );
}
