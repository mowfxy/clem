// vps.* actions (core/vps/tools.ts) over the person's SSH connection. Destructive commands and overwrites wait for a
// one-tap confirm card (vps_confirm); the pending action lives here for 15 minutes, keyed by an id only the card has.
import { randomUUID } from "node:crypto";
import { capOutput, classifyCommand } from "../../../core/vps/commands.ts";
import { q, type VpsLink } from "./link.ts";

type Pending = { owner: string; at: number } & ({ kind: "run"; command: string } | { kind: "write"; path: string; content: string });
const PENDING_MS = 15 * 60_000, MAX_FILE = 200_000;
export class VpsTools {
  private pending = new Map<string, Pending>();
  private link: (owner: string) => Promise<VpsLink>;
  constructor(link: (owner: string) => Promise<VpsLink>) { this.link = link; }
  private card(id: string, p: Pending, reason?: string) {
    const body = p.kind === "run" ? { type: "vps_confirm", id, action: "run", command: p.command.slice(0, 600), ...(reason ? { reason } : {}) } : { type: "vps_confirm", id, action: "write", path: p.path.slice(0, 300) };
    return "```clem-card\n" + JSON.stringify(body) + "\n```";
  }
  private hold(p: Pending, reason?: string) {
    for (const [k, v] of this.pending) if (Date.now() - v.at > PENDING_MS) this.pending.delete(k);
    const id = randomUUID().replace(/-/g, "").slice(0, 16);
    this.pending.set(id, p);
    return { needsConfirm: true, reason, card: "This needs the person's tap. Put this card in your reply and stop:\n" + this.card(id, p, reason) };
  }
  private async exec(owner: string, command: string) {
    const r = await (await this.link(owner)).exec(command, { timeout: 120_000, cap: 200_000 });
    const out = capOutput((r.stdout + (r.stderr ? "\n[stderr]\n" + r.stderr : "")).trim());
    return { exitCode: r.code, output: out.text, ...(out.truncated || r.truncated ? { truncated: true } : {}) };
  }

  async run(owner: string, tool: Record<string, unknown>) {
    const action = tool.action, path = typeof tool.path === "string" ? tool.path.trim() : "";
    if (action === "vps.run_command") {
      const command = typeof tool.command === "string" ? tool.command.trim() : "";
      if (!command || command.length > 4000) return { error: "Give the command in \"command\" (under 4000 characters)." };
      const c = classifyCommand(command);
      return c.destructive ? this.hold({ owner, at: Date.now(), kind: "run", command }, c.reason) : this.exec(owner, command);
    }
    if (action === "vps.read_file") {
      if (!path) return { error: "Give the file in \"path\"." };
      const link = await this.link(owner), size = await link.size(path);
      if (size === null) return { error: "There is no such file." };
      if (size > MAX_FILE) return { error: `That file is ${Math.round(size / 1024)} KB; read part of it with vps.run_command (head, tail or grep).` };
      return { path, text: capOutput(Buffer.from(await link.get(path)).toString("utf8"), 40_000).text };
    }
    if (action === "vps.write_file") {
      const content = typeof tool.content === "string" ? tool.content : "";
      if (!path || content.length > MAX_FILE) return { error: "Give \"path\" and \"content\" (under 200 KB)." };
      const link = await this.link(owner);
      if (await link.size(path) !== null) return this.hold({ owner, at: Date.now(), kind: "write", path, content }, "replaces a file that exists");
      await link.put(path, new TextEncoder().encode(content));
      return { ok: true, path, bytes: content.length };
    }
    if (action === "vps.service_status") return this.status(owner);
    return { error: "Unknown VPS action." };
  }
  /** Clem's worker, Docker or systemd units, disk and memory, in one round trip. */
  async status(owner: string) {
    const script = [
      "echo '## worker'; (docker ps --filter name=clem --format '{{.Names}}: {{.Status}}' 2>/dev/null; systemctl is-active clem-worker 2>/dev/null | sed 's/^/clem-worker (systemd): /') | head -5",
      "echo '## disk'; df -h ~ | tail -1",
      "echo '## memory'; free -h | head -2",
      "echo '## load'; uptime",
    ].join("; ");
    return this.exec(owner, script);
  }
  /** The person tapped Run it on a vps_confirm card. */
  async confirm(owner: string, id: string) {
    const p = this.pending.get(id);
    if (!p || p.owner !== owner || Date.now() - p.at > PENDING_MS) return { error: "This request expired. Ask again." };
    this.pending.delete(id);
    if (p.kind === "run") return this.exec(owner, p.command);
    const link = await this.link(owner), tmp = p.path + ".clem-" + id;
    await link.put(tmp, new TextEncoder().encode(p.content));
    await link.exec(`mv -f -- ${q(tmp)} ${q(p.path)}`);
    return { ok: true, path: p.path, bytes: p.content.length };
  }
  cancel(owner: string, id: string) { const p = this.pending.get(id); if (p?.owner === owner) this.pending.delete(id); return { ok: true }; }
}
