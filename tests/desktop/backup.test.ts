import { test } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDue, expired, extractBackup, previewBackup, readHeader, safeEntryName } from "../../desktop/backup.ts";
import { BackupService, type DriveBackups } from "../../desktop/backup-service.ts";

const OWNER = "owner-1";
const workspace = {
  name: "Sam", memory: "", quiet: false, skills: [], visuals: [],
  spaces: [{ id: "bio", name: "Biology 101", kind: "subject", memory: "", sources: ["f1"], folders: [{ id: "w", name: "Worksheets", parentId: null, created: 1 }] }],
  files: [{ id: "f1", name: "Notes.pdf", size: 5, type: "application/pdf", created: 1, spaceId: "bio", folderId: "w" }, { id: "f2", name: "Lab.docx", size: 3, type: "application/octet-stream", created: 2, spaceId: "bio" }],
  chats: [{ id: "c1", title: "Osmosis", spaceId: "bio", updated: 3, messages: [{ id: "m1", role: "user", content: "Why?" }, { id: "m2", role: "assistant", content: "Because." }] }],
  studySets: [{ id: "s1", spaceId: "bio", kind: "flashcards", title: "Cells", created: 1, attempts: [{ at: 5, correct: 1, total: 2 }], items: [{ question: "ATP?", answer: "Mitochondria" }, { question: "Proteins?", answer: "Ribosomes" }],
    cards: [{ due: 1_800_000_000_000, stability: 4.2, difficulty: 5.1, reps: 3, lapses: 1, last: 1_700_000_000_000 }, null] }],
  automations: [{ id: "a1", name: "Weekly recap", prompt: "Recap the week", schedule: "weekly", enabled: true, spaceId: "bio" }],
};
const edits: [string, unknown][] = [["clem-document-f2", { revision: 2, content: { text: "edited" } }], [`clem-workflow:${OWNER}:plan1`, { signature: "x", tasks: [], updatedAt: 1 }]];

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "clem-backup-test-"));
  const account = join(root, "Accounts", OWNER);
  await mkdir(join(account, "Files"), { recursive: true });
  await writeFile(join(account, "workspace.json"), JSON.stringify(workspace));
  await writeFile(join(account, "Files", "f1.blob"), Buffer.from("%PDF1"));
  // A file bigger than one encrypted chunk, so the body spans several.
  const big = Buffer.alloc(2_600_000);
  for (let i = 0; i < big.length; i++) big[i] = (i * 7919) % 251;
  await writeFile(join(account, "Files", "f2.blob"), big);
  const store = new Map<string, unknown>();
  const idb = { entries: new Map(edits) };
  let reloads = 0;
  const drive = new Map<string, { name: string; bytes: Buffer; trashed?: boolean }>();
  const fakeDrive: DriveBackups = {
    connected: async () => true,
    backupFolder: async () => "folder-clem-backups",
    backupFiles: async () => [...drive].filter(([, f]) => !f.trashed).map(([id, f]) => ({ id, name: f.name, size: f.bytes.length, at: 0 })),
    uploadFile: async (_folder, name, path) => { const id = "drive-file-" + drive.size.toString().padStart(4, "0"); drive.set(id, { name, bytes: await readFile(path) }); return { id }; },
    downloadFile: async (id, path) => writeFile(path, drive.get(id)!.bytes),
    trash: async (id) => { drive.get(id)!.trashed = true; },
  };
  const service = new BackupService({
    vault: { read: async (k, f) => (store.has(k) ? structuredClone(store.get(k)) : f) as any, write: async (k, v) => { store.set(k, structuredClone(v)); } },
    root, temp: join(root, "temp"), app: "0.0.0-test", drive: fakeDrive,
    edits: { read: async () => [...idb.entries], write: async (_owner, entries) => { idb.entries = new Map(entries); } },
    reload: () => { reloads++; },
  });
  return { root, account, service, idb, drive, state: () => ({ held: service.restoring, reloads }), big };
}
const read = async (account: string) => ({ workspace: JSON.parse(await readFile(join(account, "workspace.json"), "utf8")), f1: await readFile(join(account, "Files", "f1.blob")), f2: await readFile(join(account, "Files", "f2.blob")) });

test("a backup restores the whole workspace after the profile is wiped: chats, files, folders, cards with their review state, routines and edits", async () => {
  const { root, account, service, idb, state, big } = await setup();
  try {
    const target = join(root, "OneDrive", "Clem backups");
    await assert.rejects(service.backupNow(OWNER), /Choose where/);
    await assert.rejects(service.configure(OWNER, { passphrase: "short" }), /at least 8/);
    await assert.rejects(service.configure(OWNER, { destination: { kind: "folder", path: join(account, "Files") } }), /outside/);
    await service.configure(OWNER, { destination: { kind: "folder", path: target }, passphrase: "correct horse battery", schedule: "daily", keep: 3 });
    const made = await service.backupNow(OWNER);
    assert.equal(made.summary.chats, 1);
    assert.equal(made.summary.cards, 2);
    assert.equal(made.summary.reviewed, 1);
    assert.equal(made.summary.edits, 2);
    assert.ok((await service.status(OWNER)).last?.at);
    // Nothing readable in the file without the passphrase: not a chat's words, not a file's bytes.
    const raw = await readFile(made.path);
    assert.equal(raw.includes(Buffer.from("Osmosis")), false);
    assert.equal(raw.includes(Buffer.from("%PDF1")), false);
    assert.equal((await readHeader(made.path)).header.kind, "manual");

    // The PC dies: a fresh profile has nothing.
    await rm(join(root, "Accounts"), { recursive: true, force: true });
    idb.entries.clear();
    const [item] = await service.list(OWNER);
    assert.equal(item.source, "folder");
    const preview = await service.preview(OWNER, item as any, "correct horse battery");
    assert.equal(preview.summary.files, 2);
    assert.equal(preview.current.empty, true);
    await assert.rejects(service.preview(OWNER, item as any, "wrong passphrase!"), /passphrase/);

    // An empty workspace is restored without asking.
    const done = await service.restore(OWNER, item as any, "correct horse battery", false);
    assert.equal("restored" in done && done.restored, true);
    const back = await read(account);
    assert.deepEqual(back.workspace, workspace);
    assert.deepEqual(back.f1, Buffer.from("%PDF1"));
    assert.ok(back.f2.equals(big));
    assert.deepEqual([...idb.entries], edits);
    assert.equal(state().reloads, 1);
    assert.equal(state().held, true, "saving waits until the window has reloaded the restored workspace");
    service.reloaded();
    assert.equal(state().held, false);
    assert.equal((await readdir(join(root, "Accounts"))).length, 1, "no staging or replaced folders are left behind");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("restoring over work asks first, keeps a copy of it, and a wrong or damaged backup changes nothing", async () => {
  const { root, account, service } = await setup();
  try {
    const target = join(root, "Backups elsewhere");
    await service.configure(OWNER, { destination: { kind: "folder", path: target }, passphrase: "correct horse battery" });
    const made = await service.backupNow(OWNER);
    const changed = { ...workspace, chats: [...workspace.chats, { id: "c2", title: "Newer chat", spaceId: null, updated: 9, messages: [] }] };
    await writeFile(join(account, "workspace.json"), JSON.stringify(changed));
    const item = { source: "folder" as const, path: made.path };

    const asked = await service.restore(OWNER, item, undefined, false);
    assert.equal("confirm" in asked && asked.confirm, true);
    assert.equal((asked as any).current.chats, 2);
    assert.equal(JSON.parse(await readFile(join(account, "workspace.json"), "utf8")).chats.length, 2, "nothing changes before the person confirms");

    // A changed byte in the body: refused before the workspace is touched.
    const broken = join(target, "Clem backup 2020-01-01 0000.clembackup");
    const bytes = await readFile(made.path);
    bytes[bytes.length - 40] ^= 1;
    await writeFile(broken, bytes);
    await assert.rejects(service.restore(OWNER, { source: "folder", path: broken }, undefined, true), /damaged|passphrase/);
    // Cut short.
    await writeFile(broken, (await readFile(made.path)).subarray(0, 4000));
    await assert.rejects(service.restore(OWNER, { source: "folder", path: broken }, undefined, true), /damaged|incomplete|passphrase/);
    assert.equal(JSON.parse(await readFile(join(account, "workspace.json"), "utf8")).chats.length, 2);
    assert.deepEqual(await readdir(join(root, "Accounts")), [OWNER]);
    // Only folders the person chose are read.
    await copyFile(made.path, join(root, "Clem backup 2020-01-01 0000.clembackup"));
    await assert.rejects(service.preview(OWNER, { source: "folder", path: join(root, "Clem backup 2020-01-01 0000.clembackup") }), /Pick that folder/);

    const done = await service.restore(OWNER, item, undefined, true);
    assert.ok("safety" in done && done.safety);
    assert.deepEqual(JSON.parse(await readFile(join(account, "workspace.json"), "utf8")), workspace);
    service.reloaded();
    // The copy made before restoring holds the newer chat, and can itself be restored.
    const safety = (await service.list(OWNER)).find((b) => b.name.startsWith("Clem before restore"))!;
    assert.equal((await service.preview(OWNER, safety as any)).summary.chats, 2);
    const dir = join(root, "check");
    await extractBackup((safety as any).path, "correct horse battery", dir);
    assert.equal(JSON.parse(await readFile(join(dir, "account", "workspace.json"), "utf8")).chats[1].title, "Newer chat");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("backups to Google Drive upload, list, restore and keep only the newest", async () => {
  const { root, account, service, drive } = await setup();
  try {
    await service.configure(OWNER, { destination: { kind: "drive" }, passphrase: "correct horse battery", keep: 2 });
    for (let i = 0; i < 3; i++) await service.backupNow(OWNER);
    assert.equal([...drive.values()].filter((f) => !f.trashed).length, 2);
    assert.equal([...drive.values()].filter((f) => f.trashed).length, 1, "old backups go to Drive's trash, not deleted for good");
    const items = await service.list(OWNER);
    assert.equal(items.length, 2);
    await rm(join(root, "Accounts"), { recursive: true, force: true });
    await service.restore(OWNER, items[0] as any, undefined, false);
    assert.deepEqual((await read(account)).workspace, workspace);
    assert.equal((await readdir(join(root, "temp"))).filter((n) => n.startsWith("upload-")).length, 0, "the upload copy is removed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a local folder keeps the newest backups; the schedule and entry names", async () => {
  const { root, service } = await setup();
  try {
    const target = join(root, "Dropbox");
    await service.configure(OWNER, { destination: { kind: "folder", path: target }, passphrase: "correct horse battery", keep: 2 });
    for (let i = 0; i < 3; i++) await service.backupNow(OWNER);
    assert.equal((await readdir(target)).length, 2);
    const { summary } = await previewBackup(join(target, (await readdir(target))[0]), "correct horse battery");
    assert.equal(summary.automations, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
  const day = 86_400_000, now = Date.UTC(2026, 9, 23, 9);
  assert.equal(backupDue("off", undefined, now), false);
  assert.equal(backupDue("daily", undefined, now), true);
  assert.equal(backupDue("daily", { at: now - day + 2 * 3_600_000 }, now), false);
  assert.equal(backupDue("daily", { at: now - day + 1_800_000 }, now), true, "an hour early still counts, so a PC opened each morning backs up daily");
  assert.equal(backupDue("weekly", { at: now - 3 * day }, now), false);
  assert.equal(backupDue("weekly", { at: now - 7 * day }, now), true);
  assert.equal(backupDue("daily", { at: now - 3 * day, tried: now - 600_000 }, now), false, "a failed try waits an hour");
  assert.deepEqual(expired([{ name: "Clem backup 2026-01-01 0000.clembackup", at: 1 }, { name: "Clem backup 2026-01-02 0000.clembackup", at: 2 }, { name: "Clem before restore 2026-01-01 0000.clembackup", at: 3 }], 1).map((x) => x.at), [1]);
  for (const bad of ["../x", "a/../b", "C:/x", "a\\b", "", "a//b", "con."]) assert.equal(safeEntryName(bad), false, bad);
  assert.equal(safeEntryName("account/Files/abc.blob"), true);
});
