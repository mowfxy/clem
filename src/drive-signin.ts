const key = "clem-drive-return";
export function rememberDriveReturn() {
  if (!location.hash.startsWith("#/drive-connect?")) return;
  const account = new URLSearchParams(location.hash.split("?")[1]).get(
    "account",
  );
  if (!account || !/^[a-f0-9-]{36}$/.test(account))
    throw Error("Invalid Drive connection link.");
  sessionStorage.setItem(
    key,
    JSON.stringify({ account, expires: Date.now() + 600000 }),
  );
}
export function returnToDrive() {
  const raw = sessionStorage.getItem(key);
  if (!raw) return false;
  sessionStorage.removeItem(key);
  try {
    const saved = JSON.parse(raw);
    if (saved.expires < Date.now() || !/^[a-f0-9-]{36}$/.test(saved.account))
      return false;
    location.assign(
      "/api/drive/connect?desktop=1&account=" +
        encodeURIComponent(saved.account),
    );
    return true;
  } catch {
    return false;
  }
}
