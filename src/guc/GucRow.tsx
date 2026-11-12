// Settings → Connectors → GUC: the row and the status it reads. The dialog behind Connect/Manage (GucSettings.tsx)
// loads only when it opens.
import { useEffect, useState } from "react";
import type { GucStatus } from "../../core/guc/types";
import { Icon } from "../Icons";
import { desktop } from "../desktop/bridge";
import { SettingRow } from "../settings/SettingsParts";
import "../drive/drive.css";
import "./guc.css";

const offline: GucStatus = { connected: false, syncing: false, courses: 0, linked: 0 };
export const ago = (t?: number) => {
  if (!t) return "not synced yet";
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "synced just now" : m < 60 ? `synced ${m} min ago` : m < 1440 ? `synced ${Math.round(m / 60)} h ago` : "synced " + new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
};

/** The GUC status the main process keeps (desktop/engine), refreshed on mount and after every change. */
export function useGuc() {
  const [status, setStatus] = useState<GucStatus | null>(null);
  const refresh = async () => { if (!desktop) return setStatus(offline); try { setStatus(await desktop.invoke({ action: "gucStatus" })); } catch { setStatus(offline); } };
  useEffect(() => { void refresh(); }, []);
  return { status, setStatus, refresh };
}

/** Settings → Connectors → GUC, under Google Drive. */
export function GucRow({ onManage }: { onManage: () => void }) {
  const { status } = useGuc();
  const description = !status ? "Courses, grades and announcements." : status.connected ? (status.passwordNeeded ? "Needs your new password" : status.error ? "Needs attention" : `Connected · ${ago(status.lastSync)}`) : "Courses, grades and announcements.";
  return <SettingRow lead={<span className="connector-tile"><Icon name="guc" size={22} /></span>} title="GUC" description={description}>
    <button className="secondary" onClick={onManage}>{status?.connected ? "Manage" : "Connect"}</button>
  </SettingRow>;
}
