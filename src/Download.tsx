import { useEffect, useState } from "react";
import { SiteHeader } from "./SiteHeader";
import { Logo, Icon } from "./Icons";
import { SecuritySettings } from "./AccountSettings";
export function Download({
  account = false,
  returning = false,
}: {
  account?: boolean;
  returning?: boolean;
}) {
  const [release, setRelease] = useState<{
    url: string;
    version: string;
    signed: boolean;
  } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/desktop-release.json", { signal: abort.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then(setRelease)
      .catch(() => {});
    return () => abort.abort();
  }, []);
  return (
    <div className="marketing">
      <SiteHeader />
      <main>
        <section className="marketing-intro">
          <Logo size={60} />
          <p className="eyebrow">MOWR FOR WINDOWS</p>
          <h1>
            {returning
              ? "Your space is waiting."
              : "A little room.\nOn your own PC."}
          </h1>
          <p>
            {returning
              ? "Return to Mowr to check your payment status. Access is confirmed securely by the account service."
              : "Download freely. Sign in, make the space yours, then choose the $2/month plan inside the app."}
          </p>
          {release?.url ? (
            <a className="primary" href={release.url}>
              Download Mowr <Icon name="download" size={19} />
            </a>
          ) : (
            <p role="status">
              The Windows installer is being prepared. A download will appear
              here when the build is published.
            </p>
          )}
          {release && (
            <p className="fine">
              Windows x64 · {release.version} ·{" "}
              {release.signed
                ? "Signed installer"
                : "Unsigned preview: Windows may display an unknown-publisher warning."}
            </p>
          )}
          <p className="fine">
            Your own ChatGPT subscription is required for Codex. Provider limits
            apply.
          </p>
        </section>
        <section className="about-story">
          <h2>Your work stays close.</h2>
          <p>
            The interface, documents and local tools run on your PC. Selected
            context is sent to your connected AI provider when you request a
            response. Account and subscription checks use lightweight online
            services.
          </p>
          <h2>One place to subscribe.</h2>
          <p>
            Start purchases, upgrades and renewals that need your action from
            Mowr. Lemon Squeezy completes payment securely in your browser. You
            can install and create your account before paying.
          </p>
          <p>
            Payments are not enabled until the payment-provider configuration is
            complete.
          </p>
          {account && <SecuritySettings />}
        </section>
      </main>
    </div>
  );
}
