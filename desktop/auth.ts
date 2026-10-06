import { createClient, isAuthRetryableFetchError, type SupabaseClient, type User } from "@supabase/supabase-js";
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
  private verified: { token: string; at: number; user: User } | null = null;
  /** The last user the server confirmed (or the stored session's user), kept while the network is unreachable. */
  private known: User | null = null;
  /** The user saved with the session on this PC, for when an expired session cannot be refreshed offline.
   *  An account with an authenticator counts only when that saved session had completed it. */
  private async storedUser(): Promise<User | null> {
    const key = (this.client?.auth as unknown as { storageKey?: string })?.storageKey;
    if (!key) return null;
    try {
      const raw = await this.vault.read<string | null>("auth-" + Buffer.from(key).toString("hex"), null);
      const session = raw ? JSON.parse(raw) : null, user = session?.user as User | undefined;
      if (!user?.id) return null;
      const aal = JSON.parse(Buffer.from(String(session.access_token || "").split(".")[1] || "", "base64url").toString() || "{}").aal;
      return user.factors?.some((f) => f.status === "verified") && aal !== "aal2" ? null : user;
    } catch { return null; }
  }
  /** Signing out always ends the session on this PC, even when the server could not be told (offline). */
  async forget() {
    this.verified = null; this.known = null;
    const key = (this.client?.auth as unknown as { storageKey?: string })?.storageKey;
    if (key) await this.vault.write("auth-" + Buffer.from(key).toString("hex"), null).catch(() => {});
  }
  /** Server-verified user. A verification is reused for 60 s for the same access token,
   *  so a burst of requests (one chat message makes several) costs one network check.
   *  When the auth server cannot be reached (offline, timeout, 5xx), the last verified user is kept so local work
   *  continues; only a real rejection by the server signs the person out. */
  async user(requireMfa = true, fresh = false) {
    if (!this.client) return null;
    const current = await this.client.auth.getSession();
    const token = current.data.session?.access_token;
    if (!token) {
      if (isAuthRetryableFetchError(current.error)) return this.known ?? (this.known = await this.storedUser());
      this.verified = null; this.known = null; return null;
    }
    let user = !fresh && this.verified && this.verified.token === token && Date.now() - this.verified.at < 60_000 ? this.verified.user : null;
    if (!user) {
      const { data, error } = await this.client.auth.getUser();
      if (error && isAuthRetryableFetchError(error)) {
        user = this.known ?? current.data.session?.user ?? null;
        if (!user) return null;
        // Checked again in about 15 s instead of on every request while offline.
        this.verified = { token, at: Date.now() - 45_000, user };
      } else if (error || !data.user) { this.verified = null; this.known = null; return null; }
      else {
        user = data.user;
        this.verified = { token, at: Date.now(), user };
      }
    }
    const assurance =
      await this.client.auth.mfa.getAuthenticatorAssuranceLevel();
    const pending = !!assurance.error || (assurance.data?.nextLevel === "aal2" && assurance.data.currentLevel !== "aal2");
    if (!pending) this.known = user;
    if (requireMfa && pending)
      throw Error("Complete authenticator verification before continuing.");
    return user;
  }
  /** A signed-in request to the account service that hands back the raw response (files, form uploads). */
  async cloudFetch(path: string, init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {}, signal?: AbortSignal, timeout = 15000) {
    if (!this.config.service)
      throw Error("Account service is not configured in this build.");
    if (!(await this.user())) throw Error("Sign in again to continue.");
    const { data } = await this.client!.auth.getSession();
    if (!data.session) throw Error("Mowr could not reach the account service. Check your connection and try again.");
    return fetch(this.config.service + path, {
      method: init.method || "GET",
      headers: { Authorization: "Bearer " + data.session!.access_token, ...init.headers },
      body: init.body,
      signal: signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout),
    });
  }
  async cloud(path: string, body?: unknown,signal?:AbortSignal) {
    const response = await this.cloudFetch(path, body === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, signal);
    // A gateway error page is HTML, not JSON: the person is told the service is unavailable, never a parser message.
    const result = (await response.json().catch(() => {
      if (response.ok) throw Error("Account service is unavailable.");
      return {};
    })) as any;
    if (!response.ok)
      throw Error(result.error || "Account service is unavailable.");
    return result;
  }
}
