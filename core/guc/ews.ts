// GUC student mail over Exchange Web Services (as the Grok bot's check_mail.py reads it). Read-only except one write:
// GetFolder, FindItem and GetItem read; the only other request ever built is `markReadRequest`, an UpdateItem that sets
// message:IsRead to true on one message the person opened in the hub. Nothing here can send, move, delete, flag or mark
// a message unread. Message text is data for the person, never instructions. Pure: desktop/engine/guc-mail.ts does the I/O.
import * as cheerio from "cheerio";
import { stableId } from "./parse.ts";
import type { GucMail } from "./types.ts";

export const EWS_URL = "https://mail.guc.edu.eg/EWS/Exchange.asmx";
export const EWS_OPS = ["GetFolder", "FindItem", "GetItem"] as const;
export type EwsOp = (typeof EWS_OPS)[number];
export const PAGE = 100, BODY_BATCH = 20, PREVIEW = 300;
/** How much of a new message's body is read: its preview is the first 300 characters on one line, and a mail about one of
 *  the student's courses keeps this much for that course's deadline reader. */
export const COURSE_TEXT = 2000;
/** The most of one message's text Clem reads when the person (or the AI, for them) opens it. */
export const FULL = 60_000;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const envelope = (body: string) => `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
<soap:Header><t:RequestServerVersion Version="Exchange2013"/></soap:Header>
<soap:Body>${body}</soap:Body></soap:Envelope>`;

const soap = (op: string, body: string) => ({ headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `http://schemas.microsoft.com/exchange/services/2006/messages/${op}`, "User-Agent": "Clem-GUC-Mail/1.1" }, body: envelope(body) });
/** The request for one allowed read; anything else (a write) is refused before a byte is sent. */
export function ewsRequest(op: string, body: string) {
  if (!(EWS_OPS as readonly string[]).includes(op)) throw Error("write_operation_forbidden");
  return soap(op, body);
}

/** The one write: mark one message read, because the person opened it in the hub. Only message:IsRead, only true, only
 *  this item (its id and change key); SaveOnly, so nothing is sent or moved. */
export function markReadRequest(itemId: string, changeKey?: string) {
  if (!itemId) throw Error("no_item");
  return soap("UpdateItem", `<m:UpdateItem MessageDisposition="SaveOnly" ConflictResolution="AlwaysOverwrite">
<m:ItemChanges><t:ItemChange><t:ItemId Id="${esc(itemId)}"${changeKey ? ` ChangeKey="${esc(changeKey)}"` : ""}/>
<t:Updates><t:SetItemField><t:FieldURI FieldURI="message:IsRead"/><t:Message><t:IsRead>true</t:IsRead></t:Message></t:SetItemField></t:Updates>
</t:ItemChange></m:ItemChanges></m:UpdateItem>`);
}

/** One page of the Inbox, newest first (`oldest`: oldest first): ids, subject, sender, when, read and attachment flags,
 *  and (`to`) the names it was written to, which is how Clem tells a message for one student from one for everybody
 *  (core/guc/mail-about.ts). */
export const findInbox = (offset: number, to = true, oldest = false) => ewsRequest("FindItem", `<m:FindItem Traversal="Shallow">
<m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties>
<t:FieldURI FieldURI="item:Subject"/><t:FieldURI FieldURI="item:DateTimeReceived"/><t:FieldURI FieldURI="item:HasAttachments"/>
<t:FieldURI FieldURI="message:From"/><t:FieldURI FieldURI="message:Sender"/><t:FieldURI FieldURI="message:IsRead"/>${to ? '<t:FieldURI FieldURI="item:DisplayTo"/>' : ""}
</t:AdditionalProperties></m:ItemShape>
<m:IndexedPageItemView MaxEntriesReturned="${PAGE}" Offset="${Math.max(0, Math.floor(offset))}" BasePoint="Beginning"/>
<m:SortOrder><t:FieldOrder Order="${oldest ? "Ascending" : "Descending"}"><t:FieldURI FieldURI="item:DateTimeReceived"/></t:FieldOrder></m:SortOrder>
<m:ParentFolderIds><t:DistinguishedFolderId Id="inbox"/></m:ParentFolderIds></m:FindItem>`);

/** Plain-text bodies for some ids (only new ones), for a short preview. */
export const getBodies = (ids: string[]) => ewsRequest("GetItem", `<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:BodyType>Text</t:BodyType>
<t:AdditionalProperties><t:FieldURI FieldURI="item:Body"/></t:AdditionalProperties></m:ItemShape>
<m:ItemIds>${ids.map((id) => `<t:ItemId Id="${esc(id)}"/>`).join("")}</m:ItemIds></m:GetItem>`);

export type EwsItem = { itemId: string; /** Exchange's version of the item, which an update names. */ changeKey?: string; subject: string; received: string; from: string; read: boolean; attachments: boolean; to?: string };
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
    const changeKey = pick($, el, "ItemId").first().attr("ChangeKey");
    items.push({ itemId: id, ...(changeKey ? { changeKey } : {}), subject: pick($, el, "Subject").first().text().trim() || "(no subject)", received, from: name && email ? `${name} <${email}>` : name || email || "Unknown sender", read: /^true$/i.test(pick($, el, "IsRead").first().text().trim()), attachments: /^true$/i.test(pick($, el, "HasAttachments").first().text().trim()), ...(pick($, el, "DisplayTo").length ? { to: pick($, el, "DisplayTo").first().text().trim().slice(0, 400) } : {}) });
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

/** UpdateItem's answer: throws the error code when Exchange refused it. */
export function parseUpdate(xml: string) {
  const fault = ewsFault(xml);
  if (fault) throw new EwsError(fault);
  if (!/UpdateItemResponseMessage/.test(xml)) throw new EwsError("invalid_update_response");
}

/** A message as Clem keeps it: the EWS id only as a hash. */
export const asMail = (i: EwsItem, preview: string): GucMail => ({ id: mailId(i.itemId), from: i.from, subject: i.subject, received: i.received, preview, attachments: i.attachments, read: i.read, ...(i.to !== undefined ? { to: i.to } : {}) });
export const mailId = (itemId: string) => stableId("ews|" + itemId);
/** Error codes that mean the password is wrong. */
export const EWS_AUTH = new Set(["ErrorInvalidClientSecurityContext", "ErrorInvalidCredentials"]);
