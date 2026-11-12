// Settings → Connectors → VPS: the row and the status it reads. The dialog behind Manage (VpsSettings.tsx) loads only
// when it opens.
import { useEffect, useState } from "react";
import type { VpsStatus } from "../../core/vps/types";
import { Icon } from "../Icons";
import { desktop } from "../desktop/bridge";
import { SettingRow } from "../settings/SettingsParts";
import "../drive/drive.css";
import "../guc/guc.css";
import "./vps.css";

/** The VPS status, refreshed on every change main reports (a move's progress, the worker, a test). */
export function useVps() {
  const [status, setStatus] = useState<VpsStatus | null>(null), [step, setStep] = useState("");
  const refresh = async () => { if (!desktop) return; try { setStatus(await desktop.invoke({ action: "vpsStatus" })); } catch { /* keeps the last */ } };
  useEffect(() => { void refresh(); return desktop?.onVps?.((e) => { if (e.what.startsWith("progress:")) setStep(e.what.slice(9)); else void refresh(); }); }, []);
  return { status, setStatus, refresh, step };
}
export const bytes = (n = 0) => n < 1024 ** 2 ? `${Math.max(0, Math.round(n / 1024))} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB` : `${(n / 1024 ** 3).toFixed(1)} GB`;
type Dot = "on" | "warn" | "off";
export const dotOf = (s: VpsStatus | null): Dot => !s?.connected ? "off" : s.lastTest?.ok === false || s.online === false || s.worker.error ? "warn" : s.online || s.lastTest?.ok ? "on" : "off";
export const StatusDot = ({ dot, label }: { dot: Dot; label: string }) => <span className={`vps-dot is-${dot}`} role="img" aria-label={label} />;

/** Settings → Connectors → VPS, under GUC. */
export function VpsRow({ onManage }: { onManage: () => void }) {
  const { status } = useVps();
  const d = dotOf(status);
  const description = !status ? "Your own server, always on." : !status.connected ? "Your own server, always on." : [status.storage.mode === "vps" ? "Files on your VPS" : "Files on this PC", status.worker.enabled ? (status.worker.runner === "worker" ? "jobs on your VPS" : "jobs on this PC") : ""].filter(Boolean).join(" · ");
  return <SettingRow lead={<span className="connector-tile"><Icon name="server" size={22} /></span>} title={<span className="vps-row-title">VPS{status?.connected && <StatusDot dot={d} label={d === "on" ? "Online" : d === "warn" ? "Needs attention" : "Not checked yet"} />}</span>} description={description}>
    <button className="secondary" onClick={onManage}>{status?.connected ? "Manage" : "Set up"}</button>
  </SettingRow>;
}
