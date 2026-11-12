// One SSH connection to the person's VPS: commands, SFTP and a tunnel to the worker's localhost port. Everything else
// (VpsStore, the migration, the worker install, the AI's vps.* tools) talks to a `VpsLink`, so tests use a fake one.
import { createHash } from "node:crypto";
import { createServer, type AddressInfo } from "node:net";
import SftpClient from "ssh2-sftp-client";
import { checkHostKey, fingerprint } from "./keys.ts";

export type ExecResult = { code: number; stdout: string; stderr: string; truncated?: boolean };
export interface VpsLink {
  exec(cmd: string, o?: { timeout?: number; cap?: number; stdin?: string | Uint8Array }): Promise<ExecResult>;
  get(path: string): Promise<Uint8Array>;
  put(path: string, bytes: Uint8Array, mode?: number): Promise<void>;
  /** Size in bytes, or null when there is no such file. */
  size(path: string): Promise<number | null>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** sha256 (hex) of a file on the server: `sha256sum` there, else downloaded and hashed here. */
  hash(path: string): Promise<string>;
  /** A local port that reaches 127.0.0.1:`remotePort` on the server through this connection. */
  tunnel(remotePort: number): Promise<{ port: number; close(): void }>;
  close(): Promise<void>;
}
export type LinkConfig = { host: string; port: number; user: string; privateKey?: string; passphrase?: string; password?: string; fingerprint?: string };

/** Single-quoted for the remote shell. */
export const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
const plain = (e: unknown) => {
  const m = String((e as Error)?.message || e);
  if (/All configured authentication methods failed|authentication/i.test(m)) return "The server didn't accept the key. Add the public key to ~/.ssh/authorized_keys on the server, then try again.";
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return "Couldn't find that server. Check the address.";
  if (/ECONNREFUSED/.test(m)) return "The server refused the connection. Check the port (usually 22) and that SSH is running.";
  if (/ETIMEDOUT|Timed out|timeout/i.test(m)) return "The server didn't answer in time. Check the address, port and firewall.";
  return m.replace(/^connect: /, "").replace(/getConnection: /, "");
};

export class SshLink implements VpsLink {
  private sftp: SftpClient;
  readonly fingerprint: string;
  readonly firstTime: boolean;
  private constructor(sftp: SftpClient, fp: string, first: boolean) { this.sftp = sftp; this.fingerprint = fp; this.firstTime = first; }

  /** Connects, verifying the host key against `fingerprint` (trust on first use). Errors are plain sentences. */
  static async connect(c: LinkConfig, timeout = 15_000): Promise<SshLink> {
    const sftp = new SftpClient("clem");
    let seen = "", refused = "", first = false;
    try {
      await sftp.connect({
        host: c.host, port: c.port, username: c.user, readyTimeout: timeout, keepaliveInterval: 20_000,
        ...(c.privateKey ? { privateKey: c.privateKey, passphrase: c.passphrase } : {}), ...(c.password ? { password: c.password } : {}),
        // Only key auth unless a password was given on purpose (the advanced toggle).
        tryKeyboard: false,
        hostVerifier: (key: Buffer) => { seen = fingerprint(key); const v = checkHostKey(c.fingerprint, seen); if (!v.ok) refused = v.error; else first = v.first; return v.ok; },
      } as SftpClient.ConnectOptions);
    } catch (e) {
      await sftp.end().catch(() => {});
      throw Object.assign(Error(refused || plain(e)), { fingerprint: seen || undefined, hostKey: !!refused });
    }
    return new SshLink(sftp, seen, first);
  }
  private get client() { return (this.sftp as unknown as { client: import("ssh2").Client }).client; }

  exec(cmd: string, o: { timeout?: number; cap?: number; stdin?: string | Uint8Array } = {}): Promise<ExecResult> {
    const cap = o.cap ?? 1_000_000;
    return new Promise((resolve, reject) => {
      this.client.exec(cmd, (err, stream) => {
        if (err) return reject(Error(plain(err)));
        let out = "", errs = "", truncated = false;
        const timer = setTimeout(() => { stream.close(); reject(Error("The command took too long and was stopped.")); }, o.timeout ?? 60_000);
        const add = (s: string, b: Buffer) => { if (s.length >= cap) { truncated = true; return s; } return s + b.toString("utf8"); };
        stream.on("data", (b: Buffer) => { out = add(out, b); });
        stream.stderr.on("data", (b: Buffer) => { errs = add(errs, b); });
        stream.on("close", (code: number | null) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout: out.slice(0, cap), stderr: errs.slice(0, cap), truncated }); });
        if (o.stdin !== undefined) stream.end(o.stdin); else stream.end();
      });
    });
  }
  async get(path: string) { return new Uint8Array(await this.sftp.get(path) as Buffer); }
  async put(path: string, bytes: Uint8Array, mode?: number) { await this.sftp.put(Buffer.from(bytes), path, mode ? { writeStreamOptions: { mode } } : undefined); }
  async size(path: string) { try { return (await this.sftp.stat(path)).size; } catch { return null; } }
  async mkdir(path: string) { if (!(await this.sftp.exists(path))) await this.sftp.mkdir(path, true); }
  async rename(from: string, to: string) { await this.sftp.posixRename(from, to); }
  async remove(path: string) { await this.sftp.delete(path, true); }
  async hash(path: string) {
    const r = await this.exec("sha256sum -- " + q(path), { timeout: 120_000 }).catch(() => null);
    const m = r?.code === 0 && r.stdout.match(/^([a-f0-9]{64})\b/);
    return m ? m[1] : createHash("sha256").update(await this.get(path)).digest("hex");
  }
  tunnel(remotePort: number) {
    return new Promise<{ port: number; close(): void }>((resolve, reject) => {
      const server = createServer((socket) => {
        this.client.forwardOut("127.0.0.1", 0, "127.0.0.1", remotePort, (err, stream) => {
          if (err) { socket.destroy(); return; }
          socket.pipe(stream).pipe(socket);
          socket.on("error", () => stream.close()); stream.on("error", () => socket.destroy());
        });
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as AddressInfo).port, close: () => server.close() }));
    });
  }
  async close() { await this.sftp.end().catch(() => {}); }
}
