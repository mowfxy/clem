import { useEffect, useRef, useState } from "react";
import { desktop } from "./bridge";
import { Icon, Logo } from "../Icons";
import { copyText } from "../clipboard";
import { OpenAILogo } from "../BrandLogos";
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
  const [copied, setCopied] = useState(false);
  return (
    <div className="desktop-provider cx-connect">
      <div className="cx-link" aria-hidden="true">
        <span className="cx-tile cx-mowr"><Logo size={26} /></span>
        <span className="cx-wire"><i /><i /><i /></span>
        <span className="cx-tile cx-openai"><OpenAILogo size={26} /></span>
      </div>
      <div className="cx-title">
        <h3>Connect ChatGPT</h3>
        <p>Use your ChatGPT plan in Mowr through Codex.</p>
      </div>
      {!challenge ? (
        <>
          <ol className="cx-steps">
            <li><span>1</span><div><b>Sign in with OpenAI</b><small>In your browser, with a one-time code.</small></div></li>
            <li><span>2</span><div><b>Models sync automatically</b><small>Along with your plan’s usage limits.</small></div></li>
            <li><span>3</span><div><b>Add more accounts anytime</b><small>Switch between them in Settings.</small></div></li>
          </ol>
          <button className="primary cx-go" disabled={busy} onClick={() => void start()}>
            <OpenAILogo size={16} />
            {busy ? "Preparing sign-in…" : "Continue with ChatGPT"}
          </button>
        </>
      ) : (
        <div className="provider-challenge cx-challenge">
          <p>Enter this code on the OpenAI sign-in page</p>
          <button type="button" className="cx-code" aria-description="Copy code" onClick={() => { void copyText(challenge.code).then(ok => { if (!ok) return; setCopied(true); setTimeout(() => setCopied(false), 1600); }); }}>
            <code>{challenge.code}</code>
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
          <a className="primary cx-go" href={challenge.url} target="_blank" rel="noreferrer">
            Open sign-in page
            <Icon name="arrow" size={15} />
          </a>
          <p className="provider-wait"><Icon name="hourglass" size={14} className="cx-wait" />Waiting for your account…</p>
          <p className="cx-hint">If asked, turn on device-code sign-in in ChatGPT’s security settings.</p>
        </div>
      )}
      {error && <div className="provider-recovery"><p role="alert">{error}</p><button className="secondary" disabled={busy} onClick={()=>void start()}>Try again</button></div>}
      <p className="provider-note">
        No API key or password is shared with Mowr. Credentials stay in Windows’ protected credential store.
      </p>
    </div>
  );
}
