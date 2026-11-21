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
  /** The connection is gone (the server closed it, the network dropped, the PC slept): make a new one. */
  readonly closed?: boolean;
  /** A command that keeps running, printing as it goes and reading what is typed (a CLI's sign-in). `pty`: give it a
   *  terminal, very wide so a long sign-in link is never wrapped. */
  interactive?(cmd: string, o?: { pty?: boolean }): Promise<LiveCommand>;
}
export type LiveCommand = { write(s: string): void; onData(f: (s: string) => void): void; done: Promise<number>; close(): void };
export type LinkConfig = { host: string; port: number; user: string; privateKey?: string; passphrase?: string; password?: string; fingerprint?: string };

/** Single-quoted for the remote shell. */
export const q = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
/** Every SSH and SFTP error as one plain sentence (never a stack trace or a library's wording). */
export const plain = (e: unknown) => {
  const m = String((e as Error)?.message || e);
  if (/The connection to your VPS|The server stopped answering|The server didn't|Couldn't find that server|The server refused/.test(m)) return m;
  if (/All configured authentication methods failed|authentication/i.test(m)) return "The server didn't accept the key. Add the public key to ~/.ssh/authorized_keys on the server, then try again.";
  if (/ENOTFOUND|EAI_AGAIN/.test(m)) return "Couldn't find that server. Check the address.";
  if (/ECONNREFUSED/.test(m)) return "The server refused the connection. Check the port (usually 22) and that SSH is running.";
  if (/ETIMEDOUT|Timed out|timeout/i.test(m)) return "The server didn't answer in time. Check the address, port and firewall.";
  if (/ECONNRESET|EPIPE|ECONNABORTED|No response from server|Not connected|socket hang up|end of file|Channel open failure|No SFTP connection|Connection lost|closed/i.test(m)) return DROPPED;
  return m.replace(/^connect: /, "").replace(/getConnection: /, "").replace(/^(get|put|stat|mkdir|rename|delete|_put|_get): /, "");
};
export const DROPPED = "The connection to your VPS dropped.";
/** A dropped connection (or a server that stopped answering), as opposed to a refusal: worth reconnecting and trying again. */
export const isDrop = (e: unknown) => /The connection to your VPS dropped|The server stopped answering|ECONNRESET|EPIPE|No response from server|Not connected|socket hang up/i.test(String((e as Error)?.message || e));
/** Fails with one plain sentence when an SFTP step hangs (a dead link never answers, and SFTP has no timeout of its own). */
export function timed<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Error(`The server stopped answering while ${what}.`)), ms);
    t.unref?.();
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(Error(plain(e))); });
  });
}
const STEP_MS = 30_000;
/** Time for a transfer: 30 s plus 20 KB/s, the slowest link Clem waits for. */
const transferMs = (bytes: number) => STEP_MS + Math.ceil(bytes / 20);

export class SshLink implements VpsLink {
  private sftp: SftpClient;
  readonly fingerprint: string;
  readonly firstTime: boolean;
  private gone = false;
  get closed() { return this.gone; }
  private constructor(sftp: SftpClient, fp: string, first: boolean) {
    this.sftp = sftp; this.fingerprint = fp; this.firstTime = first;
    // The library keeps a dead connection object: mark it, so the manager makes a new one instead of failing on it.
    const c = this.client as unknown as import("node:events").EventEmitter | undefined;
    for (const ev of ["close", "end", "error"]) c?.on?.(ev, () => { this.gone = true; });
  }

  /** Connects, verifying the host key against `fingerprint` (trust on first use). Errors are plain sentences. */
  static async connect(c: LinkConfig, timeout = 15_000): Promise<SshLink> {
    const sftp = new SftpClient("clem");
    let seen = "", refused = "", first = false;
    try {
      await sftp.connect({
        // A keep-alive every 15 s; three unanswered ones and the connection is called dropped (a sleeping PC, a lost network).
        host: c.host, port: c.port, username: c.user, readyTimeout: timeout, keepaliveInterval: 15_000, keepaliveCountMax: 3,
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
    if (this.gone) return Promise.reject(Error(DROPPED));
    return new Promise((resolve, reject) => {
      // The channel itself may never open on a dying connection.
      const opening = setTimeout(() => reject(Error("The server stopped answering while starting a command.")), STEP_MS);
      this.client.exec(cmd, (err, stream) => {
        clearTimeout(opening);
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
  interactive(cmd: string, o: { pty?: boolean } = {}): Promise<LiveCommand> {
    return new Promise((resolve, reject) => {
      const opts = o.pty ? { pty: { cols: 4000, rows: 40, term: "xterm" } } : {};
      this.client.exec(cmd, opts, (err, stream) => {
        if (err) return reject(Error(plain(err)));
        const listeners: ((s: string) => void)[] = [];
        const emit = (b: Buffer) => { const t = b.toString("utf8"); for (const f of listeners) f(t); };
        stream.on("data", emit); stream.stderr.on("data", emit);
        const done = new Promise<number>((res) => stream.on("close", (code: number | null) => res(code ?? -1)));
        resolve({ write: (t) => { stream.write(t); }, onData: (f) => { listeners.push(f); }, done, close: () => stream.close() });
      });
    });
  }
  async get(path: string) {
    const size = await this.size(path);
    return new Uint8Array(await timed(this.sftp.get(path) as Promise<Buffer>, transferMs(size || 0), "sending a file"));
  }
  async put(path: string, bytes: Uint8Array, mode?: number) { await timed(this.sftp.put(Buffer.from(bytes), path, mode ? { writeStreamOptions: { mode } } : undefined), transferMs(bytes.length), "receiving a file"); }
  async size(path: string) {
    if (this.gone) throw Error(DROPPED);
    try { return (await timed(this.sftp.stat(path), STEP_MS, "checking a file")).size; }
    catch (e) { if (isDrop(e) || this.gone) throw e; return null; }
  }
  async mkdir(path: string) { await timed((async () => { if (!(await this.sftp.exists(path))) await this.sftp.mkdir(path, true); })(), STEP_MS, "making a folder"); }
  async rename(from: string, to: string) { await timed(this.sftp.posixRename(from, to), STEP_MS, "naming a file"); }
  async remove(path: string) { await timed(this.sftp.delete(path, true), STEP_MS, "removing a file"); }
  async hash(path: string) {
    const r = await this.exec("sha256sum -- " + q(path), { timeout: 120_000 }).catch(() => null);
    const m = r?.code === 0 && r.stdout.match(/^([a-f0-9]{64})\b/);
    return m ? m[1] : createHash("sha256").update(await this.get(path)).digest("hex");
  }
  tunnel(remotePort: number) {
    return new Promise<{ port: number; close(): void }>((resolve, reject) => {
      const server = createServer((socket) => {
        socket.on("error", () => {});
        // On a dropped connection ssh2's forwardOut throws ("Not connected") instead of calling back. This runs in a
        // socket event, so an escaped throw crashed the whole app: refuse this one request; the manager reconnects.
        if (this.gone) { socket.destroy(); return; }
        try {
          this.client.forwardOut("127.0.0.1", 0, "127.0.0.1", remotePort, (err, stream) => {
            if (err) { socket.destroy(); return; }
            socket.pipe(stream).pipe(socket);
            socket.on("error", () => stream.close()); stream.on("error", () => socket.destroy());
          });
        } catch { this.gone = true; socket.destroy(); }
      });
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => resolve({ port: (server.address() as AddressInfo).port, close: () => server.close() }));
    });
  }
  async close() { this.gone = true; await this.sftp.end().catch(() => {}); }
}
