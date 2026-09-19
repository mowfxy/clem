import type { Session } from "@supabase/supabase-js";
const key = "mowr-desktop-return";
export function rememberDesktopReturn() {
  if (!location.hash.startsWith("#/desktop-signin?")) return;
  const callback = new URLSearchParams(location.hash.split("?")[1]).get(
    "callback",
  );
  if (
    !callback ||
    !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/signin\/[a-f0-9]{64}$/.test(callback)
  )
    throw Error("Invalid app sign-in link.");
  const url = new URL(callback);
  if (!url.port || Number(url.port) > 65535)
    throw Error("Invalid app sign-in link.");
  sessionStorage.setItem(
    key,
    JSON.stringify({ callback, expires: Date.now() + 300000 }),
  );
}
export function hasDesktopReturn() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    return !!saved && saved.expires > Date.now();
  } catch {
    return false;
  }
}
export function returnToDesktop(session: Session) {
  if (!hasDesktopReturn()) return false;
  const { callback } = JSON.parse(sessionStorage.getItem(key)!);
  if (
    !/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/signin\/[a-f0-9]{64}$/.test(callback)
  )
    return false;
  sessionStorage.removeItem(key);
  const form = document.createElement("form");
  form.method = "POST";
  form.action = callback;
  for (const [name, value] of Object.entries({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  })) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
  return true;
}
