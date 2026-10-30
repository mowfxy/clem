import { useEffect, useState } from "react";
import type { UpdateState } from "../../desktop/contracts";
import { Icon } from "../Icons";
import { SettingsCard, SettingRow, Switch } from "../settings/SettingsParts";
import { desktop } from "./bridge";
import "./update.css";

/** Clem's own update state from the main process (desktop/app-update.ts), kept current as it checks and downloads. */
export function useAppUpdate() {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    if (!desktop?.update) return;
    const stop = desktop.onUpdate?.(setState);
    void desktop.update().then(setState).catch(() => {});
    return stop;
  }, []);
  return state;
}
export const updateRequest = (request?: { automatic: boolean } | { op: "check" | "download" | "install" }) => desktop?.update?.(request);

const ago = (at?: number) => {
  if (!at) return "";
  const minutes = Math.round((Date.now() - at) / 60_000);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`;
};

/** Beside the name in the sidebar, the size of the settings button: a ring filling while a new version downloads, then
 *  a full coral ring with an arrow up to restart into it. With automatic updates off, an empty ring with an arrow down
 *  downloads the version on offer. Nothing at all otherwise. */
export function updateChipPhase(state: UpdateState | null) {
  if (!state?.supported) return null;
  const phase = state.phase === "available" && !state.automatic ? "available" : state.phase;
  return phase === "downloading" || phase === "ready" || phase === "available" ? phase : null;
}
export function UpdateIndicator({ state, onInstall, onOpen }: { state: UpdateState | null; onInstall: () => void; onOpen: () => void }) {
  const phase = updateChipPhase(state);
  if (!state || !phase) return null;
  const percent = phase === "ready" ? 100 : phase === "downloading" ? state.percent ?? 0 : 0, r = 8.5, length = 2 * Math.PI * r;
  const [label, click] = phase === "ready" ? [`Restart to update Clem to ${state.next}`, onInstall]
    : phase === "downloading" ? [`Downloading Clem ${state.next}, ${percent} percent`, onOpen]
    : [`Download Clem ${state.next}`, () => void updateRequest({ op: "download" })];
  return <button className={`update-chip icon-button ${phase}`} onClick={click} title={phase === "downloading" ? `Downloading Clem ${state.next} · ${percent}%` : label} aria-label={label}>
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
      <circle className="update-track" cx="11" cy="11" r={r} />
      <circle className="update-fill" cx="11" cy="11" r={r} strokeDasharray={length} strokeDashoffset={length * (1 - percent / 100)} />
      <path className="update-arrow" d={phase === "ready" ? "M11 14.6V7.6M8.4 10.2 11 7.6l2.6 2.6" : "M11 7.4v7M8.4 11.8 11 14.4l2.6-2.6"} />
    </svg>
  </button>;
}

/** Settings → General → Updates: automatic updates on or off, the version, and checking or installing by hand. */
export function UpdateSettings({ state, onInstall }: { state: UpdateState | null; onInstall: () => void }) {
  const [checking, setChecking] = useState(false);
  if (!desktop?.update || !state) return null;
  const status = !state.supported ? "Updates work in the installed app."
    : state.phase === "checking" || checking ? "Checking for a new version…"
    : state.phase === "downloading" ? `Downloading ${state.next} · ${state.percent ?? 0}%`
    : state.phase === "ready" ? `${state.next} is ready. Restart Clem to finish; your chats and files stay as they are.`
    : state.phase === "available" ? `${state.next} is available.`
    : state.phase === "error" ? state.error
    : state.phase === "current" ? `Up to date · checked ${ago(state.checkedAt)}`
    : "Clem checks for new versions every few hours.";
  const check = () => { setChecking(true); void updateRequest({ op: "check" })?.finally(() => setChecking(false)); };
  return <SettingsCard title="Updates">
    <SettingRow title="Update automatically" description="Installs on the next restart.">
      <Switch label="Update automatically" checked={state.automatic} onChange={(automatic) => void updateRequest({ automatic })} />
    </SettingRow>
    <SettingRow title={`Clem ${state.version}`} description={<span className={state.phase === "error" ? "update-status error" : "update-status"} role="status">{status}</span>}>
      {state.supported && (state.phase === "ready" ? <button className="secondary" onClick={onInstall}><Icon name="restart" size={15} />Restart to update</button>
        : state.phase === "available" ? <button className="secondary" onClick={() => void updateRequest({ op: "download" })}><Icon name="download" size={15} />Download</button>
        : state.phase === "downloading" ? <progress className="update-progress" max={100} value={state.percent ?? 0} aria-label="Download progress" />
        : <button className="secondary" disabled={checking || state.phase === "checking"} onClick={check}><Icon name="refresh" size={15} />Check now</button>)}
    </SettingRow>
  </SettingsCard>;
}
