// A fake GUC for engine tests and scripts/verify/guc-hub.mjs: the saved pages in tests/fixtures/guc, an NTLM password
// check, ETags, files for download, and a log of every request.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { stableId, urls } from "../core/guc/parse.ts";
import type { Http } from "../desktop/engine/guc-client.ts";
import type { EngineHost } from "../desktop/engine/host.ts";

export const fixture = (name: string) => readFileSync(new URL(`./fixtures/guc/${name}.html`, import.meta.url), "utf8");
export const migrations = fileURLToPath(new URL("../desktop/engine/migrations/", import.meta.url));
export const noWait = async () => {};

export function fakeGuc(pages: Record<string, string>, o: { password?: string; domain?: string; etags?: boolean; files?: Record<string, Uint8Array> } = {}) {
  const log: { url: string; method: string; domain?: string; conditional: boolean; binary?: boolean }[] = [];
  const http: Http = async (r, c) => {
    log.push({ url: r.url, method: r.method, domain: c.domain, conditional: !!r.headers?.["If-None-Match"], binary: r.binary });
    if (c.password !== (o.password ?? "secret") || (o.domain !== undefined && c.domain !== o.domain)) return { status: 401, headers: {}, body: "<h1>401 - Unauthorized: Access is denied due to invalid credentials.</h1>" };
    const file = o.files?.[r.url];
    if (r.method === "HEAD") return file ? { status: 200, headers: { "content-length": String(file.length) }, body: "" } : { status: 404, headers: {}, body: "" };
    if (r.binary) return file ? { status: 200, headers: { "content-type": "application/pdf" }, body: "", bytes: file } : { status: 404, headers: {}, body: "", bytes: new Uint8Array() };
    const body = pages[r.url];
    if (body === undefined) return { status: 404, headers: {}, body: "Not found" };
    const etag = '"' + stableId(body) + '"';
    if (o.etags && r.headers?.["If-None-Match"] === etag) return { status: 304, headers: { etag }, body: "" };
    return { status: 200, headers: o.etags ? { etag } : {}, body };
  };
  return { http, log };
}

export function host(o: { temp?: string; files?: string; drive?: EngineHost["drive"] } = {}): EngineHost & { notices: string[]; store: Map<string, unknown>; changes: number } {
  const store = new Map<string, unknown>(), notices: string[] = [];
  return {
    store, notices,
    secrets: { get: async (k) => store.get(k) as any, set: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } },
    notify: (n) => notices.push(n.body),
    paths: { data: "", migrations, temp: o.temp, files: o.files },
    drive: o.drive,
    changes: 0,
    changed() { this.changes++; },
    log: () => {},
  };
}

export const site = () => ({
  [urls.home]: fixture("cms-home"),
  [urls.schedule]: fixture("schedule"),
  [urls.transcript]: fixture("transcript"),
  [urls.course(1201, 64)]: fixture("cms-course"),
  [urls.course(1202, 64)]: fixture("cms-course").replaceAll("900", "800").replaceAll("Embedded Systems", "Microprocessors"),
  [urls.course(1203, 64)]: fixture("cms-course").replaceAll("900", "700"),
});
