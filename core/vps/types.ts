// What the window sees of the VPS connector (Settings → Connectors → VPS). Secrets never appear here.

export type VpsAuth = "key" | "password";
/** The connection, without its secrets (the key or password stay in the Vault). */
export type VpsConfig = { host: string; port: number; user: string; auth: VpsAuth; /** "SHA256:…", trusted on first use. */ fingerprint?: string; publicKey?: string };
export type VpsTest = { ok: true; ms: number; os: string; diskFree?: number; diskTotal?: number; docker: boolean; systemd: boolean; node?: string; fingerprint: string; firstTime: boolean } | { ok: false; error: string; fingerprint?: string };
export type StorageMode = "device" | "vps";
export type StorageUsage = { mode: StorageMode; device: number; vps: number; cache: number; cap: number; pinned: number; files: { device: number; vps: number } };
export type MigrationDirection = "up" | "down";
export type MigrationView = { direction: MigrationDirection; status: "running" | "paused" | "done" | "failed" | "aborted"; total: number; done: number; failed: number; bytesTotal: number; bytesDone: number; error?: string; startedAt: number; finishedAt?: number };
export type WorkerView = { enabled: boolean; installed: boolean; kind?: "docker" | "systemd"; runner: "desktop" | "worker" | "unknown"; heartbeat?: number; version?: string; model: "api" | "cli" | "none"; error?: string };
export type VpsStatus = { connected: boolean; config?: VpsConfig; online?: boolean; lastTest?: VpsTest; storage: StorageUsage; migration?: MigrationView; worker: WorkerView; passwordAllowed: boolean };

export const DEFAULT_CACHE_CAP = 2 * 1024 ** 3;
export const MIN_CACHE_CAP = 256 * 1024 ** 2;
export const vpsHostOk = (h: string) => /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(h) || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[?[0-9a-f:]+\]?$/i.test(h);
export const vpsUserOk = (u: string) => /^[a-z_][a-z0-9_.-]{0,31}$/i.test(u);
/** The line that adds the public key on the server. */
export const authorizeLine = (publicKey: string) => `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${publicKey.replace(/'/g, "")}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;

/** Exactly what goes to the worker, each sealed with AES-256-GCM under the worker key and sent over SSH (SFTP). */
export const WORKER_SECRETS = [
  { name: "guc", what: "GUC username and password", when: "GUC is connected" },
  { name: "engine-token", what: "A Telegram relay token: works only for Clem's /telegram/* routes, revocable, not your Clem session", when: "always (minted at install)" },
  { name: "model", what: "A model API key you typed for the worker (Clem never reads keys from your CLIs)", when: "you added one" },
  { name: "rpc", what: "The token the desktop uses to talk to the worker through the SSH tunnel", when: "always" },
] as const;
