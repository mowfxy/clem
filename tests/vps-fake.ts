// A fake VPS for the tests: an in-memory file system behind the VpsLink interface (no SSH, no network).
import { createHash } from "node:crypto";
import type { ExecResult, VpsLink } from "../desktop/engine/vps/link.ts";
import type { LocalBlobs } from "../desktop/engine/vps/router.ts";

export class FakeVps implements VpsLink {
  files = new Map<string, Uint8Array>();
  commands: string[] = [];
  /** Puts left before the connection drops (undefined: never). */
  dropAfter?: number;
  offline = false;
  /** Paths whose upload arrives damaged (the server's sha256 won't match). */
  corrupt: (path: string) => boolean = () => false;
  private check() { if (this.offline) throw Error("connect ECONNRESET"); }
  async exec(cmd: string, o: { cap?: number } = {}): Promise<ExecResult> {
    this.check(); this.commands.push(cmd);
    const sha = cmd.match(/^sha256sum -- '(.+)'$/);
    if (sha) { const b = this.files.get(sha[1]); return b ? { code: 0, stdout: createHash("sha256").update(b).digest("hex") + "  " + sha[1] + "\n", stderr: "" } : { code: 1, stdout: "", stderr: "No such file" }; }
    const mv = cmd.match(/^mv -f -- '(.+)' '(.+)'$/);
    if (mv) { this.files.set(mv[2], this.files.get(mv[1])!); this.files.delete(mv[1]); return { code: 0, stdout: "", stderr: "" }; }
    const out = `ran: ${cmd}\n`.repeat(cmd.startsWith("cat big") ? 5000 : 1);
    return { code: 0, stdout: out.slice(0, o.cap ?? 1e9), stderr: "", truncated: out.length > (o.cap ?? 1e9) };
  }
  async get(path: string) { this.check(); const b = this.files.get(path); if (!b) throw Error("No such file: " + path); return new Uint8Array(b); }
  async put(path: string, bytes: Uint8Array) {
    this.check();
    if (this.dropAfter !== undefined && this.dropAfter-- <= 0) { this.offline = true; throw Error("connect ECONNRESET"); }
    const b = new Uint8Array(bytes);
    if (this.corrupt(path) && b.length) b[0] ^= 0xff;
    this.files.set(path, b);
  }
  async size(path: string) { this.check(); return this.files.get(path)?.length ?? null; }
  async mkdir() { this.check(); }
  async rename(from: string, to: string) { this.check(); this.files.set(to, this.files.get(from)!); this.files.delete(from); }
  async remove(path: string) { this.check(); this.files.delete(path); }
  async hash(path: string) { const r = await this.exec(`sha256sum -- '${path}'`); return r.stdout.slice(0, 64); }
  async tunnel() { return { port: 0, close() {} }; }
  async close() {}
}

/** This device's Files folder, in memory. */
export class FakeLocal implements LocalBlobs {
  files = new Map<string, Uint8Array>();
  async read(id: string) { const b = this.files.get(id); return b ? new Uint8Array(b) : null; }
  async write(id: string, bytes: Uint8Array) { this.files.set(id, new Uint8Array(bytes)); }
  async remove(id: string) { this.files.delete(id); }
  async has(id: string) { return this.files.has(id); }
  path(id: string) { return "/local/" + id + ".blob"; }
  async list() { return [...this.files].map(([id, b]) => ({ id, size: b.length })); }
}
export const bytesOf = (n: number, seed = 1) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed * 7) & 255; return b; };
