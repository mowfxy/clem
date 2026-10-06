import { useEffect, useState } from "react";
import { desktop } from "./bridge";
import { Icon } from "../Icons";
import { copyText } from "../clipboard";
import { TELEGRAM_COMMANDS } from "../../core/telegram-commands";
import "./telegram.css";

/** Every command the bot understands and what it does; they also appear in Telegram's "/" menu once paired. */
export function TelegramCommands() {
  return (
    <dl className="tg-commands">
      {TELEGRAM_COMMANDS.map((c) => (
        <div key={c.name}>
          <dt><code>{c.usage}</code></dt>
          <dd>{c.does}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Telegram's paper plane, drawn to sit with Mowr's line icons. */
function PlaneMark() {
  return <svg className="tg-mark" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M21.2 4.2 2.9 11.3c-.9.4-.9 1.6.1 1.9l4.6 1.4 1.8 5.6c.3.8 1.3 1 1.9.4l2.6-2.5 4.7 3.5c.7.5 1.7.1 1.9-.7L23 5.6c.2-1-.8-1.8-1.8-1.4Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="m7.6 14.6 10.1-6.7-7.9 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** Pair the person's own Telegram bot with a scope: three plain steps, then the pairing code to send. */
export function TelegramPanel({ scope, labelFor }: { scope: string; /** A pairing's scope in the person's own words. */ labelFor: (scope: string) => string }) {
  const [state, setState] = useState<{ enabled: boolean; routes: { scope: string }[]; error?: string }>({ enabled: false, routes: [] }),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const refresh = () => desktop!.invoke({ action: "telegramStatus" }).then(setState);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(() => void refresh().catch(() => {}), 10000);
    return () => clearInterval(timer);
  }, []);
  const paired = state.routes?.[0]?.scope;

  return (
    <div className="tg">
      <div className={`tg-status ${state.enabled ? (paired ? "on" : "waiting") : ""}`}>
        <span className="tg-badge"><PlaneMark /></span>
        <div>
          <strong>{!state.enabled ? "Not connected" : paired ? "Connected" : "Waiting for pairing"}</strong>
          <small>{!state.enabled ? "Talk to Mowr from your phone through your own Telegram bot." : paired ? `Messages to your bot go to ${labelFor(paired)}.` : "Send the code below to your bot to finish."}</small>
        </div>
        {state.enabled && <span className="tg-dot" aria-hidden="true" />}
      </div>

      {state.enabled ? (
        <>
          {code && (
            <div className="tg-code">
              <span>Send this to your bot within five minutes</span>
              <div className="tg-code-row">
                <code>/start {code}</code>
                <button type="button" onClick={() => void copyText(`/start ${code}`).then((ok) => { setCopied(ok); setTimeout(() => setCopied(false), 1600); })}>
                  <Icon name={copied ? "check" : "copy"} size={15} />{copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}
          <button type="button" className="tg-disconnect" disabled={busy}
            onClick={() => {
              setBusy(true);
              void desktop!.invoke({ action: "telegramDisconnect" }).then(() => { setCode(""); return refresh(); })
                .catch((e) => setError(e.message)).finally(() => setBusy(false));
            }}>
            Disconnect and forget the token
          </button>
        </>
      ) : (
        <ol className="tg-steps">
          <li>
            <span className="tg-n">1</span>
            <div><strong>Create a bot</strong><p>In Telegram, open <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a>, send <code>/newbot</code> and copy the token it gives you.</p></div>
          </li>
          <li>
            <span className="tg-n">2</span>
            <div>
              <strong>Paste the token</strong>
              <form className="tg-form" onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget, token = String(new FormData(form).get("token")).trim();
                setBusy(true); setError("");
                void desktop!.invoke({ action: "telegramConnect", token, scope })
                  .then(async (result) => { form.reset(); setCode(result.code); await refresh(); })
                  .catch((e) => setError(e.message)).finally(() => setBusy(false));
              }}>
                <input name="token" type="password" autoComplete="off" required aria-label="Bot token" placeholder="123456789:AAF…" />
                <button className="primary" disabled={busy}>{busy ? "Connecting…" : "Connect"}</button>
              </form>
              <p className="tg-for">Replies will use {labelFor(scope)}.</p>
            </div>
          </li>
          <li>
            <span className="tg-n">3</span>
            <div><strong>Send the pairing code</strong><p>Mowr shows a code here. Send it to your bot to link it to you.</p></div>
          </li>
        </ol>
      )}

      <div className="tg-info">
        <div><Icon name="attach" size={16} /><span>Text, photos (JPEG, PNG), PDFs, Word files and plain text, up to 20 MB</span></div>
        <div><Icon name="files" size={16} /><span>Start with <code>/new</code> for a fresh conversation, <code>/space</code> to switch subject or project, <code>/pdf</code> for a PDF answer; <code>/help</code> lists the rest</span></div>
        <div><Icon name="clock" size={16} /><span>Mowr must be open on this PC to reply; Telegram holds messages for a while</span></div>
      </div>
      {(error || state.error) && <p className="tg-error" role="alert">{error || state.error}</p>}
    </div>
  );
}
