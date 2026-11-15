// The server itself as a VpsLink, for the worker's own vps.* tools (desktop/engine/vps/tools.ts): the same checks and
// output caps as over SSH, run here. Paths that aren't absolute are under the home folder, as over SFTP.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ExecResult, VpsLink } from "./link.ts";

const at = (p: string) => (isAbsolute(p) ? p : join(homedir(), p));
export class LocalLink implements VpsLink {
  exec(cmd: string, o: { timeout?: number; cap?: number; stdin?: string | Uint8Array } = {}): Promise<ExecResult> {
    const cap = o.cap ?? 1_000_000;
    return new Promise((resolve, reject) => {
      const p = spawn("sh", ["-c", cmd], { cwd: homedir(), stdio: ["pipe", "pipe", "pipe"] });
      let out = "", err = "", truncated = false;
      const add = (s: string, b: Buffer) => { if (s.length >= cap) { truncated = true; return s; } return s + b.toString("utf8"); };
      const timer = setTimeout(() => { p.kill(); reject(Error("The command took too long and was stopped.")); }, o.timeout ?? 60_000);
      p.stdout.on("data", (b: Buffer) => { out = add(out, b); }); p.stderr.on("data", (b: Buffer) => { err = add(err, b); });
      p.on("error", (e) => { clearTimeout(timer); reject(e); });
      p.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout: out.slice(0, cap), stderr: err.slice(0, cap), truncated }); });
      p.stdin.end(o.stdin ?? "");
    });
  }
  async get(path: string) { return new Uint8Array(await readFile(at(path))); }
  async put(path: string, bytes: Uint8Array, mode?: number) { await writeFile(at(path), bytes, mode ? { mode } : undefined); }
  async size(path: string) { return stat(at(path)).then((s) => s.size, () => null); }
  async mkdir(path: string) { await mkdir(at(path), { recursive: true }); }
  async rename(from: string, to: string) { await rename(at(from), at(to)); }
  async remove(path: string) { await rm(at(path), { force: true, recursive: true }); }
  async hash(path: string) { return createHash("sha256").update(await this.get(path)).digest("hex"); }
  async tunnel(): Promise<{ port: number; close(): void }> { throw Error("No tunnel on the server itself."); }
  async close() {}
}
