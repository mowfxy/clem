// Normalized GUC data (CMS + student portal), shared by the parsers, the diff and the desktop engine.

/** A course in the CMS: `key` is "<courseId>:<seasonId>", stable across syncs. */
export type GucCourse = { key: string; id: number; seasonId: number; season: string; code: string; name: string; active: boolean };
export type GucMaterial = { id: string; courseKey: string; week: string; title: string; kind: string; url: string };
export type GucAnnouncement = { id: string; courseKey: string; scope: "course" | "week"; week?: string; text: string };
export type GucWeek = { title: string; date?: string; announcement: string; description: string; materials: GucMaterial[] };
export type GucCoursePage = { courseKey: string; announcements: GucAnnouncement[]; weeks: GucWeek[]; materials: GucMaterial[] };
export type GucSlot = { id: string; day: string; period: number; start: string; end: string; code: string; name: string; type: string; group: string; location: string };
export type GucGrade = { id: string; semester: string; code: string; name: string; hours: number | null; numeric: number | null; letter: string };
export type GucDeadline = { id: string; courseKey: string; title: string; due: string; source: string };

export type GucSnapshot = {
  courses: GucCourse[];
  announcements: GucAnnouncement[];
  materials: GucMaterial[];
  slots: GucSlot[];
  grades: GucGrade[];
  deadlines: GucDeadline[];
};

export type GucEventKind = "new_grade" | "new_announcement" | "new_material" | "deadline_added" | "deadline_changed" | "schedule_changed";
/** `key` is unique per real change, so an event is never stored or notified twice. */
export type GucEvent = { kind: GucEventKind; key: string; courseKey?: string; title: string; detail: string };

export type GucErrorKind = "auth" | "site_changed" | "offline" | "unavailable";
export type GucSyncStats = { requests: number; skipped: number; changed: number; events: number; ms: number };
export type GucStatus = {
  connected: boolean;
  username?: string;
  syncing: boolean;
  lastSync?: number;
  courses: number;
  linked: number;
  stats?: GucSyncStats;
  error?: { kind: GucErrorKind; message: string };
};
export type GucProgress = { phase: "login" | "courses" | "schedule" | "grades" | "course" | "done"; done: number; total: number; label: string };

export const emptySnapshot = (): GucSnapshot => ({ courses: [], announcements: [], materials: [], slots: [], grades: [], deadlines: [] });
