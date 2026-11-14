// A fake GUC for engine tests and scripts/verify/guc-hub.mjs: the saved pages in tests/fixtures/guc, an NTLM password
// check, ETags, files for download, and a log of every request.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EWS_URL } from "../core/guc/ews.ts";
import { portalUrls, stableId, urls } from "../core/guc/parse.ts";
import type { Http, HttpRequest } from "../desktop/engine/guc-client.ts";
import type { EngineHost } from "../desktop/engine/host.ts";

// Line endings are normalized: a Windows checkout turns the saved pages to CRLF, and tests edit them by LF text.
export const fixture = (name: string) => readFileSync(new URL(`./fixtures/guc/${name}.html`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
export const migrations = fileURLToPath(new URL("../desktop/engine/migrations/", import.meta.url));
export const noWait = async () => {};

/** A page is its HTML, or a function of the request (a postback, an EWS call). */
export type FakePage = string | ((r: HttpRequest) => string);
export function fakeGuc(pages: Record<string, FakePage>, o: { password?: string; domain?: string; etags?: boolean; files?: Record<string, Uint8Array> } = {}) {
  const log: { url: string; method: string; domain?: string; conditional: boolean; binary?: boolean }[] = [];
  const http: Http = async (r, c) => {
    log.push({ url: r.url, method: r.method, domain: c.domain, conditional: !!r.headers?.["If-None-Match"], binary: r.binary });
    if (c.password !== (o.password ?? "secret") || (o.domain !== undefined && c.domain !== o.domain)) return { status: 401, headers: {}, body: "<h1>401 - Unauthorized: Access is denied due to invalid credentials.</h1>" };
    const file = o.files?.[r.url];
    if (r.method === "HEAD") return file ? { status: 200, headers: { "content-length": String(file.length) }, body: "" } : { status: 404, headers: {}, body: "" };
    if (r.binary) return file ? { status: 200, headers: { "content-type": "application/pdf" }, body: "", bytes: file } : { status: 404, headers: {}, body: "", bytes: new Uint8Array() };
    // The transcript's 2024-2025 year, posted back, is a year before the student started: its dropdown and no semesters.
    if (r.url === urls.transcript && r.method === "POST" && Object.values(r.form || {}).includes("2024"))
      return { status: 200, headers: {}, body: '<html><body>Transcript<select name="ctl00$ctl00$ContentPlaceHolderright$ContentPlaceHoldercontent$stdYrLst"><option selected="selected" value="2024">2024-2025</option><option value="2025">2025-2026</option></select></body></html>' };
    const page = pages[r.url], body = typeof page === "function" ? page(r) : page;
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

/** CheckGrade_01.aspx: the midterms, and one course's coursework after its postback. `mid701`: CSEN 701's midterm. */
export const checkGrade = (o: { mid701?: string; quiz701?: string } = {}): FakePage => (r) => {
  const chosen = Object.entries(r.form || {}).find(([k]) => k.endsWith("smCrsLst"))?.[1];
  const work = chosen === "17011" ? `<table id="ContentPlaceHolderright_ContentPlaceHoldercontent_nttTr"><tr><th>Assessment</th><th>Element</th><th>Grade</th><th>Instructor</th></tr>
    <tr><td>Quiz 1</td><td>Quiz 1</td><td>${o.quiz701 ?? "8 / 10"}</td><td>Dr. A</td></tr>
    <tr><td>Assignment 1</td><td>Part A</td><td>4 / 5</td><td>Dr. A</td></tr>
    <tr><td></td><td>Part B</td><td>5 / 5</td><td>Dr. A</td></tr></table>`
    : chosen === "17021" ? `<table id="ContentPlaceHolderright_ContentPlaceHoldercontent_nttTr"><tr><th>Assessment</th><th>Element</th><th>Grade</th><th>Instructor</th></tr><tr><td>Quiz 1</td><td>Quiz 1</td><td>6 / 10</td><td></td></tr></table>` : "";
  return fixture("checkgrade").replace("{{STATE}}", chosen || "").replace("{{MID701}}", o.mid701 ?? "").replace("{{COURSEWORK}}", work);
};
export const examSeats = (hall = "C7.301") => fixture("exam-seats").replace("{{HALL}}", hall);

/** A fake Exchange: FindItem lists `inbox` (oldest first), GetItem answers bodies, UpdateItem marks a message read (and
 *  is logged in `o.updates`; `o.refuse` answers it with an error, as a server that won't take the change); any other
 *  write is a fault. */
export function fakeEws(inbox: { id: string; subject: string; from: string; at: string; body?: string; read?: boolean }[], o: { refuse?: boolean; updates?: string[] } = {}): FakePage {
  return (r) => {
    const op = /messages\/(\w+)$/.exec(r.headers?.SOAPAction || "")?.[1];
    const env = (b: string) => `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>${b}</s:Body></s:Envelope>`;
    if (op === "FindItem") {
      const order = /Order="Descending"/.test(r.body || "") ? [...inbox].reverse() : inbox;
      const offset = Number(/Offset="(\d+)"/.exec(r.body || "")?.[1] || 0), page = order.slice(offset, offset + 100), last = offset + page.length >= inbox.length;
      return env(`<m:FindItemResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><m:ResponseMessages><m:FindItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>
        <m:RootFolder IndexedPagingOffset="${offset + page.length}" TotalItemsInView="${inbox.length}" IncludesLastItemInRange="${last}"><t:Items>${page.map((m) => `<t:Message><t:ItemId Id="${m.id}" ChangeKey="x"/><t:Subject>${m.subject}</t:Subject><t:DateTimeReceived>${m.at}</t:DateTimeReceived><t:HasAttachments>false</t:HasAttachments><t:From><t:Mailbox><t:Name>${m.from}</t:Name><t:EmailAddress>${m.from.toLowerCase().replace(/\s+/g, ".")}@guc.edu.eg</t:EmailAddress></t:Mailbox></t:From><t:IsRead>${m.read ? "true" : "false"}</t:IsRead></t:Message>`).join("")}</t:Items></m:RootFolder>
        </m:FindItemResponseMessage></m:ResponseMessages></m:FindItemResponse>`);
    }
    if (op === "GetItem") {
      const ids = [...(r.body || "").matchAll(/ItemId Id="([^"]+)"/g)].map((m) => m[1]);
      return env(`<m:GetItemResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><m:ResponseMessages>${ids.map((id) => `<m:GetItemResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><m:Items><t:Message><t:ItemId Id="${id}" ChangeKey="x"/><t:Body BodyType="Text">${inbox.find((m) => m.id === id)?.body || ""}</t:Body></t:Message></m:Items></m:GetItemResponseMessage>`).join("")}</m:ResponseMessages></m:GetItemResponse>`);
    }
    if (op === "UpdateItem") {
      o.updates?.push(r.body || "");
      const id = /ItemId Id="([^"]+)"/.exec(r.body || "")?.[1], m = inbox.find((x) => x.id === id);
      const code = o.refuse ? "ErrorAccessDenied" : m ? "NoError" : "ErrorItemNotFound";
      if (code === "NoError" && /<t:IsRead>true<\/t:IsRead>/.test(r.body || "")) m!.read = true;
      return env(`<m:UpdateItemResponse xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"><m:ResponseMessages><m:UpdateItemResponseMessage ResponseClass="${code === "NoError" ? "Success" : "Error"}"><m:ResponseCode>${code}</m:ResponseCode></m:UpdateItemResponseMessage></m:ResponseMessages></m:UpdateItemResponse>`);
    }
    return env(`<s:Fault><faultstring>not allowed</faultstring></s:Fault>`);
  };
}

export const site = (): Record<string, FakePage> => ({
  [urls.home]: fixture("cms-home"),
  [urls.schedule]: fixture("schedule"),
  [urls.transcript]: fixture("transcript"),
  [urls.course(1201, 64)]: fixture("cms-course"),
  [urls.course(1202, 64)]: fixture("cms-course").replaceAll("900", "800").replaceAll("Embedded Systems", "Microprocessors"),
  [urls.course(1203, 64)]: fixture("cms-course").replaceAll("900", "700"),
  [portalUrls.grades]: checkGrade(),
  [portalUrls.exams]: examSeats(),
  [EWS_URL]: fakeEws([{ id: "AAMk1", subject: "Welcome back", from: "Student Affairs", at: "2026-09-01T08:00:00Z", body: "Classes start Saturday." }]),
});
