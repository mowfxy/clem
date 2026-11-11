/// <reference path="./httpntlm.d.ts" />
// Talks to GUC over NTLM: one keep-alive agent per owner, at most 2 requests per host at a time, backoff on errors,
// conditional requests, and typed failures. The password lives only in this object's closure while it runs.
import httpntlm from "httpntlm";
import { Agent } from "node:https";
import { createHash } from "node:crypto";
import { pageState } from "../../core/guc/parse.ts";
import { GucError, asGucError } from "./errors.ts";

export type HttpRequest = { method: "GET" | "POST"; url: string; headers?: Record<string, string>; form?: Record<string, string> };
export type HttpResponse = { status: number; headers: Record<string, string | undefined>; body: string };
export type Credentials = { username: string; password: string; domain?: string };
/** One NTLM exchange. Swapped for a fake in tests. */
export type Http = (request: HttpRequest, credentials: Credentials) => Promise<HttpResponse>;

export function ntlmHttp(agent = new Agent({ keepAlive: true, maxSockets: 4 })): Http {
  return (request, c) => new Promise((resolve, reject) => {
    const options = { url: request.url, username: c.username, password: c.password, domain: c.domain || "", workstation: "", agent, headers: request.headers, parameters: request.form, timeout: 30_000 };
    (request.method === "POST" ? httpntlm.post : httpntlm.get)(options, (error, res) => error ? reject(error) : resolve({ status: res.statusCode, headers: res.headers || {}, body: res.body || "" }));
  });
}

/** The page without the parts ASP.NET changes on every load (view state, scripts), hashed. */
export const contentHash = (html: string) => createHash("sha256").update(html.replace(/<input[^>]+type=["']?hidden[^>]*>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "")).digest("hex");

export type PageMemo = { hash?: string; etag?: string; modified?: string };
export type Fetched = { url: string; status: number; body: string; memo: PageMemo; unchanged: boolean; unavailable?: boolean };

export class GucClient {
  requests = 0;
  private active = new Map<string, number>();
  private waiting = new Map<string, (() => void)[]>();
  private credentials: Credentials;
  private http: Http;
  private sleep: (ms: number) => Promise<void>;
  constructor(credentials: Credentials, http: Http = ntlmHttp(), sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))) {
    this.credentials = credentials; this.http = http; this.sleep = sleep;
  }
  get username() { return this.credentials.username; }
  get domain() { return this.credentials.domain; }

  private async slot(host: string) {
    if ((this.active.get(host) || 0) >= 2) await new Promise<void>((r) => this.waiting.set(host, [...(this.waiting.get(host) || []), r]));
    this.active.set(host, (this.active.get(host) || 0) + 1);
    return () => { this.active.set(host, (this.active.get(host) || 1) - 1); const next = this.waiting.get(host)?.shift(); next?.(); };
  }

  /** One request with up to 3 tries (0.5 s, 1 s, 2 s apart) on network errors and 5xx, following redirects. */
  async send(request: HttpRequest): Promise<HttpResponse & { url: string }> {
    let url = request.url;
    for (let hop = 0; hop < 4; hop++) {
      const release = await this.slot(new URL(url).host);
      let response: HttpResponse | undefined, failure: unknown;
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (attempt) await this.sleep(500 * 2 ** (attempt - 1));
          this.requests++;
          try { response = await this.http({ ...request, url }, this.credentials); failure = undefined; } catch (e) { failure = e; continue; }
          if (response.status < 500) break;
        }
      } finally { release(); }
      if (!response) throw asGucError(failure);
      if (response.status >= 500) throw new GucError("unavailable", "http " + response.status);
      if (response.status === 401 || response.status === 403) throw new GucError("auth", "http " + response.status);
      const location = response.headers.location;
      if (response.status >= 300 && response.status < 400 && response.status !== 304 && location) {
        url = new URL(location, url).href;
        if (!/^https:\/\/([\w-]+\.)*guc\.edu\.eg\//.test(url)) throw new GucError("unavailable", "redirected away");
        request = { method: "GET", url, headers: request.headers };
        continue;
      }
      return { ...response, url };
    }
    throw new GucError("unavailable", "too many redirects");
  }

  /** A page, asked for conditionally; `unchanged` when the server says 304 or the content hash matches `memo`. */
  async page(url: string, memo: PageMemo = {}, request?: Omit<HttpRequest, "url">): Promise<Fetched> {
    const headers: Record<string, string> = { ...request?.headers };
    if (!request || request.method === "GET") { if (memo.etag) headers["If-None-Match"] = memo.etag; if (memo.modified) headers["If-Modified-Since"] = memo.modified; }
    const res = await this.send({ method: "GET", ...request, url, headers });
    if (res.status === 304) return { url: res.url, status: 304, body: "", memo, unchanged: true };
    const state = pageState(res.body, res.url);
    if (state === "login") throw new GucError("auth", "login page");
    if (state === "unavailable") return { url: res.url, status: res.status, body: "", memo, unchanged: true, unavailable: true };
    const hash = contentHash(res.body);
    return { url: res.url, status: res.status, body: res.body, memo: { hash, etag: res.headers.etag, modified: res.headers["last-modified"] }, unchanged: hash === memo.hash };
  }
}

/** Signs in to the CMS home page, as typed and then as GUC\username, and returns the client that worked. */
export async function login(username: string, password: string, home: string, http?: Http, sleep?: (ms: number) => Promise<void>) {
  const name = username.trim().replace(/^guc\\/i, "");
  let failure: unknown;
  for (const domain of /^guc\\/i.test(username.trim()) ? ["GUC", ""] : ["", "GUC"]) {
    const client = new GucClient({ username: name, password, domain }, http, sleep);
    try { await client.page(home); return client; } catch (e) { failure = e; if (!(e instanceof GucError && e.kind === "auth")) throw e; }
  }
  throw new GucError("auth", (failure as GucError).detail, "GUC didn't accept that username or password. Check them and try again.");
}
