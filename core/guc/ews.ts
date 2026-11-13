// GUC student mail, read-only, over Exchange Web Services (as the Grok bot's check_mail.py reads it). Only GetFolder,
// FindItem and GetItem are ever built: nothing here can send, move, delete or mark a message read. Message text is
// data for the person, never instructions. Pure: the engine (desktop/engine/guc-mail.ts) does the I/O.
import * as cheerio from "cheerio";
import { stableId } from "./parse.ts";
import type { GucMail } from "./types.ts";

export const EWS_URL = "https://mail.guc.edu.eg/EWS/Exchange.asmx";
export const EWS_OPS = ["GetFolder", "FindItem", "GetItem"] as const;
export type EwsOp = (typeof EWS_OPS)[number];
export const PAGE = 100, BODY_BATCH = 20, PREVIEW = 300;
/** The most of one message's text Clem reads when the person (or the AI, for them) opens it. */
export const FULL = 60_000;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const envelope = (body: string) => `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
<soap:Header><t:RequestServerVersion Version="Exchange2013"/></soap:Header>
<soap:Body>${body}</soap:Body></soap:Envelope>`;

/** The request for one allowed operation; anything else is refused before a byte is sent. */
export function ewsRequest(op: string, body: string) {
  if (!(EWS_OPS as readonly string[]).includes(op)) throw Error("write_operation_forbidden");
  return { headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `http://schemas.microsoft.com/exchange/services/2006/messages/${op}`, "User-Agent": "Clem-GUC-Mail-ReadOnly/1.0" }, body: envelope(body) };
}

/** One page of the Inbox, oldest first: ids, subject, sender, when, read and attachment flags. */
export const findInbox = (offset: number) => ewsRequest("FindItem", `<m:FindItem Traversal="Shallow">
<m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>
<t:FieldURI FieldURI="item:Subject"/><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURI FieldURI="item:HasAttachments"/>
<t:FieldURI FieldURI="message:From"/><t:FieldURI FieldURI="message:Sender"/><t:FieldURI FieldURI="message:IsRead"/>
</t:AdditionalProperties></m:ItemShape>
<m:IndexedPageItemView MaxEntriesReturned="${PAGE}" Offset="${Math.max(0, Math.floor(offset))}" BasePoint="Beginning"/>
<m:SortOrder><t:FieldOrder Order="Ascending"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder>
<m:ParentFolderIds><t:DistinguishedFolderId Id="inbox"/></m:ParentFolderIds></m:FindItem>`);

/** Plain-text bodies for some ids (only new ones), for a short preview. */
export const getBodies = (ids: string[]) => ewsRequest("GetItem", `<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:BodyType>Text</t:BodyType>
<t:AdditionalProperties><t:FieldURI FieldURI="item:Body"/></t:AdditionalProperties></m:ItemShape>
<m:ItemIds>${ids.map((id) => `<t:ItemId Id="${esc(id)}"/>`).join("")}</m:ItemIds></m:GetItem>`);

export type EwsItem = { itemId: string; subject: string; received: string; from: string; read: boolean; attachments: boolean };
export class EwsError extends Error { code: string; constructor(code: string) { super(code); this.name = "EwsError"; this.code = code; } }

const $x = (xml: string) => cheerio.load(xml, { xml: { xmlMode: true, decodeEntities: true } });
/** Children named `name` whatever their namespace prefix ("t:Subject" is Subject). */
const pick = ($: cheerio.CheerioAPI, el: Parameters<cheerio.CheerioAPI>[0], name: string) => $(el).find("*").filter((_, n) => (n as { name?: string }).name?.replace(/^\w+:/, "") === name);

/** An EWS fault or error response code, as one short code. */
export function ewsFault(xml: string) {
  const $ = $x(xml);
  const code = $("*").filter((_, n) => /(^|:)ResponseCode$/.test((n as { name?: string }).name || "")).toArray().map((n) => $(n).text().trim()).find((c) => c && c !== "NoError");
  if (code) return code;
  const fault = $("*").filter((_, n) => /(^|:)faultstring$/i.test((n as { name?: string }).name || "")).first().text().trim();
  return fault ? "soap_fault" : undefined;
}

/** A FindItem page: its messages and whether it was the last page. */
export function parseFind(xml: string): { items: EwsItem[]; last: boolean; next: number } {
  const fault = ewsFault(xml);
  if (fault) throw new EwsError(fault);
  const $ = $x(xml);
  const root = $("*").filter((_, n) => /(^|:)RootFolder$/.test((n as { name?: string }).name || "")).first();
  if (!root.length) throw new EwsError("invalid_pagination");
  const last = /^true$/i.test(root.attr("IncludesLastItemInRange") || "");
  const next = Number(root.attr("IndexedPagingOffset") || NaN);
  const items: EwsItem[] = [];
  root.children().children().each((_, el) => {
    const id = pick($, el, "ItemId").first().attr("Id");
    const received = pick($, el, "DateTimeReceived").first().text().trim();
    if (!id || !received) return;
    const box = (pick($, el, "From").length ? pick($, el, "From") : pick($, el, "Sender")).first();
    const name = pick($, box, "Name").first().text().trim(), email = pick($, box, "EmailAddress").first().text().trim();
    items.push({ itemId: id, subject: pick($, el, "Subject").first().text().trim() || "(no subject)", received, from: name && email ? `${name} <${email}>` : name || email || "Unknown sender", read: /^true$/i.test(pick($, el, "IsRead").first().text().trim()), attachments: /^true$/i.test(pick($, el, "HasAttachments").first().text().trim()) });
  });
  return { items, last, next: Number.isFinite(next) ? next : NaN };
}

/** GetItem bodies → id → the text, whitespace collapsed, cut at `max` (a 300-character preview by default). */
export function parseBodies(xml: string, max = PREVIEW) {
  const fault = ewsFault(xml);
  if (fault) throw new EwsError(fault);
  const $ = $x(xml), out = new Map<string, string>();
  $("*").filter((_, n) => /(^|:)(Message|Item|MeetingRequest|MeetingCancellation|MeetingResponse|PostItem)$/.test((n as { name?: string }).name || "")).each((_, el) => {
    const id = pick($, el, "ItemId").first().attr("Id"), body = pick($, el, "Body").first().text();
    // A preview is one line; the full text keeps its paragraphs.
    if (id) out.set(id, max > PREVIEW ? body.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : body.replace(/\s+/g, " ").trim().slice(0, max));
  });
  return out;
}

/** A message as Clem keeps it: the EWS id only as a hash. */
export const asMail = (i: EwsItem, preview: string): GucMail => ({ id: mailId(i.itemId), from: i.from, subject: i.subject, received: i.received, preview, attachments: i.attachments, read: i.read });
export const mailId = (itemId: string) => stableId("ews|" + itemId);
/** Error codes that mean the password is wrong. */
export const EWS_AUTH = new Set(["ErrorInvalidClientSecurityContext", "ErrorInvalidCredentials"]);
