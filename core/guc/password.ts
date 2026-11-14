// GUC password expiry (docs/GUC-VPS-ENGINE.md "Password expiry"): GUC can force a new password every 30 days. Only the
// CMS home page refusing the saved password counts (a refusal anywhere else is that page's trouble); then the
// connection is `password_needed`, its jobs pause, and the notifier tells the person once and reminds them gently at
// most once a day. The saved password is tried again every six hours, so a false alarm clears without the person.
// Pure, so the engine and its tests share it.
import { cairo } from "./hub.ts";
import { inQuiet, OUTWARD, type Channel, type ProSettings } from "../proactivity/settings.ts";

/** The wait before the CMS home page is asked whether the password really stopped working. */
export const AUTH_RETRY_MS = 8_000;
/** While flagged, the saved password is tried again this often (one request): a false alarm clears by itself. */
export const PASSWORD_RECHECK_MS = 6 * 3600_000;
/** Settings → Connectors → GUC, on the "New password" field. */
export const PASSWORD_ROUTE = "/app/connectors/guc";
export const PASSWORD_SAID = "GUC isn't accepting your password. If the uni asked you to change it, enter the new one here.";
export const PASSWORD_NOTICE = { title: "GUC needs your new password", body: PASSWORD_SAID };
export const PASSWORD_REMINDER = { title: "GUC still needs your new password", body: "Clem paused its GUC checks until you enter it. Nothing was deleted." };

/** The notice's key: the Cairo day the password first failed, so it is said once however often it fails. */
export const authKey = (since: number) => "guc-auth:" + cairo(since).ymd;
export const reminderKey = (t: number) => "guc-auth-reminder:" + cairo(t).ymd;

export type PasswordDue = { kind: "notice" | "reminder"; key: string };
/** What the notifier owes at `now` for a password that stopped working at `since` (null: it works): the notice on the
 *  day it failed (sent once by key; quiet hours hold its pushes), then one gentle reminder a day after that, never in
 *  quiet hours. */
export function passwordDue(since: number | null | undefined, now: number, s: ProSettings): PasswordDue | null {
  if (!since) return null;
  if (cairo(now).ymd === cairo(since).ymd) return { kind: "notice", key: authKey(since) };
  return inQuiet(s, now) ? null : { kind: "reminder", key: reminderKey(now) };
}

/** Everywhere away from the window the person can be reached (it is urgent, so the level doesn't hold it). */
export const passwordChannels = (_s?: ProSettings): Exclude<Channel, "app">[] => [...OUTWARD];
