// A subject's GUC settings (the engine's subject_settings row) and the live view the cards and the subject page read.
// Patches come from cards, the subject page, Settings and the AI's settings_update blocks, and are checked here.
import { z } from "zod";
import { TZ, type HubCourse } from "./hub.ts";
import { aiSaveRules, applyRules, defaultSaveRules, type SaveRules } from "./rules.ts";
import type { CheckSchedule } from "./schedule-rules.ts";
import type { SetupState } from "./setup-flow.ts";
import type { GucSlot } from "./types.ts";

/** `folderId`/`folderName`: the folder the person chose; left out, copies go to Clem/GUC/<course> in My Drive. */
export type DriveSettings = { enabled: boolean; folderId?: string; folderName?: string };
export type StorageSettings = { location: "device" | "vps" };
export type SubjectSettings = { save: SaveRules; check?: CheckSchedule; drive: DriveSettings; storage: StorageSettings; setup?: SetupState };
export const defaultSettings = (): SubjectSettings => ({ save: defaultSaveRules(), drive: { enabled: false }, storage: { location: "device" } });

export type SubjectLink = { subjectId: string; courseKey: string; code: string; name: string; season: string; linkedAt: number };
/** Something a check found for a linked subject that the window hasn't shown yet: a saved file (added to the subject's
 *  Files) or news (a card in its Setup chat). Acknowledged once shown. */
export type InboxItem = {
  key: string; subjectId: string; kind: "file_saved" | "new_announcement" | "new_grade" | "deadline_added" | "deadline_changed";
  courseKey: string; title: string; detail: string; at: number;
  file?: { id: string; name: string; size: number; type: string; week?: string };
};
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
  /** The Drive copy: the folder in use (once made), files copied, waiting, and why the last copy stopped. */
  drive: { folderId?: string; path: string; copied: number; waiting: number; error?: "reconnect" | "full" | "failed"; message?: string };
  /** The last check: when, files saved, and how it went. */
  lastCheck?: { at: number; saved: number; error?: string };
};

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/), days = z.array(z.number().int().min(0).max(6)).min(1).max(7);
export const checkSchema = z.object({
  mode: z.enum(["after_lectures", "custom", "off"]), times: z.array(z.object({ day: z.number().int().min(0).max(6), time })).max(60), tz: z.string().max(60).default(TZ),
  every: z.object({ minutes: z.number().int().min(30).max(1440), from: time, to: time, days }).strict().refine((e) => e.from < e.to, "from after to").optional(),
  during: z.object({ from: ymd, to: ymd, label: z.string().max(40).optional() }).strict().refine((d) => d.from <= d.to, "from after to").optional(),
}).strict();
const stepState = z.enum(["answered", "skipped"]);
export const setupSchema = z.object({ done: z.object({ link: stepState, save: stepState, check: stepState, drive: stepState, storage: stepState }).partial(), started: z.number(), finished: z.boolean().optional() });
/** A change to some settings: only the parts given change. */
export const settingsPatch = z.object({
  save: aiSaveRules.optional(),
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
    save: applyRules(b.save || d.save, patch.save),
    drive: { ...b.drive, ...patch.drive },
    storage: { ...b.storage, ...patch.storage },
    ...(patch.check ? { check: patch.check as CheckSchedule } : {}),
    ...(patch.setup ? { setup: patch.setup as SetupState } : {}),
  };
}
