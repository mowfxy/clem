const key = "clem-drive-return";
/** A desktop request to choose files or a folder in Google's own picker, matched back to the app by `request`. */
type Pick = { pick?: "files" | "folder"; request?: string };
export function rememberDriveReturn() {
  if (!location.hash.startsWith("#/drive-connect?")) return;
  const query = new URLSearchParams(location.hash.split("?")[1]);
  const account = query.get("account"), pick = query.get("pick"), request = query.get("request");
  if (!account || !/^[a-f0-9-]{36}$/.test(account))
    throw Error("Invalid Drive connection link.");
  if ((pick && pick !== "files" && pick !== "folder") || (request && !/^[\w-]{16,64}$/.test(request)) || !pick !== !request)
    throw Error("Invalid Drive connection link.");
  sessionStorage.setItem(
    key,
    JSON.stringify({ account, ...(pick ? { pick, request } : {}), expires: Date.now() + 600000 }),
  );
}
export function returnToDrive() {
  const raw = sessionStorage.getItem(key);
  if (!raw) return false;
  sessionStorage.removeItem(key);
  try {
    const saved = JSON.parse(raw) as Pick & { account: string; expires: number };
    if (saved.expires < Date.now() || !/^[a-f0-9-]{36}$/.test(saved.account))
      return false;
    const query = new URLSearchParams({ desktop: "1", account: saved.account });
    if ((saved.pick === "files" || saved.pick === "folder") && saved.request && /^[\w-]{16,64}$/.test(saved.request))
      query.set("pick", saved.pick), query.set("request", saved.request);
    location.assign("/api/drive/connect?" + query);
    return true;
  } catch {
    return false;
  }
}
