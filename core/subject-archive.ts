import { z } from "zod";
import { zip, unzip, strToU8, strFromU8, type AsyncZippable } from "fflate";
import { studySchema } from "./study.ts";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  text = z.string().max(2_000_000);
const task = z.object({
  id,
  title: text,
  instructions: text,
  output: text,
  model: text,
  reasoning: z.string().optional(),
  dependsOn: z.array(id),
  status: z.enum(["pending", "running", "complete", "failed"]),
  result: text.optional(),
});
const plan = z.object({
  id,
  goal: text,
  lead: text,
  tasks: z.array(task).max(100),
  approved: z.boolean(),
  revision: z.number(),
  kind: z.enum(["long", "skill"]).optional(),
  origin: z.enum(["starter", "lead", "skill"]).optional(),
  skillId: id.optional(),
});
export const archiveSchema = z.object({
  format: z.literal("clem-subject"),
  version: z.literal(1),
  space: z.object({
    id,
    name: z.string().min(1).max(300),
    kind: z.literal("subject"),
    description: text,
    memory: text,
    sources: z.array(id),
    examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    folders: z.array(z.object({ id, name: z.string().min(1).max(80), parentId: id.nullable(), created: z.number() })).max(500).optional(),
  }),
  files: z
    .array(
      z.object({
        id,
        name: z.string().max(500),
        type: z.string().max(200),
        size: z.number().nonnegative(),
        created: z.number(),
        spaceId: id.nullable(),
        folderId: id.nullable().optional(),
      }),
    )
    .max(1000),
  chats: z
    .array(
      z.object({
        id,
        title: text,
        spaceId: id.nullable(),
        updated: z.number(),
        model: z.string().max(200).optional(),
        reasoning: z.string().max(40).optional(),
        messages: z
          .array(
            z.object({
              id,
              role: z.enum(["user", "assistant"]),
              content: text,
              visual: z.union([z.boolean(), z.string().max(40)]).optional(),
              visualParams: z.record(z.string().max(40), z.number().finite()).optional(),
              plan: plan.optional(),
              attachments: z.array(id).optional(),
              chapter: z.string().max(60).optional(),
            }),
          )
          .max(10000),
      }),
    )
    .max(1000),
  studySets: z
    .array(
      studySchema.extend({
        id,
        spaceId: id,
        chatId: id.optional(),
        kind: z.enum(["quiz", "flashcards"]),
        created: z.number(),
        attempts: z
          .array(
            z.object({
              at: z.number(),
              correct: z.number(),
              total: z.number(),
            }),
          )
          .max(10000),
        cards: z
          .array(
            z
              .object({
                due: z.number().finite(),
                stability: z.number().positive().finite(),
                difficulty: z.number().min(1).max(10),
                reps: z.number().int().nonnegative(),
                lapses: z.number().int().nonnegative(),
                last: z.number().finite(),
              })
              .nullable(),
          )
          .max(30)
          .optional(),
      }),
    )
    .max(1000),
  /** The subject's plan (core/plans.ts), checked again with readPlanBlock when it is imported. */
  spacePlan: z.unknown().optional(),
  edits: z.record(
    id,
    z.object({
      revision: z.number().int().nonnegative(),
      content: z
        .object({
          text: text.optional(),
          notes: z
            .array(z.object({ page: z.number().int().positive(), text }))
            .optional(),
          office: z
            .array(
              z.object({
                part: z.string(),
                index: z.number().int().nonnegative(),
                text,
              }),
            )
            .optional(),
        })
        .nullable(),
    }),
  ),
});
export type SubjectArchive = z.infer<typeof archiveSchema>;
/** Shared by export and import, so anything packSubject writes unpackSubject accepts. */
export const archiveLimits = {
  manifest: 20_000_000,
  file: 250_000_000,
  total: 500_000_000,
  // Total contents plus ZIP headers and worst-case deflate growth.
  archive: 510_000_000,
};
const mb = (bytes: number) => Math.round(bytes / 1_000_000) + " MB";
export async function packSubject(
  manifest: SubjectArchive,
  files: Record<string, Uint8Array>,
) {
  archiveSchema.parse(manifest);
  const json = strToU8(JSON.stringify(manifest));
  if (json.length > archiveLimits.manifest)
    throw Error(
      `This subject's chats and study data are larger than ${mb(archiveLimits.manifest)}, so it can't be archived.`,
    );
  const entries: AsyncZippable = { "subject.json": json };
  let total = json.length;
  for (const file of manifest.files) {
    if (!files[file.id]) throw Error("Missing file: " + file.name);
    if (files[file.id].length > archiveLimits.file)
      throw Error(
        `${file.name} is larger than ${mb(archiveLimits.file)}, so this subject can't be archived. Remove it from the subject first.`,
      );
    total += files[file.id].length;
    entries["files/" + file.id] = files[file.id];
  }
  if (total > archiveLimits.total)
    throw Error(
      `This subject holds more than ${mb(archiveLimits.total)} of files, so it can't be archived in one ZIP. Remove some files first.`,
    );
  const packed = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) =>
    zip(entries, { level: 1 }, (error, data) =>
      error ? reject(error) : resolve(new Uint8Array(data)),
    ),
  );
  if (packed.length > archiveLimits.archive)
    throw Error(
      `This subject's archive would be larger than ${mb(archiveLimits.archive)}. Remove some files first.`,
    );
  return packed;
}
export async function unpackSubject(bytes: Uint8Array) {
  if (bytes.length > archiveLimits.archive)
    throw Error(`Use a subject archive smaller than ${mb(archiveLimits.archive)}.`);
  let total = 0,
    rejected = false;
  const entries = await new Promise<Record<string, Uint8Array>>(
    (resolve, reject) =>
      unzip(
        bytes,
        {
          filter: (info) => {
            total += info.originalSize;
            if (
              total > archiveLimits.total ||
              info.originalSize >
                (info.name === "subject.json"
                  ? archiveLimits.manifest
                  : archiveLimits.file) ||
              (!/^files\/[a-zA-Z0-9_-]{1,100}$/.test(info.name) &&
                info.name !== "subject.json")
            ) {
              rejected = true;
              return false;
            }
            return true;
          },
        },
        (error, data) => (error ? reject(error) : resolve(data)),
      ),
  );
  if (
    rejected ||
    !entries["subject.json"] ||
    entries["subject.json"].length > archiveLimits.manifest
  )
    throw Error("This subject archive is unsupported or too large.");
  const manifest = archiveSchema.parse(
    JSON.parse(strFromU8(entries["subject.json"])),
  );
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (
      seen.has(file.id) ||
      !entries["files/" + file.id] ||
      entries["files/" + file.id].length !== file.size
    )
      throw Error("An archived file is missing or damaged.");
    seen.add(file.id);
  }
  for (const set of manifest.studySets)
    if (
      set.kind === "quiz" &&
      set.items.some(
        (x) =>
          !x.choices ||
          x.correct === undefined ||
          x.correct >= x.choices.length,
      )
    )
      throw Error("This archive contains an invalid quiz.");
  return {
    manifest,
    files: Object.fromEntries(
      manifest.files.map((f) => [f.id, entries["files/" + f.id]]),
    ),
  };
}
