// Test a server, and install or refresh Clem's worker on it over SSH (docs/GUC-VPS-ENGINE.md "Background worker").
// Docker (compose: the worker plus Postgres) when the user can run it, else a systemd user unit with Node 22+.
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { VpsTest } from "../../../core/vps/types.ts";
import type { SshLink, VpsLink } from "./link.ts";
import { seal, secretFile } from "./secrets.ts";

export const WORKER_PORT = 7717;
export const workerDir = (owner: string) => `clem/${owner}/worker`;
const PROBE = `echo "os=$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || uname -sr)"; echo "df=$(df -Pk ~ | tail -1 | awk '{print $2" "$4}')"; echo "docker=$(docker compose version >/dev/null 2>&1 && docker ps >/dev/null 2>&1 && echo yes || echo no)"; echo "systemd=$(systemctl --user show-environment >/dev/null 2>&1 && echo yes || echo no)"; echo "node=$(node -v 2>/dev/null)"; echo "uid=$(id -u) gid=$(id -g)"`;

export type Probe = { os: string; diskFree?: number; diskTotal?: number; docker: boolean; systemd: boolean; node?: string; uid: number; gid: number };
export async function probe(link: VpsLink): Promise<Probe> {
  const r = await link.exec(PROBE, { timeout: 20_000 });
  const get = (k: string) => r.stdout.match(new RegExp("^" + k + "=(.*)$", "m"))?.[1]?.trim() || "";
  const [total, free] = get("df").split(" ").map((n) => Number(n) * 1024);
  return { os: get("os") || "Linux", ...(free ? { diskFree: free, diskTotal: total } : {}), docker: get("docker") === "yes", systemd: get("systemd") === "yes", ...(get("node") ? { node: get("node") } : {}), uid: Number(r.stdout.match(/uid=(\d+)/)?.[1] || 1000), gid: Number(r.stdout.match(/gid=(\d+)/)?.[1] || 1000) };
}
/** Settings → Connectors → VPS → Test connection: how long a round trip takes, the OS, free disk and what can run the worker. */
export async function testServer(link: SshLink | VpsLink): Promise<VpsTest> {
  const t0 = Date.now(); await link.exec("true", { timeout: 10_000 }); const ms = Date.now() - t0;
  const p = await probe(link);
  const s = link as SshLink;
  return { ok: true, ms: Math.max(ms, 1), os: p.os, diskFree: p.diskFree, diskTotal: p.diskTotal, docker: p.docker, systemd: p.systemd, node: p.node, fingerprint: s.fingerprint || "", firstTime: !!s.firstTime };
}
const nodeOk = (v?: string) => !!v && Number(v.replace(/^v/, "").split(".")[0]) >= 22;

/** Uploads the worker bundle, its key, config and sealed secrets, then starts it. `secrets`: name → value (see
 *  core/vps/types.ts WORKER_SECRETS); each sealed with AES-256-GCM under `key` here, so the server only ever holds
 *  ciphertext plus the key file (mode 600). Returns how it runs. */
export async function installWorker(o: { link: VpsLink; owner: string; bundle: string; key: Uint8Array; secrets: Record<string, unknown>; accountService: string; port?: number; progress?: (label: string) => void }) {
  const { link, owner } = o, dir = workerDir(owner), port = o.port || WORKER_PORT;
  o.progress?.("Checking the server…");
  const p = await probe(link);
  const kind = p.docker ? "docker" : p.systemd && nodeOk(p.node) ? "systemd" : null;
  if (!kind) throw Error(p.systemd ? "Install Docker, or Node.js 22 or newer, on the server, then try again." : "This server has neither Docker nor systemd, so Clem can't keep a worker running there.");
  o.progress?.("Sending Clem's worker…");
  for (const sub of ["", "/migrations", "/state", "/state/secrets", "/state/tmp"]) await link.mkdir(dir + sub);
  await link.mkdir(`clem/${owner}/files`);
  const send = async (from: string, to: string) => {
    for (const e of await readdir(from, { withFileTypes: true })) {
      if (e.isDirectory()) { await link.mkdir(`${to}/${e.name}`); await send(join(from, e.name), `${to}/${e.name}`); }
      else await link.put(`${to}/${e.name}`, new Uint8Array(await readFile(join(from, e.name))));
    }
  };
  await send(o.bundle, dir);
  const text = (s: string) => new TextEncoder().encode(s);
  await link.put(`${dir}/.key`, text(Buffer.from(o.key).toString("base64")), 0o600);
  await link.put(`${dir}/config.json`, text(JSON.stringify({ owner, accountService: o.accountService })));
  // Keep Postgres's password across refreshes (its volume was made with it).
  const env = await link.get(`${dir}/.env`).then((b) => Buffer.from(b).toString("utf8"), () => "");
  const pgPass = env.match(/^POSTGRES_PASSWORD=(\w+)$/m)?.[1] || randomBytes(18).toString("hex");
  await link.put(`${dir}/.env`, text(`POSTGRES_PASSWORD=${pgPass}\nCLEM_UID=${p.uid}\nCLEM_GID=${p.gid}\nCLEM_PORT=${port}\n`), 0o600);
  for (const [name, value] of Object.entries(o.secrets)) if (value !== undefined) await link.put(`${dir}/state/secrets/${secretFile(name)}`, seal(o.key, name, value), 0o600);
  await link.exec(`chmod 700 ${dir}/state ${dir}/state/secrets; chmod 600 ${dir}/.key ${dir}/.env`);
  o.progress?.(kind === "docker" ? "Starting it with Docker…" : "Starting it with systemd…");
  const start = kind === "docker"
    ? `cd ~/${dir} && docker compose up -d --build 2>&1 | tail -20`
    : `mkdir -p ~/.config/systemd/user && sed "s/OWNER/${owner}/g" ~/${dir}/clem-worker.service > ~/.config/systemd/user/clem-worker.service && systemctl --user daemon-reload && systemctl --user enable clem-worker >/dev/null 2>&1; systemctl --user restart clem-worker; (loginctl enable-linger "$(whoami)" >/dev/null 2>&1 || true); systemctl --user is-active clem-worker`;
  const r = await link.exec(start, { timeout: 600_000 });
  if (r.code !== 0) throw Error("The worker didn't start: " + (r.stdout + r.stderr).trim().split("\n").slice(-3).join(" ").slice(0, 300));
  return { kind: kind as "docker" | "systemd", port };
}
/** Sends one changed secret (a new GUC password) to an installed worker. */
export async function sendSecret(link: VpsLink, owner: string, key: Uint8Array, name: string, value: unknown) {
  const path = `${workerDir(owner)}/state/secrets/${secretFile(name)}`;
  if (value === undefined) await link.remove(path); else await link.put(path, seal(key, name, value), 0o600);
}
export async function stopWorker(link: VpsLink, owner: string, kind: "docker" | "systemd") {
  await link.exec(kind === "docker" ? `cd ~/${workerDir(owner)} && docker compose down` : "systemctl --user disable --now clem-worker", { timeout: 120_000 });
}
