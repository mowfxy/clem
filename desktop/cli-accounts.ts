import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import type { Vault } from "./vault";
import { isBelowSwitchThreshold, type UsageSnapshot } from "../core/account-usage.ts";

/** One Claude or Grok sign-in, in the shape Settings shows for ChatGPT accounts. */
export type CliAccount = { id: string; connected: boolean; installed?: boolean; pending?: boolean; email?: string; plan?: string; usage?: UsageSnapshot; checkedAt?: number; error?: string };
export interface CliProvider { readonly busy: boolean; cancel(id: string): void; stop(): void; logout(): Promise<void>; endSession(id: string): Promise<void>; forget(): void }
type Registry = { active: string; ids: string[] };
type Options<P> = {
  /** The provider for one account: "default" is the sign-in Mowr has always used, others have their own folder. */
  make: (owner: string, id: string) => P;
  /** The folder an added account keeps its sign-in in (removed with the account). */
  folder: (owner: string, id: string) => string;
  describe: (provider: P, refresh: boolean) => Promise<Omit<CliAccount, "id">>;
};
const SIGN_IN_MS = 15 * 60_000;

/**
 * Several Claude or Grok accounts, as ChatGPT has: each keeps its own sign-in folder (Claude Code's
 * CLAUDE_CONFIG_DIR, Grok's GROK_HOME), one is active, and with automatic switching Mowr moves to another
 * connected account before a request when the active one is nearly out of usage, or during one when the
 * plan refuses it. A running answer keeps its own account; only later requests move.
 */
export class CliAccounts<P extends CliProvider> {
  private providers = new Map<string, P>();
  private registries = new Map<string, Registry>();
  private mutation = Promise.resolve();
  /** Accounts the plan refused, until the time their usage resets. */
  private exhausted = new Map<string, number>();
  /** Sign-ins started from Settings, so an account waiting for the browser says so. */
  private signing = new Map<string, number>();
  private kind: "claude" | "grok";
  private vault: Vault;
  private options: Options<P>;
  constructor(kind: "claude" | "grok", vault: Vault, options: Options<P>) { this.kind = kind; this.vault = vault; this.options = options; }
  private key(owner: string) { return this.kind + "-accounts-" + owner; }
  private async registry(owner: string) {
    let value = this.registries.get(owner);
    if (!value) {
      value = await this.vault.read<Registry>(this.key(owner), { active: "default", ids: ["default"] });
      this.registries.set(owner, value);
    }
    return value;
  }
  private async save(owner: string, next: Registry) {
    await this.vault.write(this.key(owner), next);
    this.registries.set(owner, next);
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation);
    this.mutation = result.then(() => {}, () => {});
    return result;
  }
  provider(owner: string, id: string) {
    const key = owner + ":" + id;
    let value = this.providers.get(key);
    if (!value) { value = this.options.make(owner, id); this.providers.set(key, value); }
    return value;
  }
  async ids(owner: string) { return [...(await this.registry(owner)).ids]; }
  async selected(owner: string) {
    const r = await this.registry(owner);
    return { id: r.active, provider: this.provider(owner, r.active) };
  }
  /** Every account's provider for this person: a cancel or a quit reaches whichever one is answering. */
  async all(owner: string) { return (await this.registry(owner)).ids.map((id) => this.provider(owner, id)); }
  private refused(owner: string, id: string) {
    const until = this.exhausted.get(owner + ":" + id);
    if (until && until > Date.now()) return true;
    this.exhausted.delete(owner + ":" + id);
    return false;
  }
  private async describe(owner: string, id: string, refresh: boolean): Promise<CliAccount> {
    try {
      const account = { id, ...(await this.options.describe(this.provider(owner, id), refresh)) };
      const started = this.signing.get(owner + ":" + id);
      if (account.connected) this.signing.delete(owner + ":" + id);
      else if (started && Date.now() - started < SIGN_IN_MS) account.pending = true;
      // A refusal is shown as no usage left until the window resets, even when the provider reports nothing more.
      if (account.connected && this.refused(owner, id)) account.usage = { ...(account.usage || {}), ordinaryUsageAllowed: false };
      return account;
    } catch {
      return { id, connected: false, error: "Account status is unavailable. Try refreshing." };
    }
  }
  async list(owner: string, refresh = false) {
    const r = await this.registry(owner);
    const accounts = await Promise.all(r.ids.map((id) => this.describe(owner, id, refresh)));
    return { active: r.active, accounts };
  }
  /** Adds an account and opens its sign-in. Settings then shows it as waiting until the browser sign-in finishes. */
  async add(owner: string, login: (provider: P) => Promise<unknown>) {
    return this.exclusive(async () => {
      const r = await this.registry(owner);
      if (r.ids.length >= 10) throw Error("Remove an unused account before adding another.");
      const id = randomUUID();
      await this.save(owner, { ...r, ids: [...r.ids, id] });
      try {
        this.signing.set(owner + ":" + id, Date.now());
        await login(this.provider(owner, id));
        return { id, pending: true };
      } catch (error) {
        this.signing.delete(owner + ":" + id);
        await this.save(owner, r);
        throw error;
      }
    });
  }
  /** Opens the sign-in again for an account that is not connected. */
  async signIn(owner: string, id: string, login: (provider: P) => Promise<unknown>) {
    if (!(await this.registry(owner)).ids.includes(id)) throw Error("Account not found.");
    this.signing.set(owner + ":" + id, Date.now());
    await login(this.provider(owner, id));
    return { id, pending: true };
  }
  async activate(owner: string, id: string) {
    return this.exclusive(async () => {
      const r = await this.registry(owner);
      if (!r.ids.includes(id)) throw Error("Account not found.");
      if (!(await this.describe(owner, id, true)).connected) throw Error("Sign in to this account first.");
      await this.save(owner, { ...r, active: id });
      return { ok: true };
    });
  }
  async remove(owner: string, id: string) {
    return this.exclusive(async () => {
      const r = await this.registry(owner);
      if (!r.ids.includes(id)) throw Error("Account not found.");
      const provider = this.provider(owner, id);
      if (provider.busy) throw Error("Finish or stop the answer using this account first.");
      await provider.logout().catch(() => {});
      provider.stop();
      // An added account's folder holds only its own sign-in and settings; the first one's is the CLI's own and stays.
      if (id !== "default") await rm(this.options.folder(owner, id), { recursive: true, force: true }).catch(() => {});
      const ids = r.ids.filter((x) => x !== id);
      if (!ids.length) ids.push("default");
      await this.save(owner, { ids, active: r.active === id ? ids[0] : r.active });
      this.providers.delete(owner + ":" + id);
      this.exhausted.delete(owner + ":" + id);
      this.signing.delete(owner + ":" + id);
      return { ok: true };
    });
  }
  /** Another connected account with usage left, or none. */
  private async next(owner: string, r: Registry, except: string) {
    for (const id of r.ids) {
      if (id === except || this.refused(owner, id)) continue;
      const account = await this.describe(owner, id, false);
      if (account.connected && !isBelowSwitchThreshold(account.usage)) return account;
    }
    return null;
  }
  /** Before a request: moves to another account when the active one is signed out or nearly out of usage. */
  async selectForTask(owner: string, autoSwitch: boolean) {
    return this.exclusive(async () => {
      const r = await this.registry(owner);
      if (!autoSwitch || r.ids.length < 2) return { active: r.active, switched: false };
      const current = await this.describe(owner, r.active, false);
      if (current.connected && !this.refused(owner, r.active) && !isBelowSwitchThreshold(current.usage)) return { active: r.active, switched: false };
      const next = await this.next(owner, r, r.active);
      if (!next) return { active: r.active, switched: false };
      await this.save(owner, { ...r, active: next.id });
      return { active: next.id, switched: true, email: next.email, previous: r.active };
    });
  }
  /**
   * The plan refused a request on `from`: it is set aside until its usage resets, and with automatic switching
   * another connected account becomes active. Returns that account, or null when there is none to move to.
   */
  async failover(owner: string, from: string, autoSwitch: boolean) {
    const account = await this.describe(owner, from, false).catch(() => null);
    const resets = [account?.usage?.rateLimits?.primary?.resetsAt, account?.usage?.rateLimits?.secondary?.resetsAt].filter((t): t is number => typeof t === "number" && t * 1000 > Date.now());
    this.exhausted.set(owner + ":" + from, resets.length ? Math.min(...resets) * 1000 : Date.now() + 60 * 60_000);
    if (!autoSwitch) return null;
    return this.exclusive(async () => {
      const r = await this.registry(owner);
      const next = await this.next(owner, r, from);
      if (!next) return null;
      await this.save(owner, { ...r, active: next.id });
      return { id: next.id, email: next.email, provider: this.provider(owner, next.id) };
    });
  }
  /** Accounts restored from the Mowr account (their sign-ins were just written back to this PC). */
  async adopt(owner: string, ids: string[]) {
    return this.exclusive(async () => {
      for (const id of ids) { const key = owner + ":" + id; this.providers.get(key)?.forget(); }
      const r = await this.registry(owner);
      const missing = ids.filter((id) => !r.ids.includes(id));
      if (!missing.length) return r;
      const next = { ...r, ids: [...r.ids, ...missing].slice(0, 10) };
      await this.save(owner, next);
      return next;
    });
  }
  stop() { for (const provider of this.providers.values()) provider.stop(); }
}
