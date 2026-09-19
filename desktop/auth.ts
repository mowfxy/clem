import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Vault } from "./vault";

export class DesktopAuth {
  client: SupabaseClient | null = null;
  constructor(
    private vault: Vault,
    private config: { url: string; key: string; service: string },
  ) {}
  async initialize() {
    if (!this.config.url || !this.config.key) return;
    const storage = {
      getItem: async (key: string) =>
        this.vault.read<string | null>(
          "auth-" + Buffer.from(key).toString("hex"),
          null,
        ),
      setItem: async (key: string, value: string) =>
        this.vault.write("auth-" + Buffer.from(key).toString("hex"), value),
      removeItem: async (key: string) =>
        this.vault.write("auth-" + Buffer.from(key).toString("hex"), null),
    };
    this.client = createClient(this.config.url, this.config.key, {
      auth: {
        storage,
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    await this.client.auth.getSession();
  }
  async user(requireMfa = true) {
    if (!this.client) return null;
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user) return null;
    const assurance =
      await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (
      requireMfa &&
      (assurance.error ||
        (assurance.data.nextLevel === "aal2" &&
          assurance.data.currentLevel !== "aal2"))
    )
      throw Error("Complete authenticator verification before continuing.");
    return data.user;
  }
  async cloud(path: string, body?: unknown,signal?:AbortSignal) {
    if (!this.config.service)
      throw Error("Account service is not configured in this build.");
    if (!(await this.user())) throw Error("Sign in again to continue.");
    const { data } = await this.client!.auth.getSession();
    const response = await fetch(this.config.service + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: "Bearer " + data.session!.access_token,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),
    });
    const result = (await response.json()) as any;
    if (!response.ok)
      throw Error(result.error || "Account service is unavailable.");
    return result;
  }
}
