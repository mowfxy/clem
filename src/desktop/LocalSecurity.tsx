import { SettingsPopup } from "../SettingsPopup";
import { useEffect, useState } from "react";
import { desktop } from "./bridge";
export function LocalSecurity() {
  const [info, setInfo] = useState<{
      email: string;
      google: boolean;
      verified: boolean;
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
        {" "}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              password = String(new FormData(form).get("password"));
            void run(async () => {
              await desktop!.invoke({ action: "passwordChange", password });
              form.reset();
            });
          }}
        >
          <h3>Password</h3>
          <label>
            New password
            <input
              name="password"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
          <button disabled={busy}>Save password</button>
        </form>
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
      <h3>Sessions</h3>
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
