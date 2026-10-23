import { unzipSync } from "fflate";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { ankiState, ankiText, answerOnly, clozeNumbers, renderTemplate, MAX_CARDS, MAX_SIDE, type ImportedCard } from "../core/flashcard-import.ts";

/**
 * Reads an Anki deck (.apkg): a zip with the collection (SQLite: collection.anki2, .anki21, or Anki 2.1.50+'s zstd
 * collection.anki21b) and its media. Cards are rendered from their note type's templates (basic, reversed, cloze and
 * custom ones) as plain text; pictures they show come along; review history is kept where it maps onto FSRS
 * (core/flashcard-import.ts ankiState). Runs in a worker thread (desktop/anki-worker.ts), never on the main thread.
 */
export const MAX_APKG = 250_000_000;
const MAX_COLLECTION = 1_000_000_000, MAX_PICTURES = 300, MAX_PICTURE_BYTES = 150_000_000, MAX_ENTRY = 50_000_000;
const PICTURE = /\.(png|jpe?g|gif|webp)$/i;
const ZSTD = (b: Uint8Array) => b.length > 4 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;
const fail = (message: string) => Object.assign(Error(message), { code: "anki" });

type Model = { cloze: boolean; fields: string[]; templates: { ord: number; q: string; a: string }[] };
export type AnkiResult = { name: string; cards: ImportedCard[]; media: { name: string; data: Uint8Array }[]; warnings: string[]; decks: number; notes: number };

/** A protobuf message's fields (number → values), enough for the configs Anki 2.1.50+ keeps as protobuf. */
function protobuf(bytes: Uint8Array) {
  const out = new Map<number, (number | Uint8Array)[]>();
  let i = 0;
  const varint = () => { let v = 0, shift = 0, b: number; do { b = bytes[i++]; v += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80 && i < bytes.length); return v; };
  while (i < bytes.length) {
    const key = varint(), field = Math.floor(key / 8), wire = key & 7;
    let value: number | Uint8Array;
    if (wire === 0) value = varint();
    else if (wire === 2) { const n = varint(); value = bytes.subarray(i, i + n); i += n; }
    else if (wire === 1) { i += 8; continue; } else if (wire === 5) { i += 4; continue; } else break;
    out.set(field, [...(out.get(field) || []), value]);
  }
  return out;
}
const text = (v: unknown) => (v instanceof Uint8Array ? new TextDecoder().decode(v) : "");

function inflate(bytes: Uint8Array, name: string) {
  if (!ZSTD(bytes)) return bytes;
  try { return new Uint8Array(zstdDecompressSync(bytes, { maxOutputLength: MAX_COLLECTION })); }
  catch { throw fail(`Part of this deck (${name}) couldn't be unpacked. It may be damaged, or too large.`); }
}

export function readApkg(bytes: Uint8Array, fileName = "Anki deck"): AnkiResult {
  if (bytes.length > MAX_APKG) throw fail("This deck is over 250 MB, too large to import.");
  let zip: Record<string, Uint8Array>;
  let expanded = 0;
  try {
    zip = unzipSync(bytes, { filter: (f) => {
      expanded += f.originalSize;
      if (expanded > MAX_COLLECTION * 1.5) throw fail("This deck unpacks to more than 1.5 GB, too large to import.");
      return /^collection\.anki2(1b?)?$|^media$|^\d{1,6}$/.test(f.name) && f.originalSize <= (f.name.startsWith("collection") ? MAX_COLLECTION : MAX_ENTRY);
    } });
  } catch (error) {
    if ((error as { code?: string }).code === "anki") throw error;
    throw fail("This isn't an Anki deck (.apkg), or the file is damaged.");
  }
  const raw = zip["collection.anki21b"] || zip["collection.anki21"] || zip["collection.anki2"];
  if (!raw) throw fail("This file has no Anki collection in it. Export the deck from Anki as an .apkg file and try again.");
  const collection = inflate(raw, "collection");
  if (new TextDecoder().decode(collection.subarray(0, 15)) !== "SQLite format 3") throw fail("This deck's collection is damaged.");
  const dir = mkdtempSync(join(tmpdir(), "clem-anki-"));
  const path = join(dir, randomBytes(6).toString("hex") + ".db");
  writeFileSync(path, collection);
  const db = new DatabaseSync(path, { readOnly: true });
  try { return readCollection(db, zip, fileName); }
  finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
}

function readCollection(db: DatabaseSync, zip: Record<string, Uint8Array>, fileName: string): AnkiResult {
  const warnings: string[] = [];
  const tables = new Set((db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((t) => t.name));
  if (!tables.has("notes") || !tables.has("cards") || !tables.has("col")) throw fail("This deck's collection is damaged.");
  const col = db.prepare("select * from col limit 1").get() as { crt: number; models?: string; decks?: string } | undefined;
  if (!col) throw fail("This deck's collection is damaged.");
  // Note types and decks: JSON in `col` before Anki 2.1.50, their own tables after.
  const models = new Map<string, Model>(), decks = new Map<string, string>();
  if (tables.has("notetypes")) {
    for (const nt of db.prepare("select id, config from notetypes").all() as { id: number | bigint; config: Uint8Array }[])
      models.set(String(nt.id), { cloze: protobuf(nt.config).get(1)?.[0] === 1, fields: [], templates: [] });
    for (const f of db.prepare("select ntid, ord, name from fields order by ntid, ord").all() as { ntid: number | bigint; ord: number; name: string }[]) models.get(String(f.ntid))?.fields.push(f.name);
    for (const t of db.prepare("select ntid, ord, config from templates order by ntid, ord").all() as { ntid: number | bigint; ord: number; config: Uint8Array }[]) {
      const config = protobuf(t.config);
      models.get(String(t.ntid))?.templates.push({ ord: t.ord, q: text(config.get(1)?.[0]), a: text(config.get(2)?.[0]) });
    }
    if (tables.has("decks")) for (const d of db.prepare("select id, name from decks").all() as { id: number | bigint; name: string }[]) decks.set(String(d.id), d.name.replace(/\x1f/g, "::"));
  } else {
    try {
      for (const [id, m] of Object.entries(JSON.parse(col.models || "{}") as Record<string, { type?: number; flds?: { name: string; ord: number }[]; tmpls?: { ord: number; qfmt: string; afmt: string }[] }>))
        models.set(id, { cloze: m.type === 1, fields: [...(m.flds || [])].sort((a, b) => a.ord - b.ord).map((f) => f.name), templates: (m.tmpls || []).map((t) => ({ ord: t.ord, q: t.qfmt || "", a: t.afmt || "" })) });
      for (const [id, d] of Object.entries(JSON.parse(col.decks || "{}") as Record<string, { name: string }>)) decks.set(id, d.name);
    } catch { throw fail("This deck's note types couldn't be read."); }
  }
  const notes = new Map<string, { mid: string; flds: string }>();
  for (const n of db.prepare("select id, mid, flds from notes").all() as { id: number | bigint; mid: number | bigint; flds: string }[]) notes.set(String(n.id), { mid: String(n.mid), flds: n.flds });
  // Anki 2.1.50+ also writes an old-format collection telling older versions to update; on its own it holds nothing to import.
  if (notes.size <= 1 && [...notes.values()].some((n) => /update to the latest Anki version/i.test(n.flds)))
    throw fail("This deck uses a newer Anki format than the file holds. In Anki, export it again with “Support older Anki versions” ticked.");
  const lastReview = new Map<string, number>();
  if (tables.has("revlog")) for (const r of db.prepare("select cid, max(id) as at from revlog group by cid").all() as { cid: number | bigint; at: number | bigint }[]) lastReview.set(String(r.cid), Number(r.at));
  const rows = db.prepare("select id, nid, did, ord, type, queue, due, ivl, reps, lapses, data from cards order by did, nid, ord").all() as { id: number | bigint; nid: number | bigint; did: number | bigint; ord: number; type: number; queue: number; due: number; ivl: number; reps: number; lapses: number; data?: string }[];

  const pictures = new Set<string>(), cards: ImportedCard[] = [], deckCount = new Map<string, number>();
  let unmapped = 0, empty = 0, dropped = 0;
  const clozeSeen = new Set<string>();
  for (const card of rows) {
    if (cards.length >= MAX_CARDS) { dropped++; continue; }
    const note = notes.get(String(card.nid)), model = note && models.get(note.mid);
    if (!note || !model) { empty++; continue; }
    const values = note.flds.split("\x1f"), fields: Record<string, string> = {};
    model.fields.forEach((name, i) => { fields[name] = values[i] ?? ""; });
    let qHtml: string, aHtml: string;
    if (model.cloze) {
      const template = model.templates[0];
      const ord = card.ord + 1, source = Object.values(fields).join(" ");
      if (!template || !clozeNumbers(source).includes(ord) || clozeSeen.has(card.nid + ":" + ord)) { empty++; continue; }
      clozeSeen.add(card.nid + ":" + ord);
      qHtml = renderTemplate(template.q, fields, { cloze: { ord, side: "q" } });
      aHtml = renderTemplate(template.a, fields, { cloze: { ord, side: "a" }, frontSide: qHtml });
    } else {
      const template = model.templates.find((t) => t.ord === card.ord);
      if (!template) { empty++; continue; }
      qHtml = renderTemplate(template.q, fields);
      aHtml = renderTemplate(template.a, fields, { frontSide: qHtml });
    }
    const question = ankiText(qHtml, pictures).slice(0, MAX_SIDE), answer = ankiText(model.cloze ? aHtml : answerOnly(aHtml, qHtml), pictures).slice(0, MAX_SIDE);
    if (!question || !answer) { empty++; continue; }
    const deck = (decks.get(String(card.did)) || "Default").split("::").at(-1)!.trim() || "Default";
    deckCount.set(deck, (deckCount.get(deck) || 0) + 1);
    const state = ankiState(card, Number(col.crt), lastReview.get(String(card.id)));
    if (!state && card.reps > 0 && card.type !== 0) unmapped++;
    cards.push({ question, answer, deck, ...(state ? { state } : {}) });
  }
  if (!cards.length) throw fail("This deck has no cards Clem can show.");
  if (unmapped) warnings.push(`${unmapped} card${unmapped === 1 ? " has" : "s have"} Anki review history that doesn't carry over to Clem's scheduler (it was made without Anki's FSRS), so ${unmapped === 1 ? "it starts" : "they start"} as new.`);
  if (empty) warnings.push(`${empty} card${empty === 1 ? " was" : "s were"} left out because ${empty === 1 ? "it has" : "they have"} no text on one side.`);
  if (dropped) warnings.push(`Only the first ${MAX_CARDS.toLocaleString("en")} cards were imported.`);

  // Pictures the cards show come along as files, named as on the cards.
  const media: AnkiResult["media"] = [];
  const wanted = [...pictures].filter((p) => PICTURE.test(p));
  if (wanted.length) {
    const entries = new Map(mediaNames(zip).map(([entry, name]) => [name, entry]));
    let bytes = 0, missing = 0, over = 0;
    for (const name of wanted) {
      const entry = entries.get(name), data = entry !== undefined ? zip[entry] : undefined;
      if (!data) { missing++; continue; }
      const file = inflate(data, name);
      if (media.length >= MAX_PICTURES || bytes + file.length > MAX_PICTURE_BYTES) { over++; continue; }
      bytes += file.length;
      media.push({ name: name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").slice(0, 160), data: file });
    }
    if (over) warnings.push(`${over} picture${over === 1 ? " was" : "s were"} left out (more than ${MAX_PICTURES} pictures or 150 MB).`);
    if (missing) warnings.push(`${missing} picture${missing === 1 ? " the cards show isn't" : "s the cards show aren't"} in the file.`);
  }
  const name = [...deckCount].sort((a, b) => b[1] - a[1])[0]?.[0] || fileName.replace(/\.apkg$/i, "");
  return { name: name === "Default" ? fileName.replace(/\.apkg$/i, "") : name, cards, media, warnings, decks: deckCount.size, notes: notes.size };
}
/** The zip's media: entry → file name. JSON before Anki 2.1.50; after, a zstd protobuf list in entry order. */
function mediaNames(zip: Record<string, Uint8Array>): [string, string][] {
  const raw = zip["media"];
  if (!raw) return [];
  const data = ZSTD(raw) ? inflate(raw, "media") : raw;
  try { return Object.entries(JSON.parse(new TextDecoder().decode(data)) as Record<string, string>).filter(([, n]) => typeof n === "string"); }
  catch { return (protobuf(data).get(1) || []).map((entry, i) => [String(i), text(protobuf(entry as Uint8Array).get(1)?.[0])] as [string, string]).filter(([, n]) => n); }
}
