// Normalized GUC data (CMS + student portal), shared by the parsers, the diff and the desktop engine.

/** A course in the CMS: `key` is "<courseId>:<seasonId>", stable across syncs. */
export type GucCourse = { key: string; id: number; seasonId: number; season: string; code: string; name: string; active: boolean };
export type GucMaterial = { id: string; courseKey: string; week: string; title: string; kind: string; url: string };
export type GucAnnouncement = { id: string; courseKey: string; scope: "course" | "week"; week?: string; text: string };
export type GucWeek = { title: string; date?: string; announcement: string; description: string; materials: GucMaterial[] };
export type GucCoursePage = { courseKey: string; announcements: GucAnnouncement[]; weeks: GucWeek[]; materials: GucMaterial[] };
export type GucSlot = { id: string; day: string; period: number; start: string; end: string; code: string; name: string; type: string; group: string; location: string };
export type GucGrade = { id: string; semester: string; code: string; name: string; hours: number | null; numeric: number | null; letter: string; /** The study year it was read from ("2025-2026"). */ year?: string };
export type GucDeadline = { id: string; courseKey: string; title: string; due: string; source: string };
/** This term's grades from the portal's CheckGrade page: midterms, and each course's coursework (quizzes, assignments). */
export type GucMidterm = { id: string; course: string; code: string; grade: string };
export type GucCoursework = { id: string; course: string; code: string; entries: { name: string; elements: { name: string; grade: string; professor: string }[] }[] };
/** An exam seat from ViewExamSeat_01.aspx. */
export type GucExam = { id: string; course: string; code: string; day: string; date: string; start: string; end: string; hall: string; seat: string; type: string };
/** A GUC Inbox message, read-only (Exchange Web Services). `id` is a hash of the EWS ItemId, never the id itself. */
export type GucMail = { id: string; from: string; subject: string; received: string; preview: string; attachments: boolean; read: boolean; /** Its body was read once (an empty preview is then an empty message). */ previewed?: boolean };

export type GucSnapshot = {
  courses: GucCourse[];
  announcements: GucAnnouncement[];
  materials: GucMaterial[];
  slots: GucSlot[];
  grades: GucGrade[];
  deadlines: GucDeadline[];
  /** Added later: older snapshots may not have them (read with `?? []`). */
  midterms?: GucMidterm[];
  coursework?: GucCoursework[];
  exams?: GucExam[];
  mail?: GucMail[];
};

export type GucEventKind = "new_grade" | "new_announcement" | "new_material" | "deadline_added" | "deadline_changed" | "schedule_changed" | "new_course" | "exam_posted" | "new_mail";
/** `key` is unique per real change, so an event is never stored or notified twice. */
export type GucEvent = { kind: GucEventKind; key: string; courseKey?: string; title: string; detail: string };

export type GucErrorKind = "auth" | "site_changed" | "offline" | "unavailable";
export type GucSyncStats = { requests: number; skipped: number; changed: number; events: number; ms: number; /** Parts this sync couldn't read ("schedule", "mail"), so the hub can say so. */ missed?: string[] };
export type GucStatus = {
  connected: boolean;
  username?: string;
  syncing: boolean;
  lastSync?: number;
  courses: number;
  linked: number;
  stats?: GucSyncStats;
  error?: { kind: GucErrorKind; message: string };
  /** GUC stopped accepting the password: its checks are paused until a new one is entered (core/guc/password.ts). */
  passwordNeeded?: boolean;
};
export type GucProgress = { phase: "login" | "courses" | "schedule" | "grades" | "exams" | "mail" | "course" | "done"; done: number; total: number; label: string };

export const emptySnapshot = (): GucSnapshot => ({ courses: [], announcements: [], materials: [], slots: [], grades: [], deadlines: [], midterms: [], coursework: [], exams: [], mail: [] });
