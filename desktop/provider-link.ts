import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DesktopAuth } from "./auth";
import type { Vault } from "./vault";

type Kind = "codex" | "claude";
type Linked = { id: string; kind: Kind; label: string; hash: string; data: string };
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export const CLAUDE_LINK_ID = "claude";

/** Keeps ChatGPT (Codex) and Claude sign-ins with the Clem account: each credential file is backed
 *  up (encrypted by the account service) when it changes, and written back after a reinstall or on
 *  another PC. The newer side wins: a file changed here since its last upload is uploaded, and a
 *  file untouched here is replaced when the account holds a newer copy (for example a refresh made
 *  on another PC). */
export class ProviderLink {
  private checked = new Map<string, number>();
  private queue = Promise.resolve();
  private auth: DesktopAuth;
  private vault: Vault;
  private root: string;
  constructor(auth: DesktopAuth, vault: Vault, root: string) { this.auth = auth; this.vault = vault; this.root = root; }

  codexFile(owner: string, id: string) {
    return join(this.root, owner, id === "default" ? "codex" : join("accounts", id), "auth.json");
  }
  /** The first Claude account is linked as "claude"; each added one as "claude-<account id>". */
  claudeFile(owner: string, id = CLAUDE_LINK_ID) {
    return id === CLAUDE_LINK_ID ? join(this.root, owner, "claude", ".credentials.json") : join(this.root, owner, "claude-accounts", id.replace(/^claude-/, ""), ".credentials.json");
  }
  private fileFor(owner: string, item: { id: string; kind: Kind }) {
    return item.kind === "codex" ? this.codexFile(owner, item.id) : this.claudeFile(owner, item.id);
  }
  private uploaded(owner: string) {
    return this.vault.read<Record<string, string>>("provider-link-" + owner, {});
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.then(() => {}, () => {});
    return next;
  }
  private async signedIn(owner: string) {
    return (await this.auth.user().catch(() => null))?.id === owner;
  }

  /** Uploads a credential file when it has changed since it was last uploaded. */
  backup(owner: string, id: string, kind: Kind, label = "") {
    return this.serial(async () => {
      if (!(await this.signedIn(owner))) return;
      const file = this.fileFor(owner, { id, kind });
      const info = await stat(file).catch(() => null);
      if (!info || this.checked.get(owner + ":" + id) === info.mtimeMs) return;
      const data = await readFile(file, "utf8");
      try { JSON.parse(data); } catch { return; }
      const hash = sha(data), uploaded = await this.uploaded(owner);
      if (uploaded[id] !== hash) {
        await this.auth.cloud("/providers/put", { id, kind, label, hash, data });
        await this.vault.write("provider-link-" + owner, { ...uploaded, [id]: hash });
      }
      this.checked.set(owner + ":" + id, info.mtimeMs);
    });
  }

  /** Removes a connection from the account, so other PCs stop restoring it. */
  forget(owner: string, id: string) {
    return this.serial(async () => {
      if (!(await this.signedIn(owner))) return;
      await this.auth.cloud("/providers/delete", { id });
      const uploaded = await this.uploaded(owner);
      delete uploaded[id];
      await this.vault.write("provider-link-" + owner, uploaded);
      this.checked.delete(owner + ":" + id);
    });
  }

  /** Brings linked sign-ins onto this PC. Returns the ChatGPT connections the account holds, the added Claude
   *  accounts (by their Clem account id), and the ids whose credentials were written, so their processes can restart. */
  restore(owner: string) {
    return this.serial(async () => {
      const result = { codex: [] as { id: string; label: string }[], claude: [] as string[], written: [] as string[] };
      if (!(await this.signedIn(owner))) return result;
      const { items } = (await this.auth.cloud("/providers")) as { items: Linked[] };
      const uploaded = await this.uploaded(owner);
      for (const item of items as (Linked | { id: string; kind: "telegram" })[]) {
        // Telegram was removed: a bot connection an earlier Clem kept with the account is deleted from it.
        if (item.kind === "telegram") { await this.auth.cloud("/providers/delete", { id: item.id }).catch(() => {}); delete uploaded[item.id]; continue; }
        // The id becomes a folder name: never let a stored entry write outside this account's folders.
        if ((item.kind !== "codex" && item.kind !== "claude") || typeof item.id !== "string" || !/^[\w-]{1,64}$/.test(item.id) || typeof item.data !== "string") continue;
        if (item.kind === "claude" && item.id !== CLAUDE_LINK_ID && !/^claude-[\w-]{1,57}$/.test(item.id)) continue;
        if (item.kind === "codex") result.codex.push({ id: item.id, label: item.label });
        if (item.kind === "claude" && item.id !== CLAUDE_LINK_ID) result.claude.push(item.id.replace(/^claude-/, ""));
        const file = this.fileFor(owner, item);
        const local = await readFile(file, "utf8").catch(() => "");
        const localHash = local ? sha(local) : "";
        if (localHash === item.hash) { uploaded[item.id] = item.hash; continue; }
        // Changed here since the last upload: this PC holds the newer sign-in; back it up instead.
        if (local && localHash !== uploaded[item.id]) continue;
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, item.data, { encoding: "utf8", mode: 0o600 });
        uploaded[item.id] = item.hash;
        this.checked.delete(owner + ":" + item.id);
        result.written.push(item.id);
      }
      await this.vault.write("provider-link-" + owner, uploaded);
      return result;
    });
  }
}
