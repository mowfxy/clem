// Pairing Telegram: the telegram_pair card in the main thread, and Settings → Channels → Telegram, both drawn from the
// one shared state (./telegram.ts) so they never disagree. A live code counts down from 10 minutes; once the chat
// sends it, both turn into "Connected as @name" with Unpair.
import { left } from "../../core/telegram/pairing";
import { Icon } from "../Icons";
import { SettingRow, SettingsCard } from "../settings/SettingsParts";
import { newCode, unpair, useTelegram } from "./telegram";
import "./telegram.css";

const spaced = (code: string) => code.slice(0, 3) + " " + code.slice(3);
const openLink = (link: string) => { window.open(link, "_blank", "noopener"); };
const since = (t: number) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

/** The code to send, the link that sends it, and how long it lasts. */
function CodeBox({ code, now, bot }: { code: { code: string; link: string; expires: number }; now: number; bot?: string }) {
  const live = code.expires > now;
  return <span className="tg-code-box" data-live={live}>
    <span className="tg-code" aria-label={`Pairing code ${code.code.split("").join(" ")}`}>{spaced(code.code)}</span>
    <small>{live ? <>Send it to <b>@{bot || "the Clem bot"}</b>, or open the link. Expires in <time className="tg-left">{left(code.expires, now)}</time></> : "This code expired. Get a new one."}</small>
  </span>;
}

export function TelegramPairCard() {
  const t = useTelegram(), paired = t.status?.paired, code = !paired ? t.code : null, live = !!code && code.expires > t.now;
  const title = !t.status ? "Telegram" : !t.status.configured ? "Telegram isn’t available yet" : paired ? `Connected as ${paired.name}` : live ? "Pair Telegram" : "Talk to Clem on Telegram";
  const line = !t.status ? "Checking…" : !t.status.configured ? "Clem’s Telegram bot isn’t switched on yet. This card updates when it is." : paired ? `Since ${since(paired.since)}. Ask anything there; updates follow Settings → Proactivity.` : live ? "Open Telegram and send the code below." : "Ask anything from Telegram and get your updates there. It takes a minute.";
  return <div className="edit-proposal clem-card guc-card tg-card" data-state={paired ? "paired" : live ? "code" : "unpaired"} aria-busy={!t.status}>
    <header><Icon name="send" size={16} /><div><strong>{title}</strong><small>{line}</small></div></header>
    {code && <div className="guc-card-body"><CodeBox code={code} now={t.now} bot={t.status?.bot} /></div>}
    {t.error && <p className="edit-problem" role="alert">{t.error}</p>}
    {t.status?.configured && <footer>
      {paired ? <button type="button" disabled={t.busy} onClick={() => void unpair()}>Unpair</button>
        : live ? <><button type="button" disabled={t.busy} onClick={() => void newCode()}>New code</button><button type="button" className="primary" onClick={() => openLink(code!.link)}>Open Telegram <Icon name="external" size={14} /></button></>
        : <button type="button" className="primary" disabled={t.busy} onClick={() => void newCode()}>{code ? "New code" : "Connect Telegram"}</button>}
    </footer>}
  </div>;
}

/** Settings → Channels → Telegram: the same status; pairing itself happens in the main thread (Pair in chat), or here. */
export function TelegramSettings({ onPairInChat, onProactivity }: { onPairInChat: () => void; onProactivity: () => void }) {
  const t = useTelegram(), paired = t.status?.paired, code = !paired ? t.code : null, live = !!code && code.expires > t.now;
  if (!t.status) return <SettingsCard title="Telegram"><div className="st-row" aria-busy="true"><div className="st-row-text"><span className="st-skel" /><span className="st-skel short" /></div></div></SettingsCard>;
  if (!t.status.configured) return <SettingsCard title="Telegram"><SettingRow title="Not available yet" description={t.error || "Clem’s Telegram bot isn’t switched on yet."} /></SettingsCard>;
  return <>
    <SettingsCard title="Pairing" note={paired ? undefined : "Pairing links one Telegram chat to your Clem. Only that chat is answered."}>
      {paired ? <SettingRow title={`Connected as ${paired.name}`} description={`Since ${since(paired.since)}${paired.online === false ? " · Clem on this PC answers when it’s open" : ""}`}>
          <button type="button" className="secondary danger" disabled={t.busy} onClick={() => void unpair()}>Unpair</button>
        </SettingRow>
        : live ? <SettingRow title="Send this code" description={<CodeBox code={code!} now={t.now} bot={t.status.bot} />}>
          <button type="button" className="secondary" disabled={t.busy} onClick={() => void newCode()}>New code</button>
          <button type="button" className="secondary" onClick={() => openLink(code!.link)}>Open Telegram</button>
        </SettingRow>
        : <SettingRow title="Not connected" description={code ? "That code expired." : "Talk to Clem and get your updates in Telegram."}>
          <button type="button" className="secondary" onClick={onPairInChat}>Pair in chat</button>
          <button type="button" className="secondary" disabled={t.busy} onClick={() => void newCode()}>{code ? "New code" : "Get a code"}</button>
        </SettingRow>}
      {t.error && <SettingRow title="Something went wrong" description={t.error} />}
    </SettingsCard>
    {paired && <SettingsCard title="What comes to Telegram" note="Ask in Telegram as you would in your main thread: “what’s due this week?”, “send me lecture 3 slides”.">
      <SettingRow title="Updates" description="Choose which news reaches Telegram, per kind of update. Quiet hours apply.">
        <button type="button" className="secondary" onClick={onProactivity}>Open Proactivity</button>
      </SettingRow>
    </SettingsCard>}
  </>;
}
