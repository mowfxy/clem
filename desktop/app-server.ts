import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export const WORN_BYTES = 64_000_000;
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void };
type Listener = { onMessage: (method: string, params: any) => void; onFail: (error: Error) => void };

/**
 * One long-lived `codex app-server` connection that many turns share.
 * Starting the CLI and completing the handshake costs far more than a turn's first token,
 * so the connection is kept warm and reused; each conversation still gets its own
 * ephemeral, read-only thread. Provider tool/approval requests are always refused,
 * except a confirmation before calling Mowr's own Kinetra MCP server.
 */
export class AppServer {
  private pending = new Map<number, Pending>();
  private threads = new Map<string, Listener>();
  private nextId = 1;
  private bytes = 0;
  private stderr = "";
  dead = false;
  lastUsed = Date.now();
  readonly ready: Promise<void>;
  private child: ChildProcessWithoutNullStreams;
  constructor(child: ChildProcessWithoutNullStreams, clientVersion = "0.2.0") {
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    child.stderr.on("data", (data) => { this.stderr = (this.stderr + String(data)).slice(-16000); });
    child.on("error", () => this.fail(Error("Codex could not start.")));
    child.on("close", () => this.fail(Error(this.stderr || "Codex connection closed.")));
    child.stdin.on("error", () => this.fail(Error("Codex connection closed.")));
    lines.on("line", (line) => this.receive(line));
    this.ready = this.request("initialize", { clientInfo: { name: "mowr", version: clientVersion } }).then(() => {
      this.write({ method: "initialized", params: {} });
    });
    this.ready.catch(() => {});
  }
  private write(message: unknown) {
    if (this.dead) return;
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  /** `timeoutMs`: the request is given up after that long (the connection stays open for everything else). */
  request<T = any>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    if (this.dead) return Promise.reject(Error("Codex connection closed."));
    this.lastUsed = Date.now();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs ? setTimeout(() => { this.pending.delete(id); reject(Error("Codex did not answer in time.")); }, timeoutMs) : undefined;
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.write({ id, method, params });
    });
  }
  /** Routes a thread's notifications; returns an unsubscribe function. */
  subscribe(threadId: string, listener: Listener) {
    this.threads.set(threadId, listener);
    return () => { if (this.threads.get(threadId) === listener) this.threads.delete(threadId); };
  }
  get idle() { return this.threads.size === 0 && this.pending.size === 0; }
  /** After a large volume the connection is replaced (Codex.retireWorn), between answers only: closing it here would
   *  end every answer streaming on it. Each turn keeps its own limit (codex-stream.ts). */
  get worn() { return this.bytes > WORN_BYTES; }
  /** Conversations currently streaming on this connection. */
  get activeThreads() { return this.threads.size; }
  private receive(line: string) {
    if (this.dead) return;
    this.bytes += line.length;
    let m: any;
    try { m = JSON.parse(line); } catch { return; }
    if (m.method && m.id !== undefined) {
      // Mowr's own Kinetra server (desktop/kinetra-mcp.ts) is the one MCP server a thread may have: a confirmation Codex
      // asks for before calling it is granted, as Mowr already decided to offer that tool. A link (url mode) never is.
      if (m.method === "mcpServer/elicitation/request" && m.params?.serverName === "kinetra" && m.params?.mode !== "url") {
        this.write({ id: m.id, result: { action: "accept", content: {} } });
        return;
      }
      // Never leave any other provider tool/approval request hanging, and never grant it.
      this.write({ id: m.id, error: { code: -32601, message: "Tools are not enabled in this conversation." } });
      const thread = m.params?.threadId;
      const listener = thread && this.threads.get(thread);
      if (listener) listener.onFail(Error("Codex requested an unsupported tool."));
      return;
    }
    if (m.id !== undefined && this.pending.has(m.id)) {
      const request = this.pending.get(m.id)!;
      this.pending.delete(m.id);
      if (m.error) request.reject(Error(String(m.error.message || "Codex rejected this request.")));
      else request.resolve(m.result);
      return;
    }
    if (m.method) {
      const thread = m.params?.threadId;
      if (thread && this.threads.has(thread)) this.threads.get(thread)!.onMessage(m.method, m.params);
    }
  }
  private fail(error: Error) {
    if (this.dead) return;
    this.dead = true;
    for (const request of this.pending.values()) request.reject(error);
    for (const listener of this.threads.values()) listener.onFail(error);
    this.pending.clear();
    this.threads.clear();
  }
  close() {
    this.fail(Error("Codex connection closed."));
    this.child.kill();
  }
}
