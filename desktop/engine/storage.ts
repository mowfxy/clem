// Where saved CMS files' bytes live (docs/GUC-VPS-ENGINE.md → Checks and saved files). Bytes are stored once per
// content hash; a VPS store comes with the VPS step behind the same interface.
import { createHash } from "node:crypto";
import { copyFile, link, mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface FileStore {
  readonly location: "device" | "vps";
  /** Keeps `bytes` under their sha256 (written once: the same bytes are never stored twice); returns where. */
  put(sha256: string, ext: string, bytes: Uint8Array): Promise<string>;
  has(path: string): Promise<boolean>;
  /** The stored bytes at `path` (the AI's guc.read; a VPS store fetches them over its tunnel). */
  read(path: string): Promise<Uint8Array>;
  /** Shows a stored file in the workspace's Files under `fileId`, as the same bytes (a hard link, not a copy). */
  expose(fileId: string, path: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** This PC: Documents/Clem/Accounts/<owner>/Files/GUC/<sha256>.<ext>, beside the workspace's own Files/<id>.blob. */
export class DeviceStore implements FileStore {
  readonly location: "device" | "vps";
  private sub: string;
  private files: string;
  /** `vps`: the worker keeps files on the VPS's own disk the same way (~/clem/<owner>/files, the same names as VpsStore). */
  constructor(files: string, o: { location?: "device" | "vps"; sub?: string } = {}) { this.files = files; this.location = o.location || "device"; this.sub = o.sub ?? "GUC"; }
  private dir() { return this.sub ? join(this.files, this.sub) : this.files; }
  async put(hash: string, ext: string, bytes: Uint8Array) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("Invalid hash");
    const path = join(this.dir(), hash + (/^[a-z0-9]{1,5}$/.test(ext) ? "." + ext : ""));
    if (await this.has(path)) return path;
    await mkdir(this.dir(), { recursive: true });
    const tmp = path + "." + crypto.randomUUID() + ".tmp";
    await writeFile(tmp, bytes);
    await rename(tmp, path);
    return path;
  }
  has(path: string) { return stat(path).then((s) => s.isFile(), () => false); }
  async read(path: string) { return new Uint8Array(await readFile(path)); }
  async expose(fileId: string, path: string) {
    if (!/^[\w-]{1,100}$/.test(fileId)) throw Error("Invalid file");
    const target = join(this.files, fileId + ".blob");
    await unlink(target).catch(() => {});
    // A file system without hard links (FAT, some network drives) gets a copy: the only case two copies exist.
    await link(path, target).catch(() => copyFile(path, target));
  }
  async remove(path: string) { if (path.startsWith(this.dir())) await rm(path, { force: true }); }
}
