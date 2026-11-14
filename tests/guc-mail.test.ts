import { test } from "node:test";
import assert from "node:assert/strict";
import { EWS_URL, ewsRequest, markReadRequest, parseFind } from "../core/guc/ews.ts";
import { Engine } from "../desktop/engine/index.ts";
import { runGucTool } from "../desktop/engine/ai-tools.ts";
import { fakeEws, fakeGuc, host, noWait, site } from "./guc-fake.ts";

test("the one mail write sets only IsRead to true on one message, and every other write is refused", () => {
  const { headers, body } = markReadRequest('AAMk"1', "CK1");
  assert.match(headers.SOAPAction, /\/UpdateItem$/);
  assert.match(body, /<m:UpdateItem MessageDisposition="SaveOnly" ConflictResolution="AlwaysOverwrite">/);
  assert.match(body, /<t:ItemId Id="AAMk&quot;1" ChangeKey="CK1"\/>/, "the id is escaped");
  assert.deepEqual([...body.matchAll(/FieldURI="([^"]+)"/g)].map((m) => m[1]), ["message:IsRead"], "one field, and only IsRead");
  assert.equal([...body.matchAll(/<t:SetItemField>/g)].length, 1);
  assert.match(body, /<t:IsRead>true<\/t:IsRead>/);
  assert.doesNotMatch(body, /DeleteItem|SendItem|MoveItem|CopyItem|CreateItem|DeleteItemField|AppendToItemField|SendAndSaveCopy|SendOnly/);
  assert.throws(() => markReadRequest(""), /no_item/);
  for (const op of ["UpdateItem", "DeleteItem", "SendItem", "MoveItem", "CreateItem"]) assert.throws(() => ewsRequest(op, ""), /write_operation_forbidden/, op);
  const page = `<Envelope><m:RootFolder IncludesLastItemInRange="true" IndexedPagingOffset="1"><t:Items><t:Message><t:ItemId Id="A1" ChangeKey="K9"/><t:DateTimeReceived>2026-11-01T08:00:00Z</t:DateTimeReceived></t:Message></t:Items></m:RootFolder></Envelope>`;
  assert.equal(parseFind(page).items[0].changeKey, "K9", "the change key is kept for the update (never stored)");
});

async function opened(o: { refuse?: boolean } = {}) {
  const pages = site(), updates: string[] = [];
  const inbox = [{ id: "AAMk1", subject: "Welcome back", from: "Student Affairs", at: "2026-09-01T08:00:00Z", body: "Classes start Saturday." }, { id: "AAMk2", subject: "Lab moved", from: "TA B", at: "2026-11-12T08:00:00Z", body: "Lab 3 moved to Thursday." }] as { id: string; subject: string; from: string; at: string; body?: string; read?: boolean }[];
  pages[EWS_URL] = fakeEws(inbox, { ...o, updates });
  const guc = fakeGuc(pages);
  const engine = await Engine.open("owner-mail", host(), { http: guc.http, sleep: noWait, memory: true, jobs: false });
  await engine.connect("student.name", "secret");
  return { engine, inbox, updates, close: () => engine.close() };
}

test("opening a message in the hub marks it read on GUC and here at once, and it stays read", async () => {
  const t = await opened();
  try {
    assert.equal((await t.engine.overview()).counts.mail, 2);
    const lab = (await t.engine.mail()).items.find((m) => m.subject === "Lab moved")!;
    // The hub's request passes only the id.
    const message = await t.engine.mailMessage(lab.id);
    assert.equal(message.text, "Lab 3 moved to Thursday.");
    assert.equal(message.read, true);
    assert.equal(t.updates.length, 1, "one UpdateItem");
    assert.equal(t.inbox[1].read, true, "read on Exchange");
    assert.equal(t.inbox[0].read, undefined, "the other message is untouched");
    assert.deepEqual((await t.engine.mail()).items.map((m) => [m.subject, m.read]), [["Lab moved", true], ["Welcome back", false]]);
    assert.equal((await t.engine.overview()).counts.mail, 1, "the Mail tab's count drops");
    await t.engine.sync();
    assert.equal((await t.engine.mail()).items.find((m) => m.id === lab.id)!.read, true);
    await t.engine.mailMessage(lab.id);
    assert.equal(t.updates.length, 1, "a message already read isn't written again");
  } finally { await t.close(); }
});

test("a refused update still shows the message read, through later syncs", async () => {
  const t = await opened({ refuse: true });
  try {
    const lab = (await t.engine.mail()).items.find((m) => m.subject === "Lab moved")!;
    const message = await t.engine.mailMessage(lab.id);
    assert.equal(message.text, "Lab 3 moved to Thursday.", "the message still opens");
    assert.equal(t.inbox[1].read, undefined, "GUC refused");
    assert.equal((await t.engine.mail()).items.find((m) => m.id === lab.id)!.read, true);
    await t.engine.sync();
    await t.engine.sync();
    assert.equal((await t.engine.mail()).items.find((m) => m.id === lab.id)!.read, true, "Exchange still says unread; Clem remembers the open");
    assert.equal((await t.engine.overview()).counts.mail, 1);
  } finally { await t.close(); }
});

test("the AI reading a message leaves it unread", async () => {
  const t = await opened();
  try {
    const lab = (await t.engine.mail()).items.find((m) => m.subject === "Lab moved")!;
    const text = await runGucTool({ engine: t.engine, owner: "owner-mail", subjects: [] }, { action: "guc.mail", id: lab.id }) as string;
    assert.match(text, /Lab 3 moved to Thursday\./);
    assert.equal(t.updates.length, 0, "nothing written to GUC");
    assert.equal(t.inbox[1].read, undefined);
    assert.equal((await t.engine.mail()).items.find((m) => m.id === lab.id)!.read, false);
    assert.equal((await t.engine.mailMessage(lab.id, { markRead: false })).read, false);
  } finally { await t.close(); }
});
