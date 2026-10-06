import { useEffect, useState } from "react";
import { desktop } from "../desktop/bridge";
import { SettingsCard, SettingRow, Switch } from "./SettingsParts";

/** Whether closing the window keeps Mowr running in the tray (so routines keep working), and whether it
 *  starts quietly with Windows. */
export function BackgroundSettings() {
  const [value, setValue] = useState<{ keepRunning: boolean; startWithWindows: boolean; startupSupported?: boolean } | null>(null);
  useEffect(() => { void desktop?.background?.().then(setValue).catch(() => {}); }, []);
  if (!desktop?.background || !value) return null;
  const change = (next: Partial<typeof value>) => { setValue({ ...value, ...next }); void desktop!.background!(next).then(setValue).catch(() => {}); };
  return <SettingsCard title="Background">
    <SettingRow title="Keep running when closed" description="Closing the window leaves Mowr in the tray, so routines keep working. Quit from the tray icon."><Switch label="Keep running when closed" checked={value.keepRunning} onChange={(keepRunning) => change({ keepRunning })} /></SettingRow>
    {value.startupSupported !== false && <SettingRow title="Start with Windows" description="Opens quietly in the tray when you sign in to Windows."><Switch label="Start with Windows" checked={value.keepRunning && value.startWithWindows} onChange={(startWithWindows) => change({ startWithWindows })} /></SettingRow>}
  </SettingsCard>;
}
