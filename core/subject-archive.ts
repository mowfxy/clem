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
  format: z.literal("mowr-subject"),
  version: z.literal(1),
  space: z.object({
    id,
    name: z.string().min(1).max(300),
    kind: z.literal("subject"),
    description: text,
    memory: text,
    sources: z.array(id),
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
        messages: z
          .array(
            z.object({
              id,
              role: z.enum(["user", "assistant"]),
              content: text,
              visual: z.boolean().optional(),
              plan: plan.optional(),
              attachments: z.array(id).optional(),
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
      }),
    )
    .max(1000),
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
export async function packSubject(
  manifest: SubjectArchive,
  files: Record<string, Uint8Array>,
) {
  archiveSchema.parse(manifest);
  const entries: AsyncZippable = {
    "subject.json": strToU8(JSON.stringify(manifest)),
  };
  for (const file of manifest.files) {
    if (!files[file.id]) throw Error("Missing file: " + file.name);
    entries["files/" + file.id] = files[file.id];
  }
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) =>
    zip(entries, { level: 1 }, (error, data) =>
      error ? reject(error) : resolve(new Uint8Array(data)),
    ),
  );
}
export async function unpackSubject(bytes: Uint8Array) {
  if (bytes.length > 250_000_000)
    throw Error("Use a subject archive smaller than 250 MB.");
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
              total > 500_000_000 ||
              info.originalSize > 250_000_000 ||
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
    entries["subject.json"].length > 20_000_000
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
