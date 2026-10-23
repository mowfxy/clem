// Builds the small Anki decks the import tests read (tests/fixtures/anki-*.apkg), table for table in Anki's own layout:
// schema 11 (what "Support older Anki versions" exports: collection.anki2, media as JSON) and schema 18 (Anki 2.1.50+:
// a zstd collection.anki21b, media as a zstd protobuf list, a stub collection.anki2 telling old versions to update).
//   node scripts/fixtures/anki-fixtures.mjs
import { DatabaseSync } from "node:sqlite";
import { zipSync, strToU8 } from "fflate";
import { zstdCompressSync } from "node:zlib";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const crt = 1_700_000_000; // the collection's creation, in seconds
const day = 86_400;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cf00000301010018dd8db00000000049454e44ae426082", "hex");
const schema11 = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);`;
const basic = { id: "1001", name: "Basic", type: 0, flds: [{ name: "Front", ord: 0 }, { name: "Back", ord: 1 }], tmpls: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}" }] };
const reversed = { id: "1002", name: "Basic (and reversed card)", type: 0, flds: [{ name: "Front", ord: 0 }, { name: "Back", ord: 1 }], tmpls: [
  { name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}" },
  { name: "Card 2", ord: 1, qfmt: "{{Back}}", afmt: "{{FrontSide}}\n\n<hr id=answer>\n\n{{Front}}" }] };
const clozeModel = { id: "1003", name: "Cloze", type: 1, flds: [{ name: "Text", ord: 0 }, { name: "Back Extra", ord: 1 }], tmpls: [{ name: "Cloze", ord: 0, qfmt: "{{cloze:Text}}", afmt: "{{cloze:Text}}<br>\n{{Back Extra}}" }] };
const models = [basic, reversed, clozeModel];
const notes = [
  { id: 1, mid: "1001", flds: ["What is the powerhouse of the cell?", "The <b>mitochondria</b>"] },
  { id: 2, mid: "1002", flds: ["osmosis", "diffusion of water across a membrane"] },
  { id: 3, mid: "1003", flds: ["{{c1::Ribosomes}} build proteins; the {{c2::Golgi apparatus::organelle}} ships them.", "Week 3"] },
  { id: 4, mid: "1001", flds: ["Label this cell:<br><img src=\"cell.png\">", "Nucleus &amp; membrane"] },
];
const cards = [
  // A review card Anki scheduled with FSRS (memory state in data), last reviewed through the revlog.
  { id: 11, nid: 1, ord: 0, type: 2, queue: 2, due: 400, ivl: 12, reps: 5, lapses: 1, data: JSON.stringify({ s: 14.2, d: 6.3, dr: 0.9 }) },
  { id: 21, nid: 2, ord: 0, type: 0, queue: 0, due: 1, ivl: 0, reps: 0, lapses: 0, data: "{}" },
  // Reviewed with SM-2 only: no FSRS memory state, so it starts as new.
  { id: 22, nid: 2, ord: 1, type: 2, queue: 2, due: 390, ivl: 8, reps: 3, lapses: 0, data: "{}" },
  { id: 31, nid: 3, ord: 0, type: 0, queue: 0, due: 2, ivl: 0, reps: 0, lapses: 0, data: "" },
  { id: 32, nid: 3, ord: 1, type: 0, queue: 0, due: 3, ivl: 0, reps: 0, lapses: 0, data: "" },
  { id: 41, nid: 4, ord: 0, type: 0, queue: 0, due: 4, ivl: 0, reps: 0, lapses: 0, data: "" },
];
const revlog = [{ id: (crt + 380 * day) * 1000, cid: 11 }, { id: (crt + 388 * day) * 1000, cid: 11 }, { id: (crt + 382 * day) * 1000, cid: 22 }];

function database(fill) {
  const dir = mkdtempSync(join(tmpdir(), "anki-fixture-")), path = join(dir, "c.db");
  const db = new DatabaseSync(path);
  db.exec(schema11);
  fill(db);
  db.close();
  const bytes = readFileSync(path);
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}
function insertCommon(db, { modelsJson, decksJson }) {
  db.prepare("insert into col values (1, ?, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')").run(crt, modelsJson, decksJson);
  for (const n of notes) db.prepare("insert into notes values (?, ?, ?, 0, 0, '', ?, 0, 0, 0, '')").run(n.id, "g" + n.id, Number(n.mid), n.flds.join("\x1f"));
  for (const c of cards) db.prepare("insert into cards values (?, ?, 1, ?, 0, 0, ?, ?, ?, ?, 2500, ?, ?, 0, 0, 0, 0, ?)").run(c.id, c.nid, c.ord, c.type, c.queue, c.due, c.ivl, c.reps, c.lapses, c.data);
  for (const r of revlog) db.prepare("insert into revlog values (?, ?, 0, 3, 1, 1, 2500, 1000, 1)").run(r.id, r.cid);
}
mkdirSync("tests/fixtures", { recursive: true });
// Schema 11: note types and decks as JSON in col.
const legacy = database((db) => insertCommon(db, {
  modelsJson: JSON.stringify(Object.fromEntries(models.map((m) => [m.id, m]))),
  decksJson: JSON.stringify({ 1: { id: 1, name: "Biology::Cells" } }),
}));
writeFileSync("tests/fixtures/anki-legacy.apkg", zipSync({ "collection.anki2": legacy, media: strToU8(JSON.stringify({ 0: "cell.png" })), 0: PNG }));

// Schema 18: note types, fields, templates and decks in their own tables, configs as protobuf.
const varint = (n) => { const out = []; do { let b = n & 0x7f; n = Math.floor(n / 128); if (n) b |= 0x80; out.push(b); } while (n); return out; };
const field = (number, value) => {
  if (typeof value === "number") return [...varint(number * 8), ...varint(value)];
  const bytes = typeof value === "string" ? [...Buffer.from(value)] : [...value];
  return [...varint(number * 8 + 2), ...varint(bytes.length), ...bytes];
};
const message = (...parts) => Buffer.from(parts.flat());
const latest = database((db) => {
  insertCommon(db, { modelsJson: "", decksJson: "" });
  db.exec(`CREATE TABLE notetypes (id integer not null primary key, name text not null, mtime_secs integer not null, usn integer not null, config blob not null);
    CREATE TABLE fields (ntid integer not null, ord integer not null, name text not null, config blob not null, primary key (ntid, ord));
    CREATE TABLE templates (ntid integer not null, ord integer not null, name text not null, mtime_secs integer not null, usn integer not null, config blob not null, primary key (ntid, ord));
    CREATE TABLE decks (id integer primary key not null, name text not null, mtime_secs integer not null, usn integer not null, common blob not null, kind blob not null);`);
  for (const m of models) {
    db.prepare("insert into notetypes values (?, ?, 0, 0, ?)").run(Number(m.id), m.name, message(field(1, m.type)));
    for (const f of m.flds) db.prepare("insert into fields values (?, ?, ?, ?)").run(Number(m.id), f.ord, f.name, Buffer.alloc(0));
    for (const t of m.tmpls) db.prepare("insert into templates values (?, ?, ?, 0, 0, ?)").run(Number(m.id), t.ord, t.name, message(field(1, t.qfmt), field(2, t.afmt)));
  }
  db.prepare("insert into decks values (1, ?, 0, 0, ?, ?)").run("Biology\x1fCells", Buffer.alloc(0), Buffer.alloc(0));
});
const stub = database((db) => {
  db.prepare("insert into col values (1, ?, 0, 0, 11, 0, 0, 0, '{}', ?, ?, '{}', '{}')").run(crt, JSON.stringify({ 1001: basic }), JSON.stringify({ 1: { name: "Default" } }));
  db.prepare("insert into notes values (1, 'g', 1001, 0, 0, '', ?, 0, 0, 0, '')").run("Please update to the latest Anki version, then import the .colpkg/.apkg file again.\x1f");
  db.prepare("insert into cards values (1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 2500, 0, 0, 0, 0, 0, 0, '')").run();
});
const mediaList = message(field(1, message(field(1, "cell.png"), field(2, PNG.length))));
writeFileSync("tests/fixtures/anki-latest.apkg", zipSync({ "collection.anki2": stub, "collection.anki21b": zstdCompressSync(latest), media: zstdCompressSync(mediaList), 0: zstdCompressSync(PNG) }));
// What an Anki 2.1.50+ export holds when only the stub can be read (as an older reader sees it).
writeFileSync("tests/fixtures/anki-stub-only.apkg", zipSync({ "collection.anki2": stub }));
writeFileSync("tests/fixtures/quizlet-tab.txt", "Mitochondria\tMake most of the cell's ATP\nRibosome\tBuilds proteins\nGolgi apparatus\tPackages and ships proteins\n");
writeFileSync("tests/fixtures/quizlet-comma.csv", 'Term,Definition\nOsmosis,"Diffusion of water, across a membrane"\n"Active ""pumping"" transport","Uses ATP\nagainst a gradient"\nDiffusion,High to low concentration\n');
console.log("wrote tests/fixtures/anki-legacy.apkg, anki-latest.apkg, anki-stub-only.apkg, quizlet-tab.txt, quizlet-comma.csv");
