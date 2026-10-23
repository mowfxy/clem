import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  backupDue, backupName, countWorkspace, expired, extractBackup, folderBackups, insideFolder, isBackupName, isEmptyWorkspace,
  previewBackup, swapInto, workspaceEntries, writeBackup, BACKUP_EXTENSION, type BackupKind, type BackupSchedule, type BackupSummary,
} from "./backup.ts";

/** Where backups go: a folder on this PC (OneDrive and Dropbox folders included), or "Clem backups" in Google Drive. */
export type BackupDestination = { kind: "folder"; path: string } | { kind: "drive" };
export type BackupSettings = {
  destination?: BackupDestination;
  schedule: BackupSchedule;
  /** How many backups to keep at the destination. */
  keep: number;
  last?: { at?: number; tried?: number; error?: string; size?: number; where?: string };
};
/** A backup that can be restored: a file on this PC, or one in Google Drive. */
export type BackupItem = { source: "folder"; path: string; name: string; at: number; kind?: BackupKind; size: number } | { source: "drive"; id: string; name: string; at: number; size: number };
/** The few Drive calls backups need (desktop/drive-live.ts). */
export type DriveBackups = {
  connected(): Promise<boolean>;
  backupFolder(): Promise<string>;
  backupFiles(folderId: string): Promise<{ id: string; name: string; size: number; at: number }[]>;
  uploadFile(folderId: string, name: string, path: string): Promise<{ id: string }>;
  downloadFile(id: string, path: string): Promise<void>;
  trash(id: string): Promise<unknown>;
};
/** Document edits and workflow checkpoints, which the window keeps in IndexedDB. */
export type EditStore = { read(owner: string): Promise<[string, unknown][]>; write(owner: string, entries: [string, unknown][]): Promise<void> };
type Vault = { read<T>(key: string, fallback: T): Promise<T>; write(key: string, value: unknown): Promise<void> };

/**
 * Document edits and workflow checkpoints live in the window's IndexedDB (idb-keyval's "keyval-store"); these scripts
 * read and restore them there (run with executeJavaScript). `owner` is checked by its pattern before it goes in the
 * script, and restored entries go in as JSON, which is data in JavaScript and never code.
 */
function inStore(owner: string, body: string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(owner)) throw Error("Invalid account");
  return `(async()=>{const req=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});const open=indexedDB.open("keyval-store");open.onupgradeneeded=()=>open.result.createObjectStore("keyval");const db=await req(open);`
    + `try{const kept=k=>typeof k==="string"&&(k.startsWith("clem-document-")||k.startsWith(${JSON.stringify(`clem-workflow:${owner}:`)}));${body}}finally{db.close();}})()`;
}
/** Resolves to the kept entries, as JSON. */
export const readEditsScript = (owner: string) => inStore(owner, `const store=db.transaction("keyval","readonly").objectStore("keyval");const [keys,values]=await Promise.all([req(store.getAllKeys()),req(store.getAll())]);return JSON.stringify(keys.map((k,i)=>[k,values[i]]).filter(([k])=>kept(k)));`);
/** Replaces the kept entries (and drops this account's cached source text, which belonged to the old files). */
export const writeEditsScript = (owner: string, entries: [string, unknown][]) => inStore(owner, `const tx=db.transaction("keyval","readwrite"),store=tx.objectStore("keyval");const done=new Promise((ok,no)=>{tx.oncomplete=ok;tx.onerror=()=>no(tx.error);});`
  + `for(const k of await req(store.getAllKeys()))if(kept(k)||(typeof k==="string"&&k.startsWith(${JSON.stringify(`clem-source:${owner}:`)})))store.delete(k);for(const [k,v] of ${JSON.stringify(entries)})if(kept(k))store.put(v,k);await done;`);

const defaults: BackupSettings = { schedule: "off", keep: 7 };
const MIN_PASSPHRASE = 8;
const settingsKey = (owner: string) => "backup-" + owner, passKey = (owner: string) => "backup-pass-" + owner;
/** A Drive backup's date, from its name (the header is inside the file). */
const nameDate = (name: string) => { const m = /(\d{4})-(\d\d)-(\d\d) (\d\d)(\d\d)/.exec(name); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0; };

/**
 * Whole-workspace backups (desktop/backup.ts): made now or on a schedule from the main process (which keeps running in
 * the tray), kept to the newest few, and restored after a safety copy of what is there now.
 */
export class BackupService {
  private vault: Vault;
  private root: string;
  private temp: string;
  private app: string;
  private drive: DriveBackups;
  private edits: EditStore;
  private reload: () => void;
  private running = new Map<string, Promise<unknown>>();
  /** Folders the person picked to restore from in this run of Clem; backups are read only from these and the destination. */
  private picked = new Set<string>();
  /** True from the moment a restore replaces the workspace until the window has reloaded it: the window's saves wait
   *  meanwhile, so its old state never overwrites the restored one. */
  restoring = false;
  constructor(o: { vault: Vault; root: string; temp: string; app: string; drive: DriveBackups; edits: EditStore; reload: () => void }) {
    this.vault = o.vault; this.root = o.root; this.temp = o.temp; this.app = o.app; this.drive = o.drive; this.edits = o.edits; this.reload = o.reload;
  }
  private account(owner: string) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(owner)) throw Error("Invalid account");
    return join(this.root, "Accounts", owner);
  }
  /** Copies made before a restore, on this PC. */
  private get safety() { return join(this.root, "Backups"); }
  async settings(owner: string): Promise<BackupSettings> { return { ...defaults, ...(await this.vault.read<Partial<BackupSettings>>(settingsKey(owner), {})) }; }
  private async save(owner: string, change: Partial<BackupSettings>) { const next = { ...(await this.settings(owner)), ...change }; await this.vault.write(settingsKey(owner), next); return next; }
  private passphrase(owner: string) { return this.vault.read<string>(passKey(owner), ""); }

  async status(owner: string) {
    const s = await this.settings(owner);
    return { ...s, passphrase: !!(await this.passphrase(owner)), running: this.running.has(owner), driveConnected: s.destination?.kind === "drive" ? await this.drive.connected().catch(() => false) : undefined };
  }
  async configure(owner: string, change: { destination?: BackupDestination | null; schedule?: BackupSchedule; keep?: number; passphrase?: string }) {
    if (change.passphrase !== undefined) {
      if (change.passphrase.length < MIN_PASSPHRASE) throw Error(`Use at least ${MIN_PASSPHRASE} characters for the passphrase.`);
      await this.vault.write(passKey(owner), change.passphrase);
    }
    if (change.destination?.kind === "folder") {
      // Backing up into the workspace itself would copy each backup into the next one.
      if (insideFolder(this.account(owner), change.destination.path) || change.destination.path.toLowerCase() === this.account(owner).toLowerCase()) throw Error("Pick a folder outside Clem's own workspace folder.");
      await mkdir(change.destination.path, { recursive: true });
    }
    return this.save(owner, {
      ...(change.destination !== undefined ? { destination: change.destination ?? undefined } : {}),
      ...(change.schedule ? { schedule: change.schedule } : {}),
      ...(change.keep ? { keep: Math.min(60, Math.max(1, Math.round(change.keep))) } : {}),
    });
  }
  /** Lets backups be read from a folder the person just picked. */
  allowFolder(path: string) { this.picked.add(path.toLowerCase()); }

  /** One backup or restore at a time per person. */
  private once<T>(owner: string, task: () => Promise<T>): Promise<T> {
    if (this.running.has(owner)) throw Error("A backup or restore is already running.");
    const run = task().finally(() => this.running.delete(owner));
    this.running.set(owner, run);
    return run;
  }

  /** Writes a backup of the person's whole workspace to `folder`. */
  private async write(owner: string, folder: string, kind: BackupKind, passphrase: string) {
    const account = this.account(owner);
    const workspace = JSON.parse(await readFile(join(account, "workspace.json"), "utf8").catch(() => "null"));
    if (!workspace) throw Error("There's nothing to back up yet.");
    const edits = await this.edits.read(owner);
    const entries = await workspaceEntries(account, { owner, entries: edits });
    await mkdir(folder, { recursive: true });
    const at = Date.now();
    let target = join(folder, backupName(at, kind));
    for (let n = 2; await stat(target).then(() => true, () => false); n++) target = join(folder, backupName(at, kind).replace(BACKUP_EXTENSION, ` (${n})${BACKUP_EXTENSION}`));
    return writeBackup(target, passphrase, entries, { createdAt: at, app: this.app, kind, ...countWorkspace(workspace), edits: edits.length });
  }

  /** Backs up now (or on schedule) to the chosen destination, then removes the oldest past the number kept. */
  backupNow(owner: string, kind: "manual" | "scheduled" = "manual") {
    return this.once(owner, async () => {
      const settings = await this.settings(owner), passphrase = await this.passphrase(owner);
      const tried = Date.now();
      try {
        if (!settings.destination) throw Error("Choose where backups go first.");
        if (!passphrase) throw Error("Set a backup passphrase first.");
        let result: Awaited<ReturnType<BackupService["write"]>>, where: string;
        if (settings.destination.kind === "folder") {
          result = await this.write(owner, settings.destination.path, kind, passphrase);
          where = settings.destination.path;
          const old = expired((await folderBackups(settings.destination.path)).map((b) => ({ ...b })), settings.keep);
          for (const b of old) await unlink(b.path).catch(() => {});
        } else {
          const folder = join(this.temp, "upload-" + randomBytes(4).toString("hex"));
          try {
            result = await this.write(owner, folder, kind, passphrase);
            const driveFolder = await this.drive.backupFolder();
            await this.drive.uploadFile(driveFolder, basename(result.path), result.path);
            where = "Google Drive › Clem backups";
            const listed = await this.drive.backupFiles(driveFolder);
            for (const b of expired(listed.map((f) => ({ ...f, at: nameDate(f.name) || f.at })), settings.keep)) await this.drive.trash(b.id).catch(() => {});
          } finally { await rm(folder, { recursive: true, force: true }).catch(() => {}); }
        }
        await this.save(owner, { last: { at: tried, tried, size: result.size, where } });
        return { ok: true, at: tried, size: result.size, where, name: basename(result.path), ...(settings.destination.kind === "folder" ? { path: result.path } : {}), summary: result.summary };
      } catch (error) {
        const message = (error as Error).message || "The backup didn't finish.";
        await this.save(owner, { last: { ...settings.last, tried, error: message } });
        throw Error(message);
      }
    });
  }
  /** Runs a scheduled backup when one is due (called every few minutes while Clem runs, in the window or the tray). */
  async tick(owner: string) {
    if (this.running.has(owner) || this.restoring) return;
    const settings = await this.settings(owner);
    if (!settings.destination || !(await this.passphrase(owner)) || !backupDue(settings.schedule, settings.last)) return;
    await this.backupNow(owner, "scheduled").catch((error) => console.warn("[backup] scheduled backup failed:", (error as Error).message));
  }

  /** Backups to restore from: the destination (or a folder just picked, or Drive), plus copies made before a restore. */
  async list(owner: string, from?: { kind: "folder"; path: string } | { kind: "drive" }): Promise<BackupItem[]> {
    const source = from || (await this.settings(owner)).destination;
    const items: BackupItem[] = [];
    if (source?.kind === "folder") {
      await this.readable(source.path, owner);
      items.push(...(await folderBackups(source.path)).map((b) => ({ source: "folder" as const, ...b })));
    } else if (source?.kind === "drive") {
      const folder = await this.drive.backupFolder();
      items.push(...(await this.drive.backupFiles(folder)).filter((f) => isBackupName(f.name)).map((f) => ({ source: "drive" as const, id: f.id, name: f.name, size: f.size, at: nameDate(f.name) || f.at })));
    }
    if (!(source?.kind === "folder" && source.path.toLowerCase() === this.safety.toLowerCase()))
      items.push(...(await folderBackups(this.safety)).map((b) => ({ source: "folder" as const, ...b })));
    return items.sort((a, b) => b.at - a.at);
  }
  /** Only folders the person chose (the destination, one picked to restore from, Clem's own safety copies) are read. */
  private async readable(path: string, owner: string) {
    const dest = (await this.settings(owner)).destination;
    if (path.toLowerCase() === this.safety.toLowerCase() || this.picked.has(path.toLowerCase()) || (dest?.kind === "folder" && dest.path.toLowerCase() === path.toLowerCase())) return;
    throw Error("Pick that folder first.");
  }
  /** The backup as a file on this PC (a Drive one is downloaded first, and kept until Clem quits). */
  private async local(owner: string, item: { source: "folder"; path: string } | { source: "drive"; id: string }) {
    if (item.source === "folder") {
      if (!isBackupName(basename(item.path))) throw Error("That isn't a Clem backup.");
      await this.readable(dirname(item.path), owner);
      return item.path;
    }
    if (!/^[\w-]{10,150}$/.test(item.id)) throw Error("That isn't a Clem backup.");
    const path = join(this.temp, "drive-" + item.id + BACKUP_EXTENSION);
    if (!(await stat(path).then((s) => s.size > 0, () => false))) {
      await mkdir(this.temp, { recursive: true });
      const part = path + "." + randomBytes(4).toString("hex") + ".part";
      try { await this.drive.downloadFile(item.id, part); await rename(part, path); }
      catch (error) { await unlink(part).catch(() => {}); throw error; }
    }
    return path;
  }
  /** What a backup holds, and what is in the workspace now (so the person sees what a restore replaces). */
  async preview(owner: string, item: { source: "folder"; path: string } | { source: "drive"; id: string }, passphrase?: string) {
    const path = await this.local(owner, item);
    const { summary } = await previewBackup(path, passphrase || (await this.passphrase(owner)));
    return { summary, current: await this.current(owner) };
  }
  private async current(owner: string) {
    const workspace = JSON.parse(await readFile(join(this.account(owner), "workspace.json"), "utf8").catch(() => "null"));
    return { ...countWorkspace(workspace), empty: isEmptyWorkspace(workspace) };
  }

  /**
   * Restores a backup in place of the workspace. A workspace with anything in it is only replaced once the person has
   * confirmed (`confirmed`), and after a copy of it was saved to Documents\Clem\Backups. The window reloads afterwards.
   */
  restore(owner: string, item: { source: "folder"; path: string } | { source: "drive"; id: string }, passphrase: string | undefined, confirmed: boolean) {
    return this.once(owner, async () => {
      const saved = await this.passphrase(owner), key = passphrase || saved;
      const path = await this.local(owner, item);
      const { summary } = await previewBackup(path, key);
      const current = await this.current(owner);
      if (!current.empty && !confirmed) return { confirm: true as const, summary, current };
      const accounts = join(this.root, "Accounts");
      await mkdir(accounts, { recursive: true });
      const staging = join(accounts, ".restore-" + randomBytes(6).toString("hex"));
      let swapped = false;
      try {
        await extractBackup(path, key, staging);
        let edits: [string, unknown][] = [], from = owner;
        try { const raw = JSON.parse(await readFile(join(staging, "indexeddb.json"), "utf8")); if (Array.isArray(raw?.entries)) edits = raw.entries; if (typeof raw?.owner === "string") from = raw.owner; } catch { /* a backup without edits */ }
        // What is here now is kept before anything is replaced.
        let safety: string | undefined;
        if (!current.empty) safety = (await this.write(owner, this.safety, "before-restore", saved || key)).path;
        for (const b of expired((await folderBackups(this.safety)), 3)) if (b.path !== safety) await unlink(b.path).catch(() => {});
        this.restoring = true;
        await swapInto(this.account(owner), staging);
        swapped = true;
        // Workflow checkpoints are kept per account: a backup from another account's workspace is restored as this one's.
        await this.edits.write(owner, edits.filter(([k]) => typeof k === "string").map(([k, v]) => [k.startsWith(`clem-workflow:${from}:`) ? `clem-workflow:${owner}:` + k.slice(`clem-workflow:${from}:`.length) : k, v])).catch((error) => console.warn("[backup] document edits not restored:", (error as Error).message));
        if (!saved) await this.vault.write(passKey(owner), key);
        if (!(await this.settings(owner)).destination && item.source === "folder" && dirname(item.path).toLowerCase() !== this.safety.toLowerCase())
          await this.save(owner, { destination: { kind: "folder", path: dirname(item.path) } });
        this.reload();
        return { restored: true as const, summary, safety };
      } catch (error) {
        if (!swapped) this.restoring = false;
        throw error;
      } finally {
        await rm(staging, { recursive: true, force: true }).catch(() => {});
      }
    });
  }
  /** The window has loaded the restored workspace: saving is allowed again. */
  reloaded() { this.restoring = false; }
}
export type { BackupSummary };
