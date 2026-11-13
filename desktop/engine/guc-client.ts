/// <reference path="./httpntlm.d.ts" />
// Talks to GUC over NTLM: one keep-alive agent per owner, at most 2 requests per host at a time, backoff on errors,
// conditional requests, and typed failures. The password lives only in this object's closure while it runs.
import httpntlm from "httpntlm";
import { Agent } from "node:https";
import { createHash } from "node:crypto";
import { pageState } from "../../core/guc/parse.ts";
import { GucError, asGucError } from "./errors.ts";

export type HttpRequest = { method: "GET" | "POST" | "HEAD"; url: string; headers?: Record<string, string>; form?: Record<string, string>; /** A raw request body (EWS SOAP), sent as is. */ body?: string; /** A 3xx is an error, not followed (mail). */ noRedirect?: boolean; /** The body as bytes (a file), not text. */ binary?: boolean };
export type HttpResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: string; bytes?: Uint8Array };
export type Credentials = { username: string; password: string; domain?: string };
/** One NTLM exchange. Swapped for a fake in tests. */
export type Http = (request: HttpRequest, credentials: Credentials) => Promise<HttpResponse>;

export function ntlmHttp(agent = new Agent({ keepAlive: true, maxSockets: 4 })): Http {
  return (request, c) => new Promise((resolve, reject) => {
    const options = { url: request.url, username: c.username, password: c.password, domain: c.domain || "", workstation: "", agent, headers: request.headers, parameters: request.form, ...(request.body !== undefined ? { body: request.body } : {}), timeout: request.binary ? 120_000 : 30_000, binary: request.binary };
    httpntlm.method(request.method.toLowerCase(), options, (error, res) => error ? reject(error)
      : resolve(request.binary ? { status: res.statusCode, headers: res.headers || {}, body: "", bytes: new Uint8Array(res.body as unknown as Buffer) } : { status: res.statusCode, headers: res.headers || {}, body: res.body || "" }));
  });
}

/** The page without the parts ASP.NET changes on every load (view state, scripts), hashed. */
export const contentHash = (html: string) => createHash("sha256").update(html.replace(/<input[^>]+type=["']?hidden[^>]*>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "")).digest("hex");

export type PageMemo = { hash?: string; etag?: string; modified?: string };
export type Fetched = { url: string; status: number; body: string; memo: PageMemo; unchanged: boolean; unavailable?: boolean };

/** GUC's student portal throws a server error (500) at any request without a browser's User-Agent, so every request
 *  says it is one. */
const BROWSER = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" };
const one = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v;

export class GucClient {
  requests = 0;
  /** Session cookies per host (the portal ties its sTo bounce token to ASP.NET_SessionId), only for this client's run. */
  private cookies = new Map<string, Map<string, string>>();
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
    // A finished request hands its place straight to the next one waiting (the count stays), so a request arriving in
    // between can't take it too and run a third at once.
    if ((this.active.get(host) || 0) >= 2) await new Promise<void>((r) => this.waiting.set(host, [...(this.waiting.get(host) || []), r]));
    else this.active.set(host, (this.active.get(host) || 0) + 1);
    return () => { const next = this.waiting.get(host)?.shift(); if (next) next(); else this.active.set(host, (this.active.get(host) || 1) - 1); };
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
          const jar = this.cookies.get(new URL(url).host), cookie = jar && [...jar].map(([k, v]) => k + "=" + v).join("; ");
          const headers = { ...BROWSER, ...request.headers, ...(cookie ? { Cookie: cookie } : {}) };
          try { response = await this.http({ ...request, url, headers }, this.credentials); failure = undefined; } catch (e) { failure = e; continue; }
          this.keep(url, response.headers["set-cookie"]);
          if (response.status < 500) break;
        }
      } finally { release(); }
      if (!response) throw asGucError(failure);
      if (response.status >= 500) throw new GucError("unavailable", "http " + response.status);
      // NTLM answers a wrong password with 401. 403 is one page or file the account may not open: skipped, not a
      // reason to pause every check and ask for a new password.
      if (response.status === 401) throw new GucError("auth", "http 401");
      if (response.status === 403) throw new GucError("unavailable", "http 403");
      const location = one(response.headers.location);
      if (request.noRedirect && response.status >= 300 && response.status < 400 && response.status !== 304) throw new GucError("unavailable", "unexpected_redirect");
      if (response.status >= 300 && response.status < 400 && response.status !== 304 && location) {
        url = new URL(location, url).href;
        if (!/^https:\/\/([\w-]+\.)*guc\.edu\.eg\//.test(url)) throw new GucError("unavailable", "redirected away");
        request = { method: "GET", url, headers: request.headers, binary: request.binary };
        continue;
      }
      return { ...response, url };
    }
    throw new GucError("unavailable", "too many redirects");
  }

  private keep(url: string, set: string | string[] | undefined) {
    if (!set) return;
    const host = new URL(url).host, jar = this.cookies.get(host) || new Map<string, string>();
    for (const line of Array.isArray(set) ? set : [set]) {
      const [pair] = line.split(";"), at = pair.indexOf("=");
      if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    this.cookies.set(host, jar);
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
    return { url: res.url, status: res.status, body: res.body, memo: { hash, etag: one(res.headers.etag), modified: one(res.headers["last-modified"]) }, unchanged: hash === memo.hash };
  }
}

/** A CMS file as bytes. Only GUC's own https hosts; a login page instead of the file is a credentials failure. */
export async function fetchFile(client: GucClient, url: string) {
  if (!/^https:\/\/([\w-]+\.)*guc\.edu\.eg\//.test(url)) throw new GucError("unavailable", "not a GUC file");
  const res = await client.send({ method: "GET", url, binary: true });
  if (res.status !== 200 || !res.bytes) throw new GucError("unavailable", "http " + res.status);
  const type = (one(res.headers["content-type"]) || "").split(";")[0].trim();
  if (/text\/html/i.test(type) && pageState(new TextDecoder().decode(res.bytes.slice(0, 20000)), res.url) !== "ok") throw new GucError("auth", "login page");
  return { bytes: res.bytes, type };
}

/** A CMS file's size from a HEAD request (asked only when a size rule needs it), or undefined when GUC doesn't say. */
export async function fileSize(client: GucClient, url: string) {
  if (!/^https:\/\/([\w-]+\.)*guc\.edu\.eg\//.test(url)) return undefined;
  const res = await client.send({ method: "HEAD", url }).catch(() => undefined);
  const n = Number(res?.status === 200 ? one(res.headers["content-length"]) : NaN);
  return Number.isFinite(n) && n > 0 ? n : undefined;
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
