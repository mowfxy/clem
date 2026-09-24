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
      global:{fetch:(input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)})},
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
  /** A throwaway client for step-up checks, so verifying a password never replaces the signed-in session. */
  isolatedClient() {
    if (!this.config.url || !this.config.key) throw Error("Sign-in is not configured in this build.");
    return createClient(this.config.url, this.config.key, {
      global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(12000)})},
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  private verified: { token: string; at: number; user: import("@supabase/supabase-js").User } | null = null;
  /** Server-verified user. A verification is reused for 60 s for the same access token,
   *  so a burst of requests (one chat message makes several) costs one network check. */
  async user(requireMfa = true, fresh = false) {
    if (!this.client) return null;
    const token = (await this.client.auth.getSession()).data.session?.access_token;
    if (!token) { this.verified = null; return null; }
    let user = !fresh && this.verified && this.verified.token === token && Date.now() - this.verified.at < 60_000 ? this.verified.user : null;
    if (!user) {
      const { data, error } = await this.client.auth.getUser();
      if (error || !data.user) { this.verified = null; return null; }
      user = data.user;
      this.verified = { token, at: Date.now(), user };
    }
    const data = { user };
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
