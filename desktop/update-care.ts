import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Runs once on the first launch of a new version, before the workspace is read:
 *  1. copies every account's workspace.json into Accounts/<id>/Backups so an update can never cost work,
 *     keeping only the three newest copies;
 *  2. drops caches the old version left behind (they are rebuilt on demand, nothing personal is in them).
 *  Chats, files, IndexedDB and Local Storage are never touched. */
export async function afterUpdate(workspaceRoot: string, version: string, clearCaches: () => Promise<void>) {
  const marker = join(workspaceRoot, ".app-version");
  const previous = (await readFile(marker, "utf8").catch(() => "")).trim();
  if (previous === version) return;
  {
    // Also runs when no marker exists yet, so people updating from builds before this one are covered.
    const accounts = join(workspaceRoot, "Accounts");
    for (const owner of await readdir(accounts).catch(() => [] as string[])) {
      const state = join(accounts, owner, "workspace.json"), backups = join(accounts, owner, "Backups");
      try {
        await mkdir(backups, { recursive: true });
        await copyFile(state, join(backups, `workspace-before-${Date.now()}-${version.replace(/[^\w.-]/g, "_")}.json`));
        const old = (await readdir(backups)).filter((n) => n.startsWith("workspace-before-")).sort();
        for (const name of old.slice(0, -3)) await rm(join(backups, name), { force: true });
      } catch { /* no workspace for this account yet */ }
    }
    await clearCaches().catch(() => {});
  }
  await writeFile(marker, version);
}
