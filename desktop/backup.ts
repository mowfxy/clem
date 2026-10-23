import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, type ScryptOptions } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, unlink, type FileHandle } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { Readable, Transform, Writable, type TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

/**
 * A whole-workspace backup in one file (.clembackup), safe to leave in a cloud folder:
 *
 *   "CLEMBAK1" · u32 header length · header JSON · chunks…
 *
 * The header says when it was made and how the key comes from the passphrase (scrypt), and carries the summary
 * (what is inside) encrypted on its own, so a backup can be previewed without reading the rest. The body is the
 * entries (the account's folder in Documents\Clem and the document edits kept in IndexedDB), gzipped and encrypted
 * with AES-256-GCM in chunks of 1 MB. Each chunk is authenticated with its number and whether it is the last, so a
 * chunk that is changed, moved, dropped or cut short is refused before anything is restored.
 */
export const BACKUP_EXTENSION = ".clembackup";
const MAGIC = Buffer.from("CLEMBAK1");
const CHUNK = 1 << 20;
const KDF = { N: 1 << 15, r: 8, p: 1 } as const;
/** Entries a backup may hold, and how long a name inside it may be. */
const MAX_ENTRIES = 500_000;
const MAX_NAME = 400;

export type BackupKind = "scheduled" | "manual" | "before-restore";
/** What a backup holds, shown before restoring it. */
export type BackupSummary = {
  createdAt: number;
  app: string;
  kind: BackupKind;
  chats: number;
  subjects: number;
  projects: number;
  files: number;
  folders: number;
  studySets: number;
  cards: number;
  /** Cards with review history (FSRS state). */
  reviewed: number;
  automations: number;
  edits: number;
  bytes: number;
};
type Header = { format: "clem-backup"; version: 1; createdAt: number; app: string; kind: BackupKind; kdf: { name: "scrypt"; salt: string; N: number; r: number; p: number }; nonce: string; summary: string };
/** A file to put in a backup: its name inside, and where it is read from (or its bytes). */
export type BackupEntry = { name: string; path?: string; data?: Uint8Array; size: number };

const scrypt = (password: string, salt: Buffer, options: ScryptOptions) =>
  new Promise<Buffer>((done, fail) => scryptCallback(password.normalize("NFC"), salt, 32, options, (error, key) => (error ? fail(error) : done(key))));
const deriveKey = (passphrase: string, kdf: Header["kdf"]) => scrypt(passphrase, Buffer.from(kdf.salt, "base64"), { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * kdf.N * kdf.r * 2 });
/** Chunk n's nonce: the backup's 7 random bytes, then whether it is the last chunk (1) or the summary (2), then n. */
const nonceFor = (prefix: Buffer, flag: number, counter: number) => { const nonce = Buffer.alloc(12); prefix.copy(nonce, 0, 0, 7); nonce[7] = flag; nonce.writeUInt32BE(counter, 8); return nonce; };
function seal(key: Buffer, nonce: Buffer, aad: Buffer, plain: Buffer) {
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}
function unseal(key: Buffer, nonce: Buffer, aad: Buffer, sealed: Buffer) {
  if (sealed.length < 16) throw wrongKey();
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  try { return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]); }
  catch { throw wrongKey(); }
}
const wrongKey = () => Object.assign(Error("That passphrase doesn't open this backup, or the file is damaged."), { code: "passphrase" });
const damaged = (why = "") => Object.assign(Error("This backup file is damaged or incomplete" + (why ? ` (${why})` : "") + "."), { code: "damaged" });

/** Encrypts a stream in authenticated chunks; the last one (possibly empty) is marked as last. */
class Encrypt extends Transform {
  private buffered: Buffer[] = [];
  private length = 0;
  private counter = 0;
  private key: Buffer;
  private prefix: Buffer;
  private aad: Buffer;
  constructor(key: Buffer, prefix: Buffer, aad: Buffer) { super(); this.key = key; this.prefix = prefix; this.aad = aad; }
  private emit_(plain: Buffer, last: boolean) {
    if (this.counter >= 0xffffffff) throw Error("This workspace is too large for one backup.");
    const sealed = seal(this.key, nonceFor(this.prefix, last ? 1 : 0, this.counter++), this.aad, plain);
    const frame = Buffer.alloc(5);
    frame[0] = last ? 1 : 0;
    frame.writeUInt32BE(sealed.length, 1);
    this.push(Buffer.concat([frame, sealed]));
  }
  _transform(chunk: Buffer, _: BufferEncoding, done: TransformCallback) {
    this.buffered.push(chunk);
    this.length += chunk.length;
    // One chunk's worth is held back, so the last chunk is always known to be the last.
    while (this.length > CHUNK) {
      const all = Buffer.concat(this.buffered);
      this.emit_(all.subarray(0, CHUNK), false);
      this.buffered = [all.subarray(CHUNK)];
      this.length = all.length - CHUNK;
    }
    done();
  }
  _flush(done: TransformCallback) {
    try { this.emit_(Buffer.concat(this.buffered), true); done(); } catch (error) { done(error as Error); }
  }
}
/** The reverse: refuses a chunk that does not open, anything after the last chunk, and a stream that ends before it. */
class Decrypt extends Transform {
  private pending: Buffer = Buffer.alloc(0);
  private counter = 0;
  private ended = false;
  private key: Buffer;
  private prefix: Buffer;
  private aad: Buffer;
  constructor(key: Buffer, prefix: Buffer, aad: Buffer) { super(); this.key = key; this.prefix = prefix; this.aad = aad; }
  _transform(chunk: Buffer, _: BufferEncoding, done: TransformCallback) {
    try {
      this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
      while (this.pending.length >= 5) {
        if (this.ended) throw damaged("data after the end");
        const last = this.pending[0], size = this.pending.readUInt32BE(1);
        if (last > 1 || size > CHUNK + 16) throw damaged("bad chunk");
        if (this.pending.length < 5 + size) break;
        this.push(unseal(this.key, nonceFor(this.prefix, last, this.counter++), this.aad, this.pending.subarray(5, 5 + size)));
        this.pending = this.pending.subarray(5 + size);
        if (last) this.ended = true;
      }
      done();
    } catch (error) { done(error as Error); }
  }
  _flush(done: TransformCallback) { done(this.ended && !this.pending.length ? undefined : damaged("cut short")); }
}

/** The entries as one stream: u16 name length · name · u64 size · bytes, ended by a zero name length. */
async function* entryStream(entries: BackupEntry[]) {
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const head = Buffer.alloc(2 + name.length + 8);
    head.writeUInt16BE(name.length, 0);
    name.copy(head, 2);
    head.writeBigUInt64BE(BigInt(entry.size), 2 + name.length);
    yield head;
    if (entry.data) { yield Buffer.from(entry.data); continue; }
    if (!entry.size) continue;
    let read = 0;
    for await (const chunk of createReadStream(entry.path!, { start: 0, end: entry.size - 1 })) { read += (chunk as Buffer).length; yield chunk as Buffer; }
    // A file that shrank while it was read would leave the stream out of step.
    if (read !== entry.size) throw Error(`${entry.name} changed while it was backed up. Try again.`);
  }
  yield Buffer.alloc(2);
}
/** Entry names are always relative, with plain segments: nothing can be written outside the folder restored into. */
export function safeEntryName(name: string) {
  if (!name || name.length > MAX_NAME || name.includes("\\") || name.includes("\0")) return false;
  return name.split("/").every((part) => part && part !== "." && part !== ".." && !/[<>:"|?*\x00-\x1f]/.test(part) && !/[. ]$/.test(part));
}
/** Writes each entry under `folder` as it arrives. */
class EntryWriter extends Writable {
  private pending: Buffer = Buffer.alloc(0);
  private current: { handle: FileHandle; left: number } | null = null;
  private count = 0;
  finished = false;
  private folder: string;
  private names: string[];
  constructor(folder: string, names: string[]) { super(); this.folder = folder; this.names = names; }
  async _write(chunk: Buffer, _: BufferEncoding, done: (error?: Error | null) => void) {
    try {
      this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
      for (;;) {
        if (this.current) {
          const take = Math.min(this.current.left, this.pending.length);
          if (take) { await this.current.handle.write(this.pending.subarray(0, take)); this.pending = this.pending.subarray(take); this.current.left -= take; }
          if (this.current.left) break;
          await this.current.handle.close();
          this.current = null;
        }
        if (this.finished) { if (this.pending.length) throw damaged("data after the end"); break; }
        if (this.pending.length < 2) break;
        const length = this.pending.readUInt16BE(0);
        if (!length) { this.finished = true; this.pending = this.pending.subarray(2); continue; }
        if (this.pending.length < 2 + length + 8) break;
        const name = this.pending.subarray(2, 2 + length).toString("utf8");
        const size = Number(this.pending.readBigUInt64BE(2 + length));
        if (!safeEntryName(name) || ++this.count > MAX_ENTRIES || !Number.isSafeInteger(size)) throw damaged("bad entry");
        this.pending = this.pending.subarray(2 + length + 8);
        const path = join(this.folder, ...name.split("/"));
        await mkdir(dirname(path), { recursive: true });
        this.current = { handle: await open(path, "wx"), left: size };
        this.names.push(name);
      }
      done();
    } catch (error) { done(error as Error); }
  }
  async _final(done: (error?: Error | null) => void) {
    await this.current?.handle.close().catch(() => {});
    done(this.finished && !this.current ? undefined : damaged("cut short"));
  }
  async _destroy(error: Error | null, done: (error?: Error | null) => void) { await this.current?.handle.close().catch(() => {}); done(error); }
}

/** Writes a backup of `entries` to `target` (through a temporary file, so a half-written backup never has its name). */
export async function writeBackup(target: string, passphrase: string, entries: BackupEntry[], summary: Omit<BackupSummary, "bytes">) {
  const kdf = { name: "scrypt" as const, salt: randomBytes(16).toString("base64"), ...KDF };
  const key = await deriveKey(passphrase, kdf), prefix = randomBytes(7);
  const full: BackupSummary = { ...summary, bytes: entries.reduce((n, e) => n + e.size, 0) };
  const sealedSummary = seal(key, nonceFor(prefix, 2, 0), MAGIC, Buffer.from(JSON.stringify(full)));
  const header: Header = { format: "clem-backup", version: 1, createdAt: summary.createdAt, app: summary.app, kind: summary.kind, kdf, nonce: prefix.toString("base64"), summary: sealedSummary.toString("base64") };
  const headerBytes = Buffer.from(JSON.stringify(header));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(headerBytes.length);
  const tmp = target + "." + randomBytes(6).toString("hex") + ".tmp";
  try {
    await pipeline(
      Readable.from((async function* () { yield Buffer.concat([MAGIC, length, headerBytes]); })()),
      createWriteStream(tmp),
    );
    await pipeline(Readable.from(entryStream(entries)), createGzip({ level: 4 }), new Encrypt(key, prefix, headerBytes), createWriteStream(tmp, { flags: "a" }));
    await rename(tmp, target);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
  return { path: target, size: (await stat(target)).size, summary: full };
}

/** The header of a backup file, read without the passphrase. */
export async function readHeader(path: string): Promise<{ header: Header; bytes: Buffer; offset: number }> {
  const handle = await open(path, "r");
  try {
    const start = Buffer.alloc(12);
    const { bytesRead } = await handle.read(start, 0, 12, 0);
    if (bytesRead < 12 || !start.subarray(0, 8).equals(MAGIC)) throw Object.assign(Error("This isn't a Clem backup."), { code: "format" });
    const length = start.readUInt32BE(8);
    if (length > 64_000) throw damaged("header");
    const bytes = Buffer.alloc(length);
    if ((await handle.read(bytes, 0, length, 12)).bytesRead < length) throw damaged("header");
    let header: Header;
    try { header = JSON.parse(bytes.toString("utf8")); } catch { throw damaged("header"); }
    if (header?.format !== "clem-backup") throw Object.assign(Error("This isn't a Clem backup."), { code: "format" });
    if (header.version !== 1) throw Error("This backup was made by a newer Clem. Update Clem, then restore it.");
    if (header.kdf?.name !== "scrypt" || header.kdf.N > 1 << 20 || header.kdf.r > 32 || header.kdf.p > 16) throw damaged("header");
    return { header, bytes, offset: 12 + length };
  } finally { await handle.close(); }
}
/** What a backup holds; needs its passphrase. */
export async function previewBackup(path: string, passphrase: string) {
  const { header } = await readHeader(path);
  const key = await deriveKey(passphrase, header.kdf);
  const summary = JSON.parse(unseal(key, nonceFor(Buffer.from(header.nonce, "base64"), 2, 0), MAGIC, Buffer.from(header.summary, "base64")).toString("utf8")) as BackupSummary;
  return { summary, key };
}
/** Opens a whole backup into `folder` (which must not exist yet) and returns the names it held. Nothing is written
 *  outside `folder`, and a wrong passphrase or a damaged file stops it with an error. */
export async function extractBackup(path: string, passphrase: string, folder: string) {
  const { header, bytes, offset } = await readHeader(path);
  const { summary, key } = await previewBackup(path, passphrase);
  await mkdir(folder, { recursive: false });
  const names: string[] = [];
  const writer = new EntryWriter(folder, names);
  await pipeline(createReadStream(path, { start: offset }), new Decrypt(key, Buffer.from(header.nonce, "base64"), bytes), createGunzip(), writer);
  return { summary, names };
}

/** Every file inside `folder`, with names relative to it (forward slashes); temporary files are left out. */
export async function listFiles(folder: string, prefix: string): Promise<BackupEntry[]> {
  const out: BackupEntry[] = [];
  async function walk(dir: string, rel: string) {
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
    for (const item of items) {
      const name = rel ? rel + "/" + item.name : item.name;
      if (item.isDirectory()) await walk(join(dir, item.name), name);
      else if (item.isFile() && !item.name.endsWith(".tmp") && safeEntryName(prefix + name)) out.push({ name: prefix + name, path: join(dir, item.name), size: (await stat(join(dir, item.name))).size });
    }
  }
  await walk(folder, "");
  return out;
}

type Workspace = { chats?: unknown[]; spaces?: { kind?: string; folders?: unknown[] }[]; files?: unknown[]; studySets?: { kind?: string; items?: unknown[]; cards?: ({ reps?: number } | null)[] }[]; automations?: unknown[] };
/** The counts shown for a workspace (workspace.json). */
export function countWorkspace(value: unknown) {
  const w = (value && typeof value === "object" ? value : {}) as Workspace;
  const list = <T,>(x: T[] | undefined) => (Array.isArray(x) ? x : []);
  const sets = list(w.studySets);
  return {
    chats: list(w.chats).length,
    subjects: list(w.spaces).filter((s) => s?.kind === "subject").length,
    projects: list(w.spaces).filter((s) => s?.kind !== "subject").length,
    files: list(w.files).length,
    folders: list(w.spaces).reduce((n, s) => n + list(s?.folders).length, 0),
    studySets: sets.length,
    cards: sets.filter((s) => s?.kind === "flashcards").reduce((n, s) => n + list(s.items).length, 0),
    reviewed: sets.reduce((n, s) => n + list(s?.cards).filter((c) => c && (c.reps || 0) > 0).length, 0),
    automations: list(w.automations).length,
  };
}
/** Whether a workspace has anything in it worth keeping. */
export const isEmptyWorkspace = (value: unknown) => { const c = countWorkspace(value); return !c.chats && !c.subjects && !c.projects && !c.files && !c.studySets && !c.automations; };

/** The account folder in Documents\Clem and the document edits, as backup entries. */
export async function workspaceEntries(accountFolder: string, edits: Record<string, unknown>) {
  const entries = await listFiles(accountFolder, "account/");
  const json = Buffer.from(JSON.stringify(edits));
  entries.push({ name: "indexeddb.json", data: json, size: json.length });
  return entries;
}

/**
 * Puts a workspace opened from a backup (`staging/account`) in place of `accountFolder`. The folder being replaced is
 * moved aside first and moved back if anything fails, then removed (a copy of it was backed up before this).
 */
export async function swapInto(accountFolder: string, staging: string) {
  const restored = join(staging, "account");
  const workspace = JSON.parse(await readFile(join(restored, "workspace.json"), "utf8"));
  for (const key of ["chats", "spaces", "files", "skills", "visuals", "automations"]) if (!Array.isArray(workspace?.[key])) throw damaged("workspace");
  const aside = accountFolder + ".replaced-" + Date.now();
  let moved = false;
  try { await rename(accountFolder, aside); moved = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw Error("Clem couldn't move the current workspace aside. Close any app using files in Documents\\Clem and try again."); }
  try { await rename(restored, accountFolder); }
  catch (error) { if (moved) await rename(aside, accountFolder).catch(() => {}); throw error; }
  if (moved) await rm(aside, { recursive: true, force: true }).catch(() => {});
  await rm(staging, { recursive: true, force: true }).catch(() => {});
}

/** A backup's file name: when it was made, in local time ("Clem backup 2026-10-23 0930.clembackup"). */
export function backupName(at: number, kind: BackupKind) {
  const d = new Date(at), pad = (n: number) => String(n).padStart(2, "0");
  return `Clem ${kind === "before-restore" ? "before restore" : "backup"} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}${BACKUP_EXTENSION}`;
}
export const isBackupName = (name: string) => /^Clem (backup|before restore) \d{4}-\d\d-\d\d \d{4}( \(\d+\))?\.clembackup$/.test(name);
/** Which of a destination's backups to remove so only the newest `keep` remain. Copies made before a restore are
 *  kept apart: the newest three of those stay. */
export function expired<T extends { name: string; at: number }>(items: T[], keep: number) {
  const regular = items.filter((i) => isBackupName(i.name) && i.name.startsWith("Clem backup ")).sort((a, b) => b.at - a.at);
  const before = items.filter((i) => i.name.startsWith("Clem before restore ")).sort((a, b) => b.at - a.at);
  return [...regular.slice(Math.max(1, keep)), ...before.slice(3)];
}

/** Backups made in a folder on this PC, newest first, with when each was made (from its header). */
export async function folderBackups(folder: string) {
  const names = await readdir(folder).catch(() => [] as string[]);
  const found = await Promise.all(names.filter(isBackupName).map(async (name) => {
    const path = join(folder, name);
    try { const [{ header }, info] = await Promise.all([readHeader(path), stat(path)]); return { name, path, at: header.createdAt, kind: header.kind, size: info.size }; }
    catch { return null; }
  }));
  return found.filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.at - a.at);
}

export type BackupSchedule = "off" | "daily" | "weekly";
/** Whether a scheduled backup is due: a day or a week after the last one that worked (an hour early is fine, so a PC
 *  opened at the same time each day still backs up daily), and an hour after a failed try. */
export function backupDue(schedule: BackupSchedule, last: { at?: number; tried?: number } | undefined, now = Date.now()) {
  if (schedule === "off") return false;
  const every = (schedule === "daily" ? 1 : 7) * 86_400_000 - 3_600_000;
  if (last?.tried && now - last.tried < 3_600_000) return false;
  return !last?.at || now - last.at >= every;
}
export const insideFolder = (parent: string, child: string) => child.toLowerCase().startsWith(parent.toLowerCase().replace(/[\\/]+$/, "") + sep);
