import { app } from "electron";
import { autoUpdater, type NsisUpdater } from "electron-updater";
import { verifySignature } from "electron-updater/out/windowsExecutableCodeSignatureVerifier";
import { noteEvent } from "./diagnostics";
import type { UpdateState } from "./contracts";

export type UpdateRequest = { automatic?: boolean } | { op: "check" | "download" | "install" };

/** Releases are published on GitHub (mowfxy/clem-releases) with latest.yml beside the installer: electron-builder's
 *  publish config writes this same address into the installed app-update.yml (electron-builder.cjs). */
export const UPDATE_FEED = "https://github.com/mowfxy/clem-releases/releases/latest/download";
const CHECK_EVERY = 4 * 60 * 60_000, FIRST_CHECK = 45_000;

/**
 * Clem updating itself from its GitHub releases. Safety:
 *  - only the pinned HTTPS feed above is ever read, and never an older version (no downgrades);
 *  - the installer must match the SHA-512 in latest.yml (electron-updater checks it before anything runs);
 *  - once Clem's builds are code-signed, an update must be signed by the same publisher; while the running build
 *    is itself an unsigned preview, the checksum from the release is what is trusted;
 *  - nothing installs while an answer, run or routine is working (`busy`), and the install keeps every chat and
 *    file: the installer leaves Documents\Clem alone on updates and afterUpdate (update-care.ts) backs up each
 *    workspace on the first launch of the new version.
 * With automatic updates on, a new version downloads in the background and installs when Clem quits (or now, from
 * the indicator). Off, Clem still checks and offers the update, but downloads and installs only when asked.
 */
export function appUpdates(options: {
  read: () => Promise<{ automatic: boolean }>;
  write: (value: { automatic: boolean }) => Promise<void>;
  /** Sends the state to the window. */
  send: (state: UpdateState) => void;
  /** An answer, run or routine is working, so installing now would cut it off. */
  busy: () => boolean;
  /** Lets the window close instead of hiding to the tray, right before the installer takes over. */
  beforeInstall: () => void;
}) {
  const supported = app.isPackaged && process.platform === "win32";
  let state: UpdateState = { automatic: true, version: app.getVersion(), supported, phase: "idle" };
  const set = (next: Partial<UpdateState>) => { state = { ...state, ...next }; options.send(state); };
  let ready = options.read().then((saved) => { state.automatic = saved.automatic !== false; }).catch(() => {});

  autoUpdater.logger = { info: () => {}, debug: () => {}, warn: (m: unknown) => noteEvent("update:", m), error: () => {} };
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoDownload = false;
  // Must be on when a download finishes for electron-updater to add its quit handler; before-quit below decides.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.fullChangelog = false;
  // Signed-to-signed once Clem is signed; checksum-only between unsigned previews (see above).
  let runningSigned: Promise<boolean> | undefined;
  if (supported) (autoUpdater as NsisUpdater).verifyUpdateCodeSignature = async (publishers: string[], file: string) => {
    runningSigned ??= verifySignature(publishers, process.execPath, autoUpdater.logger as any).then((error) => error == null).catch(() => false);
    return (await runningSigned) ? verifySignature(publishers, file, autoUpdater.logger as any) : null;
  };

  const ignore = new Set(["ERR_UPDATER_LATEST_VERSION_NOT_FOUND"]);
  const plain = (error: any) => {
    const text = String(error?.message || error || "");
    if (error?.code === "ERR_UPDATER_INVALID_SIGNATURE") return "The new version isn’t signed by Clem, so it wasn’t installed.";
    if (/sha512 checksum mismatch/i.test(text)) return "The download didn’t match the release, so it was discarded. Clem will try again later.";
    if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|ERR_INTERNET|ERR_NETWORK|net::/i.test(text)) return "Couldn’t reach the update server. Check your connection.";
    return "Couldn’t update just now. Clem will try again later.";
  };
  autoUpdater.on("checking-for-update", () => { if (state.phase !== "downloading" && state.phase !== "ready") set({ phase: "checking", error: undefined }); });
  autoUpdater.on("update-not-available", () => set({ phase: "current", next: undefined, checkedAt: Date.now() }));
  autoUpdater.on("update-available", (info) => {
    set({ phase: "available", next: info.version, checkedAt: Date.now() });
    if (state.automatic) void download();
  });
  autoUpdater.on("download-progress", (p) => set({ phase: "downloading", percent: Math.max(0, Math.min(100, Math.round(p.percent))) }));
  autoUpdater.on("update-downloaded", (info) => {
    set({ phase: "ready", next: info.version, percent: 100 });
    noteEvent("update ready:", info.version);
  });
  autoUpdater.on("error", (error: any) => {
    if (ignore.has(error?.code)) { set({ phase: "current", checkedAt: Date.now() }); return; }
    noteEvent("update failed:", error?.code || "", String(error?.message || error).slice(0, 300));
    // A failed check keeps a download already waiting.
    if (state.phase !== "ready") set({ phase: "error", error: plain(error), percent: undefined });
  });

  let downloading: Promise<unknown> | undefined;
  const download = () => downloading ??= autoUpdater.downloadUpdate().catch(() => {}).finally(() => { downloading = undefined; });
  const check = async () => {
    await ready;
    if (!supported || state.phase === "downloading" || state.phase === "ready" || downloading) return;
    await autoUpdater.checkForUpdates().catch(() => {});
  };
  const install = () => {
    if (state.phase !== "ready" || options.busy()) return false;
    options.beforeInstall();
    // Silent: the installer keeps the install folder and opens Clem again when it is done.
    autoUpdater.quitAndInstall(true, true);
    return true;
  };

  if (supported) {
    setTimeout(() => void check(), FIRST_CHECK).unref?.();
    setInterval(() => void check(), CHECK_EVERY).unref?.();
  }
  // Quitting with an update waiting installs it then (automatic only), but never while Windows shuts down,
  // which could stop the installer half-way.
  let sessionEnding = false;
  app.on("before-quit", () => { autoUpdater.autoInstallOnAppQuit = state.automatic && !sessionEnding; });

  return {
    get state() { return state; },
    sessionEnding() { sessionEnding = true; autoUpdater.autoInstallOnAppQuit = false; },
    async handle(request?: UpdateRequest) {
      await ready;
      if (request && "automatic" in request && typeof request.automatic === "boolean") {
        await options.write({ automatic: request.automatic });
        set({ automatic: request.automatic });
        if (request.automatic && state.phase === "available") void download();
      } else if (request && "op" in request) {
        if (request.op === "check") await check();
        else if (request.op === "download" && supported && (state.phase === "available" || (state.phase === "error" && state.next))) void download();
        else if (request.op === "install" && !install()) return { ...state, busy: options.busy() };
      }
      return state;
    },
  };
}
