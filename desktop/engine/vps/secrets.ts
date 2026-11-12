// The worker's secret store: one AES-256-GCM file per secret under a 32-byte key given at install (never logged), bound
// to its name. The desktop seals the same way before sending a secret over SSH, so it is encrypted in transit (SSH) and
// at rest (this). See docs/GUC-VPS-ENGINE.md "What goes to the VPS".
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const nameOk = (name: string) => { if (!/^[\w.-]{1,120}$/.test(name)) throw Error("Invalid secret name"); return name; };

/** iv(12) | tag(16) | ciphertext, with the name as additional data. */
export function seal(key: Uint8Array, name: string, value: unknown): Buffer {
  if (key.length !== 32) throw Error("The worker key must be 32 bytes.");
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(name));
  const body = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}
export function unseal<T>(key: Uint8Array, name: string, sealed: Uint8Array): T {
  const b = Buffer.from(sealed), d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAAD(Buffer.from(name));
  d.setAuthTag(b.subarray(12, 28));
  try { return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8")); }
  catch { throw Error("A secret could not be opened (wrong key or changed file)."); }
}
export const secretFile = (name: string) => createHash("sha256").update(nameOk(name)).digest("hex").slice(0, 32) + ".enc";

export class FileSecrets {
  private dir: string; private key: Uint8Array;
  constructor(dir: string, key: Uint8Array) { this.dir = dir; this.key = key; }
  async get<T>(name: string): Promise<T | undefined> {
    const b = await readFile(join(this.dir, secretFile(name))).catch((e) => { if (e.code === "ENOENT") return undefined; throw e; });
    return b ? unseal<T>(this.key, name, b) : undefined;
  }
  async set(name: string, value: unknown) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const path = join(this.dir, secretFile(name)), tmp = path + "." + randomBytes(6).toString("hex");
    await writeFile(tmp, seal(this.key, name, value), { mode: 0o600 });
    await rename(tmp, path);
  }
  async delete(name: string) { await rm(join(this.dir, secretFile(name)), { force: true }); }
}
