import { z } from "zod";
import { zip, unzip, strToU8, strFromU8, type AsyncZippable } from "fflate";
import { studySchema } from "./study.ts";

/**
 * A study pack is the shareable part of a subject: flashcards, quizzes and optionally the
 * source files. It never carries chats, memory, review history or anything about the sender
 * beyond the name they choose to show.
 */
export const PACK_EXTENSION = ".clempack";
const MAX_FILE = 25_000_000, MAX_TOTAL = 100_000_000;
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const packSchema = z.object({
  format: z.literal("clem-study-pack"),
  version: z.literal(1),
  title: z.string().trim().min(1).max(150),
  description: z.string().max(2000),
  author: z.string().trim().max(80).optional(),
  created: z.number().int().nonnegative(),
  sets: z.array(studySchema.extend({ kind: z.enum(["quiz", "flashcards"]) })).max(50),
  /** `folder` is the file's folder path inside the subject, such as "Worksheets/Week 2". */
  files: z.array(z.object({ id, name: z.string().min(1).max(300), type: z.string().max(200), size: z.number().int().nonnegative().max(MAX_FILE), folder: z.string().max(300).optional() })).max(60),
});
export type StudyPack = z.infer<typeof packSchema>;

const readme = (pack: StudyPack) => `${pack.title}
${"=".repeat(Math.min(60, pack.title.length))}

A Clem study pack${pack.author ? " shared by " + pack.author : ""}.
${[pack.sets.length ? `${cardCount(pack)} cards and questions` : "", pack.files.length ? `${pack.files.length} file${pack.files.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ")}.

Open this file with Clem (free for Windows at https://clem.m4labs.xyz) to study it with
spaced repetition. Clem checks the pack before adding anything to your subjects.
`;

export const cardCount = (pack: Pick<StudyPack, "sets">) => pack.sets.reduce((n, s) => n + s.items.length, 0);

function validQuizzes(pack: StudyPack) {
  for (const set of pack.sets)
    if (set.kind === "quiz" && set.items.some((x) => !x.choices || x.correct === undefined || x.correct >= x.choices.length))
      throw Error("This study pack contains an incomplete quiz.");
}

function nonEmpty(pack: StudyPack) {
  if (!pack.sets.length && !pack.files.length) throw Error("Choose something to share.");
}

export async function packStudy(pack: StudyPack, files: Record<string, Uint8Array> = {}) {
  const manifest = packSchema.parse(pack);
  nonEmpty(manifest);
  validQuizzes(manifest);
  let total = 0;
  const entries: AsyncZippable = { "pack.json": strToU8(JSON.stringify(manifest)), "README.txt": strToU8(readme(manifest)) };
  for (const file of manifest.files) {
    const bytes = files[file.id];
    if (!bytes || bytes.length !== file.size) throw Error("Missing file: " + file.name);
    total += bytes.length;
    entries["files/" + file.id] = bytes;
  }
  if (total > MAX_TOTAL) throw Error("Study packs hold up to 100 MB of files. Leave out some sources.");
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) =>
    zip(entries, { level: 6 }, (error, data) => (error ? reject(error) : resolve(new Uint8Array(data)))));
}

/** Reads a pack from someone else. Everything is treated as untrusted and bounded. */
export async function unpackStudy(bytes: Uint8Array) {
  if (bytes.length > MAX_TOTAL + 5_000_000) throw Error("This study pack is too large.");
  let total = 0, rejected = false;
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(bytes, {
      filter: (info) => {
        total += info.originalSize;
        const allowed = info.name === "pack.json" || info.name === "README.txt" || /^files\/[a-zA-Z0-9_-]{1,100}$/.test(info.name);
        if (!allowed || total > MAX_TOTAL + 1_000_000 || info.originalSize > MAX_FILE) { rejected = true; return false; }
        return info.name !== "README.txt";
      },
    }, (error, data) => (error ? reject(Error("This is not a Clem study pack.")) : resolve(data))));
  if (rejected || !entries["pack.json"] || entries["pack.json"].length > 5_000_000) throw Error("This study pack is unsupported, damaged or too large.");
  let raw: unknown;
  try { raw = JSON.parse(strFromU8(entries["pack.json"])); } catch { throw Error("This study pack is damaged."); }
  const parsed = packSchema.safeParse(raw);
  if (!parsed.success) throw Error("This study pack is from a newer Clem or is damaged.");
  const pack = parsed.data;
  nonEmpty(pack);
  validQuizzes(pack);
  const seen = new Set<string>();
  for (const file of pack.files) {
    const data = entries["files/" + file.id];
    if (seen.has(file.id) || !data || data.length !== file.size) throw Error("A file in this study pack is missing or damaged.");
    seen.add(file.id);
  }
  return { pack, files: Object.fromEntries(pack.files.map((f) => [f.id, entries["files/" + f.id]])) as Record<string, Uint8Array> };
}

export const packFileName = (title: string) => (title.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim().slice(0, 80) || "Study pack") + PACK_EXTENSION;
