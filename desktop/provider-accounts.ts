import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Codex } from "./codex.ts";
import type { Vault } from "./vault";
import { hasCapacity, isBelowSwitchThreshold, resetWindows } from "../core/account-usage.ts";
type Registry = { active: string; ids: string[] };
type AccountStatus = {id:string;connected:boolean;email?:string;usage?:any;checkedAt?:number;[key:string]:any};
/** Each account has its own Codex home and credential file, which ProviderLink keeps with the Mowr account. */
export class ProviderAccounts {
  private clients = new Map<string, Codex>();
  private registries = new Map<string, Registry>();
  private mutation = Promise.resolve();
  private snapshots = new Map<string, AccountStatus>();
  private vault:Vault;
  private executable:string;
  private root:string;
  constructor(vault:Vault,executable:string,root:string){this.vault=vault;this.executable=executable;this.root=root;}
  private async registry(owner: string) {
    let value = this.registries.get(owner);
    if (!value) {
      value = await this.vault.read<Registry>("providers-" + owner, {
        active: "default",
        ids: ["default"],
      });
      this.registries.set(owner, value);
    }
    return value;
  }
  private client(owner: string, id: string) {
    const key = owner + ":" + id;
    let value = this.clients.get(key);
    if (!value) {
      value = new Codex(
        this.executable,
        id === "default"
          ? join(this.root, owner, "codex")
          : join(this.root, owner, "accounts", id),
        join(this.root, owner, "scratch"),
      );
      this.clients.set(key, value);
    }
    return value;
  }
  private async checked(owner: string, id: string) {
    const r = await this.registry(owner);
    if (!r.ids.includes(id)) throw Error("Account not found.");
    return this.client(owner, id);
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation);
    this.mutation = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private assertIdle() {
    if ([...this.clients.values()].some((c) => c.busy))
      throw Error("Finish or stop the current task before changing accounts.");
  }
  async selected(owner: string) {
    const r = await this.registry(owner);
    return this.client(owner, r.active);
  }
  async list(owner: string, refresh = false) {
    const r = await this.registry(owner);
    const accounts = await Promise.all(
      r.ids.map(async (id) => {
        try {
          // Live UI polling may ask every second; each account's app-server is read at most every 10 seconds.
          return { id, ...(await this.client(owner, id).account(refresh ? 10000 : false)), ...this.client(owner,id).loginState() };
        } catch {
          return {
            id,
            connected: false,
            error: "Account status is unavailable. Try refreshing.",
          };
        }
      }),
    );
    const resets: {id:string;email?:string;windows:string[]}[] = [];
    for (const account of accounts) {
      const key = owner + ':' + account.id;
      const prior = this.snapshots.get(key);
      if (account.connected && account.usage) {
        const windows = prior?.connected ? resetWindows(prior.usage, account.usage) : [];
        if (windows.length) resets.push({id:account.id,email:account.email,windows});
        this.snapshots.set(key, account as AccountStatus);
      }
    }
    return { active: r.active, accounts, resets, autoSwitch: await this.autoSwitchEnabled(owner) };
  }
  async autoSwitchEnabled(owner:string) {
    return this.vault.read<boolean>('provider-auto-switch-' + owner, false);
  }
  async setAutoSwitch(owner:string, enabled:boolean) {
    await this.vault.write('provider-auto-switch-' + owner, enabled);
    return {enabled};
  }
  async selectForTask(owner:string, selection?:{model?:string;reasoning?:string}) {
    return this.exclusive(async () => {
      const r = await this.registry(owner);
      if (!await this.autoSwitchEnabled(owner)) return {active:r.active,switched:false};
      const current = await this.client(owner,r.active).account(10000).catch(() => null);
      if (!current?.connected || !current.usage || !isBelowSwitchThreshold(current.usage)) return {active:r.active,switched:false};
      const candidates = await Promise.all(r.ids.filter(id=>id!==r.active).map(async id=>({id,account:await this.client(owner,id).account(10000).catch(()=>null)})));
      let next: (typeof candidates)[number] | undefined;
      for (const candidate of candidates) {
        if (!candidate.account?.connected || !hasCapacity(candidate.account.usage)) continue;
        if (selection?.model) {
          const models = await this.client(owner,candidate.id).models().catch(()=>[]);
          const model = models.find(model=>model.id===selection.model);
          if (!model || (selection.reasoning && !model.reasoningEfforts.some((effort:any)=>effort.reasoningEffort===selection.reasoning))) continue;
        }
        next = candidate;
        break;
      }
      if (!next) return {active:r.active,switched:false,exhausted:true};
      this.assertIdle();
      const updated = {...r,active:next.id};
      await this.vault.write('providers-' + owner,updated);
      this.registries.set(owner,updated);
      return {active:next.id,switched:true,email:next.account.email,previous:r.active};
    });
  }
  async add(owner: string) {
    return this.exclusive(async () => {
      this.assertIdle();
      const r = await this.registry(owner);
      if (r.ids.length >= 10)
        throw Error("Remove an unused account before adding another.");
      const id = randomUUID(),
        next = { ...r, ids: [...r.ids, id] };
      await this.vault.write("providers-" + owner, next);
      this.registries.set(owner, next);
      try {
        return { id, ...(await this.client(owner, id).login()) };
      } catch (e) {
        await this.vault.write("providers-" + owner, r);
        this.registries.set(owner, r);
        throw e;
      }
    });
  }
  async retry(owner:string,id:string){
    this.assertIdle();
    return {id,...await (await this.checked(owner,id)).login()};
  }
  async status(owner: string, id: string) {
    return { id, ...(await (await this.checked(owner, id)).account(true)), ...(await this.checked(owner,id)).loginState() };
  }
  async activate(owner: string, id: string) {
    return this.exclusive(async () => {
      this.assertIdle();
      const client = await this.checked(owner, id);
      if (!(await client.account(true)).connected)
        throw Error("Sign in to this account first.");
      const r = await this.registry(owner),
        next = { ...r, active: id };
      await this.vault.write("providers-" + owner, next);
      this.registries.set(owner, next);
      return { ok: true };
    });
  }
  async remove(owner: string, id: string) {
    return this.exclusive(async () => {
      this.assertIdle();
      const client = await this.checked(owner, id);
      await client.logout();
      const r = await this.registry(owner),
        ids = r.ids.filter((x) => x !== id);
      if (!ids.length) ids.push("default");
      const next = { ids, active: r.active === id ? ids[0] : r.active };
      await this.vault.write("providers-" + owner, next);
      this.registries.set(owner, next);
      this.clients.delete(owner + ":" + id);
      this.snapshots.delete(owner + ':' + id);
      return { ok: true };
    });
  }
  /** Adds ChatGPT connections restored from the Mowr account, and restarts the Codex processes
   *  whose credentials were just written so they pick them up. */
  async adopt(owner: string, linked: { id: string }[], written: string[]) {
    return this.exclusive(async () => {
      for (const id of written) { const key = owner + ":" + id; this.clients.get(key)?.stop(); this.clients.delete(key); this.snapshots.delete(key); }
      const r = await this.registry(owner);
      const missing = linked.map((l) => l.id).filter((id) => !r.ids.includes(id));
      if (!missing.length) return r;
      let ids = [...r.ids, ...missing].slice(0, 10);
      // A fresh install starts with an empty "default" slot; drop it when linked accounts arrive.
      const defaultEmpty = ids.includes("default") && !linked.some((l) => l.id === "default") && !(await this.client(owner, "default").account(false).catch(() => null))?.connected;
      if (defaultEmpty) ids = ids.filter((id) => id !== "default");
      const next = { ids, active: ids.includes(r.active) ? r.active : ids[0] };
      await this.vault.write("providers-" + owner, next);
      this.registries.set(owner, next);
      return next;
    });
  }
  stop() {
    for (const client of this.clients.values()) client.stop();
  }
}
