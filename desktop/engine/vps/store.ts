// Files on the person's VPS: content-addressed under ~/clem/<owner>/files/<sha256>.<ext>, checked on the way in (the
// server's own sha256sum of the uploaded copy must match before it takes its name) and on the way out.
import { randomBytes } from "node:crypto";
import { sha256, type FileStore } from "../storage.ts";
import type { VpsLink } from "./link.ts";

export class ChecksumError extends Error { constructor(m = "A file's checksum didn't match, so it wasn't used.") { super(m); } }
export const vpsRoot = (owner: string) => { if (!/^[\w-]{1,100}$/.test(owner)) throw Error("Invalid account"); return `clem/${owner}/files`; };

export class VpsStore implements FileStore {
  readonly location = "vps" as const;
  readonly root: string;
  private link: () => VpsLink;
  private onExpose?: (fileId: string, path: string) => Promise<void>;
  constructor(link: () => VpsLink, root: string, o: { onExpose?: (fileId: string, path: string) => Promise<void> } = {}) { this.link = link; this.root = root; this.onExpose = o.onExpose; }
  pathOf(hash: string, ext = "") {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("Invalid hash");
    return `${this.root}/${hash}${/^[a-z0-9]{1,5}$/.test(ext) ? "." + ext : ""}`;
  }
  /** The hash a path names (every stored file is named by its content). */
  static hashOf(path: string) { return path.split("/").pop()!.split(".")[0]; }
  async put(hash: string, ext: string, bytes: Uint8Array) {
    if (sha256(bytes) !== hash) throw new ChecksumError("The file changed while it was being sent.");
    const link = this.link(), path = this.pathOf(hash, ext);
    if (await link.size(path) === bytes.length && await link.hash(path) === hash) return path;
    await link.mkdir(this.root);
    const part = `${path}.part-${randomBytes(4).toString("hex")}`;
    await link.put(part, bytes);
    if (await link.hash(part).catch(() => "") !== hash) { await link.remove(part).catch(() => {}); throw new ChecksumError(); }
    await link.rename(part, path);
    return path;
  }
  async has(path: string) { return (await this.link().size(path)) !== null; }
  async read(path: string) {
    const bytes = await this.link().get(path);
    if (sha256(bytes) !== VpsStore.hashOf(path)) throw new ChecksumError();
    return bytes;
  }
  async expose(fileId: string, path: string) { await this.onExpose?.(fileId, path); }
  async remove(path: string) { if (path.startsWith(this.root + "/")) await this.link().remove(path); }
}
