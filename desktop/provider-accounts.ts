import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Codex } from "./codex.ts";
import type { Vault } from "./vault";
type Registry = { active: string; ids: string[] };
/** Each account has its own Codex home and OS-keyring credential namespace. */
export class ProviderAccounts {
  private clients = new Map<string, Codex>();
  private registries = new Map<string, Registry>();
  private mutation = Promise.resolve();
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
          return { id, ...(await this.client(owner, id).account(refresh)) };
        } catch {
          return {
            id,
            connected: false,
            error: "Account status is unavailable. Try refreshing.",
          };
        }
      }),
    );
    return { active: r.active, accounts };
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
  async status(owner: string, id: string) {
    return { id, ...(await (await this.checked(owner, id)).account(true)) };
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
      return { ok: true };
    });
  }
  stop() {
    for (const client of this.clients.values()) client.stop();
  }
}
