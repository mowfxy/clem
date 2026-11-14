import {syncSchemas} from "../core/sync.ts";
import { z } from "zod";
import { settingsPatch } from "../core/guc/settings.ts";
import { proPatch } from "../core/proactivity/settings.ts";
import { vpsHostOk, vpsUserOk } from "../core/vps/types.ts";
/** A Telegram message, or a tap that needs the agent or the workspace, for the main thread to answer. */
export type TelegramTurn = { id: string; text: string } | { id: string; tap: import("../core/telegram/render.ts").Tap };

export type FolderDelta = { added: string[]; changed: string[]; removed: string[] };
export type FolderEvent = FolderDelta & { folderId: string; scope: string; folder: string };

export const scopeSchema = z
  .string()
  .regex(/^(chat|project|subject|user):[a-zA-Z0-9_-]{1,100}$/);
/** A backup to preview or restore (desktop/backup-service.ts): a file in a folder the person chose, or one in Drive. */
const backupItem = z.union([z.object({ source: z.literal("folder"), path: z.string().min(3).max(1000) }), z.object({ source: z.literal("drive"), id: z.string().regex(/^[\w-]{10,150}$/) })]);
/** A CMS course key ("<courseId>:<seasonId>") and a GUC row id. */
const proKey = z.string().min(1).max(300);
const gucCourse = z.string().regex(/^\d{1,10}:\d{1,10}$/), gucId = z.string().regex(/^[\w-]{1,100}$/);
export const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("supportSend"), category:z.enum(["Contact support","Report a bug","Suggest a feature"]), subject:z.string().trim().min(1).max(150), message:z.string().trim().min(10).max(10000), diagnostics:z.boolean().optional() }),
  z.object({ action: z.literal("supportCases") }),
  z.object({ action: z.literal("supportReply"), id:z.string().regex(/^[\w-]{8,64}$/), body:z.string().trim().min(2).max(10000) }),
  z.object({ action: z.literal("supportSeen"), id:z.string().regex(/^[\w-]{8,64}$/) }),
  z.object({ action: z.literal("announcements") }),
  z.object({action:z.literal("essentialSync"),skills:syncSchemas.skills,notes:syncSchemas.notes,noBaseline:z.boolean().optional()}),
  z.object({ action: z.literal("browserLogin") }),
  // GUC (desktop/engine): the password goes straight to the Vault and is never sent back.
  z.object({ action: z.literal("gucConnect"), username: z.string().trim().regex(/^(guc\\)?[\w.@-]{2,80}$/i, "Enter your GUC username."), password: z.string().min(1).max(200) }),
  z.object({ action: z.literal("gucStatus") }),
  // A new password after GUC stopped accepting the old one (docs/GUC-VPS-ENGINE.md "Password expiry"); never sent back.
  z.object({ action: z.literal("gucPassword"), password: z.string().min(1).max(200) }),
  z.object({ action: z.literal("gucSync") }),
  // The VPS connector (desktop/engine/vps): keys and passwords go to the Vault and never come back.
  z.object({ action: z.literal("vpsStatus") }),
  z.object({ action: z.literal("vpsSetup"), host: z.string().trim().min(1).max(253).refine(vpsHostOk, "Enter the server's address, like 203.0.113.5 or vps.example.com."), port: z.number().int().min(1).max(65535), user: z.string().trim().refine(vpsUserOk, "Enter the user name you sign in with on the server."), auth: z.enum(["key", "password"]), password: z.string().min(1).max(200).optional(), allowPassword: z.boolean().optional() }),
  z.object({ action: z.literal("vpsGenerateKey") }),
  z.object({ action: z.literal("vpsPasteKey"), privateKey: z.string().min(40).max(20_000), passphrase: z.string().max(200).optional() }),
  z.object({ action: z.literal("vpsTest") }),
  z.object({ action: z.literal("vpsForget") }),
  z.object({ action: z.literal("vpsMove"), direction: z.enum(["up", "down"]) }),
  z.object({ action: z.literal("vpsAbortMove") }),
  z.object({ action: z.literal("vpsCap"), bytes: z.number().min(0).max(2 ** 50) }),
  z.object({ action: z.literal("vpsPin"), id: gucId, on: z.boolean() }),
  z.object({ action: z.literal("vpsPinned") }),
  z.object({ action: z.literal("vpsWorker"), on: z.boolean() }),
  z.object({ action: z.literal("vpsModelKey"), key: z.string().trim().max(300).optional(), model: z.string().trim().regex(/^[\w.-]{1,80}$/).optional() }),
  z.object({ action: z.literal("vpsConfirm"), id: z.string().regex(/^[a-f0-9]{16}$/) }),
  z.object({ action: z.literal("vpsCancel"), id: z.string().regex(/^[a-f0-9]{16}$/) }),
  z.object({ action: z.literal("gucDisconnect") }),
  // The GUC hub's reads (desktop/engine/guc-read.ts), all for the signed-in owner only.
  z.object({ action: z.literal("gucOverview") }),
  z.object({ action: z.literal("gucCourses") }),
  z.object({ action: z.literal("gucSchedule"), weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("gucAnnouncements"), courseId: gucCourse.optional(), cursor: z.string().regex(/^\d{1,15}\.[\w-]{1,100}$/).optional() }),
  z.object({ action: z.literal("gucMarkRead"), ids: z.array(gucId).min(1).max(200) }),
  z.object({ action: z.literal("gucMarkAllRead"), courseId: gucCourse.optional() }),
  z.object({ action: z.literal("gucMaterials"), courseId: gucCourse }),
  z.object({ action: z.literal("gucSearch"), query: z.string().trim().min(2).max(200) }),
  z.object({ action: z.literal("gucGrades"), courseId: gucCourse.optional() }),
  z.object({ action: z.literal("gucDeadlines") }),
  z.object({ action: z.literal("gucTerm") }),
  z.object({ action: z.literal("gucMail") }),
  /** One message's whole text, read from GUC when opened; never cached. */
  z.object({ action: z.literal("gucMailMessage"), id: gucId }),
  /** The main thread's Now card from GUC (today's classes, deadlines in 7 days, unread): cached in the engine. */
  z.object({ action: z.literal("gucNow") }),
  /** Makes a CMS file ready to view (saved copy, or fetched to a temp folder) and returns its name, type and size; the
   *  bytes come from clem://app/api/local/guc/file/<id>. */
  z.object({ action: z.literal("gucFile"), materialId: gucId }),
  // Subjects and their courses (desktop/engine/subjects.ts): links, settings, checks and new-term courses.
  z.object({ action: z.literal("gucLinks") }),
  z.object({ action: z.literal("gucLink"), subjectId: gucId, courseId: gucCourse }),
  z.object({ action: z.literal("gucUnlink"), subjectId: gucId }),
  z.object({ action: z.literal("gucSubject"), subjectId: gucId }),
  z.object({ action: z.literal("gucSetSettings"), subjectId: gucId, patch: settingsPatch }),
  z.object({ action: z.literal("gucCheckNow"), subjectId: gucId }),
  z.object({ action: z.literal("gucForgetSubject"), subjectId: gucId }),
  z.object({ action: z.literal("gucNewCourses") }),
  z.object({ action: z.literal("gucAckNewCourses"), keys: z.array(gucCourse).min(1).max(50) }),
  // What checks saved and found for linked subjects that the window has not shown yet, and marking it shown.
  z.object({ action: z.literal("gucInbox") }),
  z.object({ action: z.literal("gucAckInbox"), keys: z.array(z.string().min(1).max(300)).min(1).max(300) }),
  // Clem's organizer (desktop/engine/organizer.ts).
  z.object({ action: z.literal("proSettings"), set: proPatch.optional() }),
  z.object({ action: z.literal("proInbox") }),
  z.object({ action: z.literal("proAck"), posts: z.array(z.string().regex(/^pro-[\w-]{1,60}$/)).max(100).optional(), results: z.array(z.object({ key: proKey, ok: z.boolean(), undo: z.any().optional(), error: z.string().max(300).optional() })).max(200).optional(), reverted: z.array(proKey).max(100).optional() }),
  z.object({ action: z.literal("proLog") }),
  z.object({ action: z.literal("proStatus"), keys: z.array(proKey).min(1).max(100) }),
  z.object({ action: z.literal("proUndo"), key: proKey }),
  z.object({ action: z.literal("proConfirm"), key: proKey }),
  z.object({ action: z.literal("proDismiss"), key: proKey }),
  z.object({ action: z.literal("proMute"), key: proKey }),
  z.object({ action: z.literal("proUnmute"), key: proKey }),
  z.object({ action: z.literal("proMutes") }),
  z.object({ action: z.literal("proPoke"), reason: z.enum(["plans", "files", "study", "spaces", "open"]) }),
  z.object({ action: z.literal("proWatches") }),
  z.object({ action: z.literal("proStopWatch"), id: z.string().regex(/^[\w-]{1,80}$/) }),
  z.object({ action: z.literal("proRoutines") }),
  z.object({ action: z.literal("proStopRoutine"), id: z.string().regex(/^rt[\w-]{4,40}$/) }),
  z.object({ action: z.literal("proReminders") }),
  z.object({ action: z.literal("proCancelReminder"), id: z.string().regex(/^r[\w-]{1,40}$/) }),
  // Telegram (desktop/engine/telegram.ts): status, a pairing code, unpair, the pair card in the main thread, and the
  // window's answer to a Telegram message (its text and the files it made).
  z.object({ action: z.literal("tgStatus"), fresh: z.boolean().optional() }),
  z.object({ action: z.literal("tgPair") }),
  z.object({ action: z.literal("tgUnpair") }),
  z.object({ action: z.literal("tgOffer") }),
  z.object({ action: z.literal("tgAnswered"), id: z.string().regex(/^[mt]\d{1,20}$/), text: z.string().max(200_000), files: z.array(z.object({ id: z.string().regex(/^[\w-]{1,100}$/), name: z.string().min(1).max(300), type: z.string().max(200) })).max(5).optional() }),
  z.object({ action: z.literal("driveConnect"), pick: z.enum(["files", "folder"]).optional(), request: z.string().regex(/^[\w-]{16,64}$/).optional() }),
  z.object({ action: z.literal("drivePicked"), request: z.string().regex(/^[\w-]{16,64}$/) }),
  z.object({ action: z.literal("driveAccess"), hide: z.array(z.string().regex(/^[\w-]{10,150}$/)).max(200).optional(), show: z.array(z.string().regex(/^[\w-]{10,150}$/)).max(200).optional() }),
  z.object({ action: z.literal("logout") }),
  z.object({
    action: z.literal("mfa"),
    factorId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
  }),
  z.object({ action: z.literal("username"), username: z.string().max(24) }),
  z.object({
    action: z.literal("setup"),
    step: z.number().int().min(0).max(4),
    username: z.string().max(24),
    displayName: z.string().max(80),
    memory: z.boolean(),
  }),
  z.object({ action: z.literal("checkout") }),
  z.object({ action: z.literal("providerAccounts"), refresh:z.boolean().optional() }),
  z.object({ action: z.literal("providerAutoSwitch"), enabled:z.boolean() }),
  // The model (and thinking level) for Clem's own side jobs: naming files, memory notes, condensing a long chat. None: automatic.
  z.object({ action: z.literal("helperModel"), set: z.object({ model: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}(?:\[[a-z0-9]{1,8}\])?$/).optional(), reasoning: z.string().regex(/^[a-z]{2,12}$/).optional() }).optional() }),
  z.object({ action: z.literal("claudeStatus") }),
  z.object({ action: z.literal("claudeLogin") }),
  z.object({ action: z.literal("cliAccounts"), kind:z.enum(["claude","grok","antigravity"]), refresh:z.boolean().optional() }),
  z.object({ action: z.literal("cliAccountAdd"), kind:z.enum(["claude","grok","antigravity"]) }),
  z.object({ action: z.literal("cliAccountSignIn"), kind:z.enum(["claude","grok","antigravity"]), id:z.string().regex(/^(default|[a-f0-9-]{36})$/) }),
  z.object({ action: z.literal("cliAccountSelect"), kind:z.enum(["claude","grok","antigravity"]), id:z.string().regex(/^(default|[a-f0-9-]{36})$/) }),
  z.object({ action: z.literal("cliAccountRemove"), kind:z.enum(["claude","grok","antigravity"]), id:z.string().regex(/^(default|[a-f0-9-]{36})$/) }),
  z.object({ action: z.literal("claudeInstall") }),
  z.object({ action: z.literal("grokStatus") }),
  z.object({ action: z.literal("aiDetect") }),
  z.object({ action: z.literal("driveSearch"), query: z.string().min(1).max(2000) }),
  z.object({ action: z.literal("driveOpenWeb"), id: z.string().regex(/^[\w-]{10,150}$/) }),
  z.object({ action: z.literal("driveStatus"), refresh: z.boolean().optional() }),
  z.object({ action: z.literal("driveList"), folder: z.string().regex(/^(access|root|shared|[\w-]{10,150})$/).optional(), page: z.string().max(2000).optional(), query: z.string().max(200).optional(), kind: z.enum(["all", "folders"]).optional() }),
  z.object({ action: z.literal("driveUpload"), folder: z.string().regex(/^[\w-]{10,150}$/), name: z.string().min(1).max(200), type: z.string().max(200), data: z.instanceof(Uint8Array).refine((d) => d.length > 0 && d.length <= 1_000_000_000, "Files saved to Drive are limited to 1 GB.") }),
  z.object({ action: z.literal("driveUpdate"), id: z.string().regex(/^[\w-]{10,150}$/), type: z.string().max(200), data: z.instanceof(Uint8Array).refine((d) => d.length > 0 && d.length <= 1_000_000_000, "Files saved to Drive are limited to 1 GB.") }),
  z.object({ action: z.literal("driveRename"), id: z.string().regex(/^[\w-]{10,150}$/), name: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal("driveTrash"), id: z.string().regex(/^[\w-]{10,150}$/) }),
  z.object({ action: z.literal("driveMove"), root: z.string().regex(/^[\w-]{10,150}$/), id: z.string().regex(/^[\w-]{10,150}$/), to: z.string().regex(/^[\w-]{10,150}$/) }),
  z.object({ action: z.literal("driveFolder"), folder: z.string().regex(/^[\w-]{10,150}$/), query: z.string().max(4000).optional(), refresh: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() }),
  z.object({ action: z.literal("driveMediaUrl"), id: z.string().regex(/^[\w-]{10,150}$/) }),
  z.object({ action: z.literal("driveText"), id: z.string().regex(/^[\w-]{10,150}$/) }),
  z.object({ action: z.literal("videoCaptions"), source: z.enum(["youtube", "drive"]), id: z.string().regex(/^[\w-]{10,150}$/), languages: z.array(z.string().regex(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/)).max(4).optional() }),
  z.object({ action: z.literal("youtubePlaylist"), id: z.string().regex(/^[\w-]{10,64}$/) }),
  z.object({ action: z.literal("grokLogin") }),
  z.object({ action: z.literal("grokInstall") }),
  z.object({ action: z.literal("antigravityStatus") }),
  z.object({ action: z.literal("antigravityLogin") }),
  z.object({ action: z.literal("antigravityInstall") }),
  z.object({ action: z.literal("providerAccountAdd") }),
  z.object({ action: z.literal("providerAccountRetry"), id:z.string().regex(/^(default|[a-f0-9-]{36})$/) }),
  z.object({ action: z.literal("providerAccountStatus"), id:z.string().regex(/^(default|[a-f0-9-]{36})$/) }),
  z.object({ action: z.literal("providerAccountSelect"), id:z.string().regex(/^(default|[a-f0-9-]{36})$/) }),
  z.object({ action: z.literal("providerAccountRemove"), id:z.string().regex(/^(default|[a-f0-9-]{36})$/) }),
  z.object({ action: z.literal("providerStatus") }),
  z.object({ action: z.literal("providerLogin") }),
  z.object({ action: z.literal("providerLogout") }),
  z.object({ action: z.literal("linkFolder"), scope: scopeSchema }),
  z.object({ action: z.literal("folders"), scope: scopeSchema }),
  z.object({ action: z.literal("unlinkFolder"), id: z.string().uuid() }),
  z.object({ action: z.literal("folderFileRead"), scope: scopeSchema, path: z.string().min(1).max(400), create: z.boolean().optional() }),
  z.object({ action: z.literal("folderEditApply"), scope: scopeSchema, path: z.string().min(1).max(400), find: z.string().max(200000).optional(), replace: z.string().max(200000).optional(), content: z.string().max(256000).optional(), summary: z.string().max(400).optional(), base: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional() }),
  z.object({ action: z.literal("folderChanges"), scope: scopeSchema.optional() }),
  z.object({ action: z.literal("folderChangeUndo"), id: z.string().uuid() }),
  z.object({ action: z.literal("pdfRender"), spec: z.string().min(2).max(16_000_000) }),
  z.object({ action: z.literal("ankiRead"), name: z.string().min(1).max(260), data: z.instanceof(Uint8Array).refine((d) => d.length > 0 && d.length <= 250_000_000, "Anki decks are limited to 250 MB.") }),
  z.object({ action: z.literal("reminders"), set: z.object({ enabled: z.boolean().optional(), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional() }).optional() }),
  z.object({ action: z.literal("backupStatus") }),
  z.object({ action: z.literal("backupConfigure"), destination: z.union([z.object({ kind: z.literal("drive") }), z.null()]).optional(), chooseFolder: z.boolean().optional(), schedule: z.enum(["off", "daily", "weekly"]).optional(), keep: z.number().int().min(1).max(60).optional(), passphrase: z.string().min(8).max(200).optional() }),
  z.object({ action: z.literal("backupNow") }),
  z.object({ action: z.literal("backupList"), from: z.enum(["destination", "file", "drive"]).optional() }),
  z.object({ action: z.literal("backupPreview"), item: backupItem, passphrase: z.string().max(200).optional() }),
  z.object({ action: z.literal("backupRestore"), item: backupItem, passphrase: z.string().max(200).optional(), confirmed: z.boolean() }),
  z.object({ action: z.literal("shareSave"), name: z.string().min(1).max(160), data: z.instanceof(Uint8Array).refine((d) => d.length <= 105_000_000, "Share files are limited to 100 MB.") }),
  z.object({ action: z.literal("shareReveal"), path: z.string().min(3).max(600) }),
  z.object({ action: z.literal("foldersAll") }),
  z.object({ action: z.literal("folderTree"), id: z.string().uuid() }),
  z.object({ action: z.literal("folderSearch"), query: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal("folderWatch"), enabled: z.boolean().optional() }),
  z.object({ action: z.literal("captureScreen") }),
  /** Ctrl+V of files copied in File Explorer: the page sees only text, so the files are read here (desktop/clipboard-files.ts). */
  z.object({ action: z.literal("clipboardFiles") }),
  z.object({ action: z.literal("openInBrowser"), name: z.string().min(1).max(200), data: z.instanceof(Uint8Array).refine((d) => d.length <= 300_000_000, "Files are limited to 300 MB.") }),
  z.object({ action: z.literal("documentPdf"), title: z.string().trim().min(1).max(160), markdown: z.string().min(1).max(1_000_000) }),
  /** Export → Word or PowerPoint: the answer built by the same builders the AI's own files use (desktop/docx-document.ts, pptx-deck.ts). */
  z.object({ action: z.literal("documentExport"), format: z.enum(["docx", "pptx"]), title: z.string().trim().min(1).max(160), markdown: z.string().min(1).max(1_000_000) }),
  z.object({
    action: z.literal("chat"),
    // Claude Code ids can end in a context tag, e.g. claude:opus[1m].
    model:z.string().regex(/^[a-zA-Z0-9._:-]{1,100}(?:\[[a-z0-9]{1,8}\])?$/).optional(),
    reasoning:z.enum(["none","minimal","low","medium","high","xhigh","max","ultra"]).optional(),
    id: z.string().uuid(),
    scope: scopeSchema,
    /** Documents Clem made in this conversation; a change to one updates that same file. */
    documents: z.array(z.object({ id: z.string().uuid(), name: z.string().max(200) })).max(20).optional(),
    /** What the model looks at: attached pictures, PDF pages with drawings or scans, pictures inside Office files (src/desktop/page-images.ts). */
    images: z.array(z.object({ name: z.string().max(300), data: z.string().max(11_000_000).regex(/^[A-Za-z0-9+/=]+$/) })).max(80).optional(),
    /** PDFs handed to the model as files (src/desktop/page-images.ts pdfView): Claude reads them as document blocks (its
     *  request is capped at 32 MB), Grok opens their pages with its own read_file. */
    pdfs: z.array(z.object({ name: z.string().min(1).max(400), data: z.instanceof(Uint8Array) })).max(20).optional()
      .refine((l) => !l || l.reduce((n, f) => n + f.data.length, 0) <= 150_000_000, "These PDFs are too large to send at once."),
    /** How each PDF reached the model (whole, which pages) and how to read the rest. */
    pdfNotes: z.array(z.string().max(2000)).max(40).optional(),
    /** The full text of the chat's files (attached, in its subject or project), read by the model's file tools only. */
    library: z.array(z.object({ name: z.string().min(1).max(400), text: z.string().max(8_000_000) })).max(400).optional()
      .refine((l) => !l || l.reduce((n, f) => n + f.text.length, 0) <= 40_000_000, "Too much file text for one request."),
    /** An internal request that must answer in text only (a document edit returning JSON): no Kinetra tools, so no new file. */
    plain: z.boolean().optional(),
    /** A temporary chat: the model reads memory and files as usual, but nothing from it is remembered or kept. */
    temporary: z.boolean().optional(),
    /** A request Clem makes beside the chat (a plan, a review, a source check, a study set, a plan step): it neither goes
     *  on nor replaces the chat's kept CLI session (desktop/chat-sessions.ts). */
    side: z.boolean().optional(),
    /** How long the window spent preparing this message (its files, Drive, captions) before sending it, for the timing log. */
    queuedMs: z.number().int().min(0).max(3_600_000).optional(),
    /** The conversation: crops the model cuts are kept with it (desktop/pdf-assets.ts). */
    chat: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(),
    // Sized to the largest context budget (core/context-budget.ts): one message may carry whole files.
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.string().max(1_000_000),
        }),
      )
      .min(1)
      // A long chat is sent whole: the main process condenses what does not fit (desktop/chat-condense.ts).
      .max(2000)
      .refine((m) => m.reduce((n, x) => n + x.content.length, 0) <= 60_000_000, "This conversation is too large to send."),
  }),
  /** A message is about to be sent to this model: its AI program is made ready meanwhile (desktop/main.ts prepareFor). */
  z.object({ action: z.literal("prepare"), model: z.string().regex(/^[a-zA-Z0-9._:-]{1,100}(?:\[[a-z0-9]{1,8}\])?$/).optional(), ahead: z.boolean().optional() }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }),
  z.object({ action: z.literal("memoryList"), scope: scopeSchema }),
  z.object({ action: z.literal("memoryAll") }),
  /** A ```kinetra block in a chat answer: the figure drawn by the Kinetra worker, as SVG (src/chat/KinetraFigure.tsx). */
  z.object({ action: z.literal("kinetraFigure"), figure: z.string().min(2).max(400_000) }),
  z.object({ action: z.literal("memoryClear"), scope: scopeSchema }),
  z.object({action:z.literal("memoryEdit"),scope:scopeSchema,expected:z.array(z.object({id:z.string().uuid(),text:z.string().max(2000)})).max(500),records:z.array(z.object({id:z.string().uuid(),text:z.string().min(1).max(2000)})).max(500)}),
  z.object({
    action: z.literal("memorySave"),
    scope: scopeSchema,
    text: z.string().min(1).max(2000),
    kind: z.enum(["fact", "preference"]),
    sharedWith: z.array(scopeSchema).max(10),
    source: z.string().max(300).optional(),
  }),
  z.object({ action: z.literal("memoryForget"), id: z.string().uuid(), ids: z.array(z.string().uuid()).max(20).optional() }),
  /** Single notes out of their topics: the Delete on the note Clem shows after saving something. */
  z.object({ action: z.literal("memoryForgetNotes"), items: z.array(z.object({ id: z.string().uuid(), notes: z.array(z.string().max(2000)).min(1).max(20) })).max(20) }),
  /** Deleted chats: what Clem only learned from them is forgotten; what the person kept stays. */
  z.object({ action: z.literal("memoryForgetChat"), chats: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/)).max(5000) }),
  z.object({ action: z.literal("memoryConfirm"), id: z.string().uuid() }),
  /** The person's change to one memory: new words, its topic's name, where it applies (about them, or one space), or spaces it is shared with. */
  z.object({ action: z.literal("memoryUpdate"), id: z.string().uuid(), text: z.string().trim().min(1).max(2000).optional(), topic: z.string().trim().min(1).max(60).optional(), scope: scopeSchema.optional(), sharedWith: z.array(scopeSchema).max(10).optional() }),
  z.object({ action: z.literal("memoryToggle"), enabled: z.boolean() }),
  z.object({ action: z.literal("securityInfo") }),
  z.object({
    action: z.literal("passwordChange"),
    password: z.string().min(12).max(128),
    currentPassword: z.string().min(1).max(128).optional(),
    nonce: z.string().regex(/^[A-Za-z0-9]{6,10}$/).optional(),
    code: z.string().regex(/^\d{6}$/).optional(),
  }),
  z.object({ action: z.literal("passwordReauth") }),
  z.object({ action: z.literal("emailChange"), email: z.email() }),
  z.object({ action: z.literal("revokeOtherSessions") }),
  z.object({ action: z.literal("mfaEnroll") }),
  z.object({
    action: z.literal("mfaRemove"),
    factorId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
  }),
  z.object({
    action: z.literal("unlinkGoogle"),
    password: z.string().min(1).max(128),
  }),
  /** Scanned pages drawn by the window, read with Windows' own OCR (desktop/ocr.ts). */
  z.object({ action: z.literal("ocr"), pictures: z.array(z.instanceof(Uint8Array).refine((d) => d.length <= 12_000_000)).min(1).max(12) }),
  z.object({
    action: z.literal("fileName"),
    original: z.string().min(1).max(260),
    title: z.string().max(300).optional(),
    lines: z.array(z.string().max(400)).max(60),
    place: z.string().max(200).optional(),
    suggestion: z.string().min(1).max(260),
    /** The names of the other files where it goes, so the new name follows their pattern ("… – Lecture 5"). */
    siblings: z.array(z.string().max(160)).max(40).optional(),
    /** A PDF's first page, as each AI reads a PDF (src/pdf/pdf-name.ts): a one-page PDF (Claude, Grok) and its picture (ChatGPT). */
    page: z.object({ pdf: z.instanceof(Uint8Array).refine((d) => d.length <= 15_000_000), picture: z.string().max(4_000_000).regex(/^[A-Za-z0-9+/=]+$/) }).optional(),
  }),
  /** Pictures of the pages the model asked to look at (desktop/main.ts "look"). */
  z.object({
    action: z.literal("pageImages"),
    id: z.string().uuid(),
    images: z.array(z.object({ name: z.string().max(300), data: z.string().max(11_000_000).regex(/^[A-Za-z0-9+/=]+$/) })).max(8).optional(),
    error: z.string().max(500).optional(),
  }),
  /** The window's answer to a "regions" or "crop" task (desktop/main.ts windowTask, src/desktop/pdf-tasks.ts). */
  z.object({
    action: z.literal("pdfTaskResult"),
    id: z.string().uuid(),
    data: z.string().max(4_000_000).optional(),
    images: z.array(z.object({ name: z.string().max(300), data: z.string().max(11_000_000).regex(/^[A-Za-z0-9+/=]+$/) })).max(4).optional(),
    /** A crop's PNG, and for vector pages the PDF it was cut from. */
    files: z.array(z.instanceof(Uint8Array).refine((d) => d.length <= 210_000_000, "Files are limited to 200 MB.")).max(3).optional(),
    error: z.string().max(500).optional(),
  }),
]);
export type DesktopRequest = z.infer<typeof requestSchema>;
export type DesktopStatus = {
  configured: boolean;
  user: null | { id: string; email: string; name: string };
  setup: {
    step: number;
    username: string;
    displayName: string;
    memory: boolean;
  };
  entitlement: { active: boolean; reason: string; message?: string; until?: string | null };
  error?: string;
  mfaFactor?: string;
};
/** Where Clem is in updating itself, as the window shows it (sidebar indicator, Settings → General → Updates). */
export type UpdateState = {
  automatic: boolean;
  /** This build; updates only work in an installed copy, not when run from source. */
  version: string;
  supported: boolean;
  phase: "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "error";
  /** The version being offered, downloaded or waiting to install. */
  next?: string;
  /** 0–100 while downloading. */
  percent?: number;
  error?: string;
  checkedAt?: number;
};
export type DesktopBridge = {
  onAuth: (listener: () => void) => () => void;
  invoke: (request: DesktopRequest) => Promise<any>;
  onCapture?: (listener: (event: { bytes: Uint8Array; name: string; mime: string }) => void) => () => void;
  onFolder?: (listener: (event: FolderEvent) => void) => () => void;
  onPack?: (listener: (event: { bytes: Uint8Array; name: string }) => void) => () => void;
  /** Progress of a GUC sync the window asked for ("Checking your courses… 3 of 7"). */
  onGuc?: (listener: (event: import("../core/guc/types").GucProgress) => void) => () => void;
  /** The VPS connector changed: status, a move's progress, the worker, or an install step ("progress:<label>"). */
  onVps?: (listener: (event: { what: string }) => void) => () => void;
  /** Something to open from outside the window: a flashcard reminder's subject, at its review (desktop/study-reminders.ts). */
  onOpen?: (listener: (event: { review?: string; route?: string; chat?: string; message?: string }) => void) => () => void;
  /** A Telegram message (or a tap that needs the agent or the workspace) for the main thread to answer; the window
   *  replies with { action: "tgAnswered", id, text }. */
  onTelegram?: (listener: (event: TelegramTurn) => void) => () => void;
  startDrag?: (path: string) => void;
  /** Runs a chat code block on this computer (desktop/code-runner.ts): start it, send it a line of input (null ends input), or stop it. */
  runCode?: (request: { op: "start"; id: string; lang: string; code: string } | { op: "input"; id: string; text: string | null } | { op: "stop"; id: string }) => Promise<unknown>;
  /** Output, status and the end of runs started with runCode. */
  onCode?: (listener: (event: { id: string; type: "out" | "err" | "status" | "started" | "done"; text?: string; ok?: boolean }) => void) => () => void;
  /** Recolours the Windows caption buttons to sit in the page: normal, or dimmed behind a pop-up. */
  setWindowTone?: (tone: "normal" | "dim" | "light" | "light-dim") => void;
  /** Reads, or changes, whether closing keeps Clem running in the tray and whether it starts with Windows. */
  background?: (next?: { keepRunning?: boolean; startWithWindows?: boolean }) => Promise<{ keepRunning: boolean; startWithWindows: boolean }>;
  /** Reads Clem's update state, turns automatic updates on or off, or checks, downloads or installs (desktop/app-update.ts).
   *  `busy` comes back when installing was refused because an answer or run is still working. */
  update?: (request?: { automatic: boolean } | { op: "check" | "download" | "install" }) => Promise<UpdateState & { busy?: boolean }>;
  /** Every change in the update state: checking, progress while downloading, ready to install. */
  onUpdate?: (listener: (state: UpdateState) => void) => () => void;
  onChat: (
    listener: (event: {
      id: string;
      type: string;
      text?: string;
      file?: import("../core/types").StoredFile;
      scope?: string;
      error?: string;
      /** type "error": the plan's usage limit stopped the answer; no files were sent. `resetsAt` (ms) when known. */
      limit?: { resetsAt?: number };
      /** type "memory": what Clem noted about the person after this answer. */
      memories?: { id: string; text: string; confirmed: boolean; notes?: string[] }[];
      /** An artifact that replaced an existing file's contents (a revised document) rather than a new file. */
      revised?: { version: import("../core/types").FileVersion };
      /** type "look": the model asks to see `pages` of `file`; answer with the pageImages action and this id. */
      look?: string;
      pages?: number[];
      /** type "pdfTask": run `op` with `args` (src/desktop/pdf-tasks.ts); answer with the pdfTaskResult action and this id. */
      task?: string;
      op?: string;
      args?: any;
    }) => void,
  ) => () => void;
};
