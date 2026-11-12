import test from "node:test";
import assert from "node:assert/strict";
import { planTrim, applyTrim, mainThreadSize, trimLine, messageBytes, MB, TRIM_LIMIT, TRIM_TARGET } from "../core/main-thread/trim.ts";
import type { Chat, Message, StoredFile } from "../core/types.ts";

const NOW = new Date(2026, 10, 12, 12).getTime();
const daysAgo = (n: number) => NOW - n * 864e5;
const file = (id: string, mb: number, extra: Partial<StoredFile> = {}): StoredFile => ({ id, name: id + ".pdf", size: mb * MB, type: "application/pdf", created: 0, spaceId: null, chatId: "main", ...extra });
const msg = (id: string, at: number, extra: Partial<Message> = {}): Message => ({ id, role: "user", content: "Notes for " + id, at, ...extra });
const digest = (id: string, from: number, to: number): Message => ({ id, role: "assistant", content: "Folded.", at: to, compact: true, digest: { level: "month", from, to } });
const card = (body: object) => "```clem-card\n" + JSON.stringify(body) + "\n```";

/** A main thread of about 700 MB: 60 old days with a 10 MB upload each (folded into one digest), and recent days. */
function fixture() {
  const files: StoredFile[] = [], messages: Message[] = [];
  for (let d = 100; d > 35; d--) { files.push(file("f" + d, 10, { created: daysAgo(d) })); messages.push(msg("m" + d, daysAgo(d), { attachments: ["f" + d] })); }
  messages.push(digest("dg", daysAgo(101), daysAgo(41)));
  // Recent: a big file within the last 30 days, never cut.
  files.push(file("recent", 40, { created: daysAgo(3) })); messages.push(msg("r1", daysAgo(3), { attachments: ["recent"] }));
  // Shared: a subject's file, a file another chat still uses, a library file and one in a space's sources. Old, big, never counted.
  files.push(file("subj", 200, { spaceId: "s1", chatId: undefined }), file("other", 200), file("lib", 200, { chatId: undefined }), file("src", 200));
  messages.push(msg("old-shared", daysAgo(90), { attachments: ["subj", "other", "lib", "src"] }));
  const main: Chat = { id: "main", kind: "main", title: "Clem", spaceId: null, messages: messages.sort((a, b) => a.at! - b.at!), updated: NOW };
  const other: Chat = { id: "c2", title: "Circuits", spaceId: "s1", messages: [msg("o1", daysAgo(5), { attachments: ["other"] })], updated: NOW };
  return { chats: [main, other], files, spaces: [{ id: "s1", sources: ["src"] }] };
}

test("only the main thread's own files and messages count", () => {
  const ws = fixture(), size = mainThreadSize(ws);
  assert.deepEqual(size.own.map((f) => f.id).sort(), [...Array.from({ length: 65 }, (_, i) => "f" + (36 + i)), "recent"].sort());
  assert.equal(size.files, 690 * MB);
  assert.ok(size.total > TRIM_LIMIT);
});

test("a thread over 650 MB is trimmed under it, oldest files first, without touching shared files", () => {
  const ws = fixture(), plan = planTrim(ws, NOW)!;
  assert.ok(plan, "over the cap, a plan");
  assert.ok(plan.after <= TRIM_TARGET && plan.after > TRIM_TARGET - 11 * MB, "down to about 600 MB, not further");
  assert.deepEqual(plan.files.map((f) => f.id), plan.files.map((f) => f.id).sort((a, b) => +b.slice(1) - +a.slice(1)), "oldest first");
  assert.equal(plan.files[0].id, "f100");
  for (const kept of ["recent", "subj", "other", "lib", "src"]) assert.ok(!plan.files.some((f) => f.id === kept), kept + " is never cut");
  assert.deepEqual(plan.messages, [], "files were enough");
  const main = applyTrim(ws.chats[0], plan, NOW);
  const m100 = main.messages.find((m) => m.id === "m100")!;
  assert.deepEqual(m100.attachments, []);
  assert.deepEqual(m100.removed, [{ name: "f100.pdf", size: 10 * MB, at: NOW }]);
  assert.deepEqual(main.messages.find((m) => m.id === "old-shared")!.attachments, ["subj", "other", "lib", "src"]);
  // Applied, the thread is under the cap and the next check does nothing.
  const after = { ...ws, chats: [main, ws.chats[1]], files: ws.files.filter((f) => !plan.files.includes(f)) };
  assert.ok(mainThreadSize(after).total <= TRIM_TARGET + MB);
  assert.equal(planTrim(after, NOW), null);
  assert.equal(trimLine(plan), `Cleared ${Math.round((plan.before - plan.after) / MB)} MB of old main-thread files to stay under 650 MB.`);
});

test("at or under the cap nothing is trimmed", () => {
  const ws = fixture();
  ws.files = ws.files.filter((f) => f.id !== "recent" && f.id !== "f36");
  assert.ok(mainThreadSize(ws).total < TRIM_LIMIT);
  assert.equal(planTrim(ws, NOW), null);
});

test("when files are not enough, folded old messages go; the digest, recent and unfolded ones stay", () => {
  const big = "x".repeat(2 * MB);
  const messages: Message[] = [];
  for (let d = 400; d > 50; d--) messages.push(msg("m" + d, daysAgo(d), { content: big }));
  messages.push(digest("dg", daysAgo(401), daysAgo(200)));
  const main: Chat = { id: "main", kind: "main", title: "Clem", spaceId: null, messages, updated: NOW };
  const plan = planTrim({ chats: [main], files: [] }, NOW, { limit: 650 * MB, target: 600 * MB })!;
  assert.ok(plan.before > 650 * MB);
  assert.equal(plan.files.length, 0);
  assert.ok(plan.after <= 600 * MB);
  assert.equal(plan.messages[0], "m400");
  const cut = new Set(plan.messages);
  for (const id of cut) assert.ok(+id.slice(1) > 200, "only messages a digest covers");
  const left = applyTrim(main, plan, NOW).messages;
  assert.ok(left.some((m) => m.id === "dg"), "the digest stays");
  assert.equal(left.length, messages.length - cut.size);
  assert.equal(trimLine(plan), `Cleared ${Math.round((plan.before - plan.after) / MB)} MB of old main-thread messages to stay under 650 MB.`);
});

test("only folded, old messages with no waiting card go, and a thread that can't get under stops at what it may cut", () => {
  const big = "y".repeat(5 * MB);
  const from = daysAgo(400), to = daysAgo(1);
  const messages: Message[] = [
    msg("plain", daysAgo(300), { content: big }),
    msg("undo", daysAgo(299), { role: "assistant", content: card({ type: "organizer", title: "Planned your day", lines: [] }) + big }),
    msg("watch", daysAgo(298), { role: "assistant", content: card({ type: "watch", id: "w1", text: "Tell me when" }) + big }),
    msg("confirm", daysAgo(297), { role: "assistant", content: card({ type: "vps_confirm", id: "0123456789abcdef", action: "run" }) + big }),
    msg("upcoming", daysAgo(296), { role: "assistant", content: card({ type: "reminder", title: "Lab report", due: "2026-12-01" }) + big }),
    msg("past", daysAgo(295), { role: "assistant", content: card({ type: "reminder", title: "Quiz", due: "2026-02-01" }) + big }),
    msg("brief", daysAgo(294), { role: "assistant", content: card({ type: "brief", title: "Morning", items: [] }) + big }),
    msg("unknown", daysAgo(293), { role: "assistant", content: card({ type: "something_new" }) + big }),
    msg("recent", daysAgo(10), { content: big }),
    msg("no-time", NaN, { content: big, at: undefined }),
    digest("dg", from, to),
  ];
  const main: Chat = { id: "main", kind: "main", title: "Clem", spaceId: null, messages, updated: NOW };
  const plan = planTrim({ chats: [main], files: [] }, NOW, { limit: 10 * MB, target: 1 * MB })!;
  assert.deepEqual(plan.messages.sort(), ["brief", "past", "plain"]);
  assert.ok(plan.after > 1 * MB, "stops at what it may cut");
});

test("a file used by a recent main-thread message stays, even when an old one used it first", () => {
  const ws = fixture();
  ws.chats[0].messages.push(msg("again", daysAgo(2), { attachments: ["f100"] }));
  const plan = planTrim(ws, NOW)!;
  assert.ok(!plan.files.some((f) => f.id === "f100"));
  assert.equal(plan.files[0].id, "f99");
});

test("message size is its saved bytes", () => {
  assert.equal(messageBytes(msg("a", 1, { content: "é" })), new TextEncoder().encode(JSON.stringify(msg("a", 1, { content: "é" }))).length);
});
