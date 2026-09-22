import { useEffect, useRef, useState } from "react";
import { desktop } from "./bridge";
import { Icon } from "../Icons";
import "../models-settings.css";
export function LocalProvider({ onDone, accountId }: { onDone: () => void; accountId?:string }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [challenge, setChallenge] = useState<{
      id: string;
      url: string;
      code: string;
    } | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!challenge) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await desktop!.invoke({
          action: "providerAccountStatus",
          id: challenge.id,
        });
        if (!active) return;
        if(result.loginError){setError(result.loginError);return;}
        if (result.connected) {
          await desktop!.invoke({
            action: "providerAccountSelect",
            id: challenge.id,
          });
          if (active) done.current();
          return;
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
      if (active) timer = setTimeout(() => void poll(), 5000);
    };
    timer = setTimeout(() => void poll(), 2500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [challenge]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      setChallenge(await desktop!.invoke(accountId||challenge?.id?{action:"providerAccountRetry",id:accountId||challenge!.id}:{ action: "providerAccountAdd" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(()=>{if(accountId)void start();},[accountId]);
  return (
    <div className="desktop-provider">
      <div className="provider-intro">
        <span className="model-provider-mark">
          <Icon name="visuals" size={26} />
        </span>
        <div>
          <h3>Codex, with ChatGPT</h3>
          <p>Your models and subscription, together in Mowr.</p>
        </div>
      </div>
      {!challenge ? (
        <>
          <ol className="provider-steps">
            <li>
              <span>01</span>Sign in securely with your ChatGPT account.
            </li>
            <li>
              <span>02</span>Your available models and usage sync automatically.
            </li>
            <li>
              <span>03</span>Add another account or switch anytime in Settings.
            </li>
          </ol>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void start()}
          >
            {busy ? "Preparing sign-in…" : "Continue with ChatGPT"}
            <Icon name="arrow" size={16} />
          </button>
        </>
      ) : (
        <div className="provider-challenge">
          <p>Enter this code on the ChatGPT sign-in page.</p>
          <code>{challenge.code}</code>
          <a
            className="primary"
            href={challenge.url}
            target="_blank"
            rel="noreferrer"
          >
            Open sign-in page
            <Icon name="arrow" size={15} />
          </a>
          <p className="provider-wait">Waiting for your account…</p>
          <p>
            Enable device-code login in ChatGPT security settings if prompted.
          </p>
        </div>
      )}
      {error && <div className="provider-recovery"><p role="alert">{error}</p><button className="secondary" disabled={busy} onClick={()=>void start()}>Try again</button></div>}
      <p className="provider-note">
        No API key needed. Credentials stay in Windows’ protected credential
        store. Usage and model access follow your account’s plan.
      </p>
    </div>
  );
}
