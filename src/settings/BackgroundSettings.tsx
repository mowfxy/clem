import { useEffect, useState } from "react";
import { desktop } from "../desktop/bridge";
import { SettingsCard, SettingRow, Switch } from "./SettingsParts";

/** Whether closing the window keeps Clem running in the tray (so routines keep working), and whether it
 *  starts quietly with Windows. */
export function BackgroundSettings() {
  const [value, setValue] = useState<{ keepRunning: boolean; startWithWindows: boolean } | null>(null);
  useEffect(() => { void desktop?.background?.().then(setValue).catch(() => {}); }, []);
  if (!desktop?.background || !value) return null;
  const change = (next: Partial<typeof value>) => { setValue({ ...value, ...next }); void desktop!.background!(next).then(setValue).catch(() => {}); };
  return <SettingsCard title="Background">
    <SettingRow title="Keep running when closed" description="Stays in the tray so routines keep working."><Switch label="Keep running when closed" checked={value.keepRunning} onChange={(keepRunning) => change({ keepRunning })} /></SettingRow>
    <SettingRow title="Start with Windows"><Switch label="Start with Windows" checked={value.keepRunning && value.startWithWindows} onChange={(startWithWindows) => change({ startWithWindows })} /></SettingRow>
  </SettingsCard>;
}
