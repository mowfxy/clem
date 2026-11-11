// A subject's GUC settings (the engine's subject_settings row) and the live view the cards and the subject page read.
// Patches come from cards, the subject page, Settings and the AI's settings_update blocks, and are checked here.
import { z } from "zod";
import { TZ, type HubCourse } from "./hub.ts";
import { SAVE_KINDS, defaultSaveRules, type SaveRules } from "./rules.ts";
import type { CheckSchedule } from "./schedule-rules.ts";
import type { SetupState } from "./setup-flow.ts";
import type { GucSlot } from "./types.ts";

export type DriveSettings = { enabled: boolean; folderId?: string; folderName?: string };
export type StorageSettings = { location: "device" | "vps" };
export type SubjectSettings = { save: SaveRules; check?: CheckSchedule; drive: DriveSettings; storage: StorageSettings; setup?: SetupState };
export const defaultSettings = (): SubjectSettings => ({ save: defaultSaveRules(), drive: { enabled: false }, storage: { location: "device" } });

export type SubjectLink = { subjectId: string; courseKey: string; code: string; name: string; season: string; linkedAt: number };
/** A course a sync found in a new term that no subject is linked to yet. */
export type NewCourse = { key: string; code: string; name: string; season: string };

/** What a subject's cards show, read fresh from the engine: its course, settings, next check and files kept. */
export type SubjectView = {
  subjectId: string;
  course?: HubCourse & { linkedAt: number };
  settings: SubjectSettings & { check: CheckSchedule };
  /** The check suggested from the course's lectures (what "after lectures" means here). */
  suggested: CheckSchedule;
  nextCheck?: number;
  slots: GucSlot[];
  storage: { files: number; bytes: number };
  vps: boolean;
};

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const checkSchema = z.object({ mode: z.enum(["after_lectures", "custom", "off"]), times: z.array(z.object({ day: z.number().int().min(0).max(6), time })).max(42), tz: z.string().max(60).default(TZ) });
const stepState = z.enum(["answered", "skipped"]);
export const setupSchema = z.object({ done: z.object({ link: stepState, save: stepState, check: stepState, drive: stepState, storage: stepState }).partial(), started: z.number(), finished: z.boolean().optional() });
/** A change to some settings: only the parts given change. */
export const settingsPatch = z.object({
  save: z.object({ kinds: z.object(Object.fromEntries(SAVE_KINDS.map((k) => [k, z.boolean()])) as Record<(typeof SAVE_KINDS)[number], z.ZodBoolean>).partial() }).optional(),
  check: checkSchema.optional(),
  drive: z.object({ enabled: z.boolean(), folderId: z.string().max(200), folderName: z.string().max(300) }).partial().optional(),
  storage: z.object({ location: z.enum(["device", "vps"]) }).optional(),
  setup: setupSchema.optional(),
}).strict();
export type SettingsPatch = z.infer<typeof settingsPatch>;

/** `base` with `patch` applied (deep for the rule maps, whole for the check schedule and setup). */
export function mergeSettings(base: Partial<SubjectSettings> | undefined, patch: SettingsPatch): SubjectSettings {
  const d = defaultSettings(), b = { ...d, ...base };
  return {
    ...b,
    save: { kinds: { ...d.save.kinds, ...b.save?.kinds, ...patch.save?.kinds } },
    drive: { ...b.drive, ...patch.drive },
    storage: { ...b.storage, ...patch.storage },
    ...(patch.check ? { check: patch.check as CheckSchedule } : {}),
    ...(patch.setup ? { setup: patch.setup as SetupState } : {}),
  };
}
