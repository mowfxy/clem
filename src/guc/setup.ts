// How GUC settings change from a chat (docs/GUC-VPS-ENGINE.md → Subject setup). Nothing here speaks first: no chat is
// made, opened or written to unless the person asked. A subject that clearly matches a CMS course is linked without
// a word (a toast says so); one Clem can't place is left alone, and its CMS tab offers the likeliest courses. What
// Clem keeps from a course is what the person said for all their courses. The "Setup" chat exists only when the
// person taps "Set up in a chat": there core/guc/setup-flow.ts asks which course it is and reads the typed reply
// (the AI only for a reply the local parser can't read). This also applies the settings_update blocks a chat's AI
// writes because the person asked, links a new term's courses to the subjects that are clearly theirs, and puts the
// files checks saved into their subject's Files. News about a course is said once, by the organizer in the main
// thread, never here. App.tsx gives it the workspace through `SetupDeps`.
import { cardBlock, cardsIn } from "../../core/guc/cards";
import type { HubCourse } from "../../core/guc/hub";
import { matchCourse } from "../../core/guc/match";
import { describeSaveRules } from "../../core/guc/rules";
import { describeChecks } from "../../core/guc/schedule-rules";
import { ALL_SUBJECTS, type InboxItem, type NewCourse, type SubjectView } from "../../core/guc/settings";
import type { ClemCard } from "../../core/guc/cards";
import { NOT_UNDERSTOOD, interpretPrompt, readAiReply, readReply, setupMessage, startSetup, stepOfCard, toPost, answer as answerStep, updatePatch, updateSummary, type Reply, type SetupStep } from "../../core/guc/setup-flow";
import { parseModelJson } from "../../core/model-json";
import type { Chat, Space, StoredFile } from "../../core/types";
import { pendingStep, type GucActions } from "./GucCards";
import { checkSubjectNow, editSubject, linkSubject, subjectView, unlinkSubject } from "./subject";
import { gucAsk, gucCache, gucKey } from "./useGuc";

export type SetupDeps = {
  spaces: () => Space[];
  chats: () => Chat[];
  /** Adds chats, or changes one. */
  addChat: (chat: Chat) => void;
  updateChat: (id: string, fn: (c: Chat) => Chat) => void;
  addSpace: (space: Space) => void;
  files: () => StoredFile[];
  /** Adds files to the workspace (a check's saved CMS files, shown in their subject's Files). */
  addFiles: (files: StoredFile[]) => void;
  openChat: (chatId: string, spaceId: string) => void;
  /** One short side request on the chat's model (or Clem's organizer); the raw reply. */
  ask: (messages: { role: string; content: string }[], subjectId: string) => Promise<string>;
  toast: (message: string) => void;
};

const uid = () => crypto.randomUUID();
const clean = (e: unknown) => String((e as Error)?.message || e || "").replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
export const setupChatOf = (chats: Chat[], subjectId: string) => chats.find((c) => c.setup && c.spaceId === subjectId);
/** The setup steps whose questions are already in the thread. */
const posted = (chat?: Chat) => (chat?.messages || []).flatMap((m) => (m.role !== "assistant" ? [] : m.setupStep ? [m.setupStep as SetupStep | "done"] : cardsIn(m.content).map(stepOfCard).filter((s): s is SetupStep | "done" => !!s)));

export function createSetup(deps: SetupDeps) {
  /** What the schedule converter needs: "after each lecture", the lecture days, the exam date. */
  const scheduleContext = (v: SubjectView) => ({ suggested: v.suggested.mode === "after_lectures" ? v.suggested.times : [], slots: v.slots, code: v.course?.code, exam: deps.spaces().find((x) => x.id === v.subjectId)?.examDate?.slice(0, 10) || undefined });
  const queues = new Map<string, Promise<unknown>>();
  /** One setup change per subject at a time: two quick taps never post a question twice. */
  const serial = <T,>(subjectId: string, job: () => Promise<T>) => {
    const next = (queues.get(subjectId) || Promise.resolve()).catch(() => {}).then(job);
    queues.set(subjectId, next);
    return next;
  };
  const courses = async () => {
    const k = gucKey({ action: "gucCourses" }), have = gucCache.get<HubCourse[]>(k)?.data;
    return have || gucCache.revalidate(k, () => gucAsk<HubCourse[]>({ action: "gucCourses" })).then((c) => c || []);
  };
  const say = (chatId: string, content: string, setupStep?: SetupStep | "done") => deps.updateChat(chatId, (c) => ({ ...c, updated: Date.now(), messages: [...c.messages, { id: uid(), role: "assistant", content, at: Date.now(), ...(setupStep ? { setupStep } : {}) }] }));
  /** The course a link question suggested, so "yes" links it. */
  const suggested = new Map<string, string>();

  function ensureChat(subjectId: string) {
    const have = setupChatOf(deps.chats(), subjectId);
    if (have) return have.id;
    const chat: Chat = { id: uid(), title: "Setup", spaceId: subjectId, messages: [], updated: Date.now(), pinned: true, setup: true, renamed: true };
    deps.addChat(chat);
    return chat.id;
  }

  /** Posts the question the thread is missing (after an answer, on opening it, after a restart). A course that clearly
   *  matches the subject is linked without asking, so the one question left is what to save. */
  async function postNext(subjectId: string, lead = ""): Promise<SetupStep | "done" | undefined> {
    let v = await subjectView(subjectId, true);
    const st = v.settings.setup, chat = setupChatOf(deps.chats(), subjectId);
    if (!st || !chat) return;
    const ctx = () => ({ linked: !!v.course, vps: v.vps });
    const step = toPost(st, ctx(), posted(chat));
    if (!step) return;
    const space = deps.spaces().find((s) => s.id === subjectId), subject = space?.name || "this subject";
    const all = await courses(), free = all.filter((c) => c.active && (!c.subjectId || c.subjectId === subjectId));
    const guess = !v.course && space ? matchCourse({ name: space.name, description: space.description }, free) : undefined;
    if (step === "link" && guess?.best && guess.sure) {
      const c = guess.best.item;
      v = await linkSubject(subjectId, { key: c.key });
      await editSubject(subjectId, { setup: answerStep(st, "link", "answered", ctx()) });
      return postNext(subjectId, `${lead}I found **${subject}** on CMS as **${c.code}** (${c.name}) and linked it.`);
    }
    const course = v.course || guess?.best?.item;
    if (step === "link" && course) suggested.set(subjectId, course.key);
    // "I found it and linked it." opens the closing note; "Got it." and the like stand before it.
    const opens = step === "done" && /linked it\.$/.test(lead);
    const text = setupMessage(step, { subjectId, subject, course: course && { key: course.key, code: course.code, name: course.name }, linked: !!v.course, sure: guess?.sure, save: describeSaveRules(v.settings.save), check: "", first: !posted(chat).length, vpsFiles: !!v.vpsFiles,
      choices: free.filter((c) => c.key !== course?.key).map((c) => `${c.code} ${c.name}`.trim()), ...(opens ? { lead } : {}) });
    say(chat.id, opens || !lead ? text : lead + text, step);
    return step;
  }

  /** Links a subject to its CMS course without a word: to `courseKey` when it was made from a course, else to the
   *  course it clearly is. No chat is made and nothing is asked; when Clem can't tell, the subject stays unlinked and
   *  its CMS tab offers the likeliest courses. A toast says what was linked. */
  async function linkQuietly(subjectId: string, courseKey?: string) {
    let v = await subjectView(subjectId, true);
    const was = v.course?.key;
    if (courseKey && was !== courseKey) v = await linkSubject(subjectId, { key: courseKey });
    if (!v.course) {
      const space = deps.spaces().find((s) => s.id === subjectId);
      const free = (await courses()).filter((c) => c.active && (!c.subjectId || c.subjectId === subjectId));
      const guess = space ? matchCourse({ name: space.name, description: space.description }, free) : undefined;
      if (guess?.best && guess.sure) v = await linkSubject(subjectId, { key: guess.best.item.key });
    }
    if (!v.course) return;
    if (!v.settings.setup?.finished) await editSubject(subjectId, { setup: startSetup(Date.now(), true) });
    if (v.course.key !== was) deps.toast(`Linked to ${v.course.code} on CMS. Clem is watching it.`);
  }

  /** `quiet` (a new subject, a course set up from a card, a link made on the subject's page): the subject is linked
   *  when Clem is sure, and that is all. Otherwise the person tapped "Set up in a chat": its Setup chat opens and
   *  asks which course it is. */
  function begin(subjectId: string, o: { courseKey?: string; quiet?: boolean } = {}) {
    if (o.quiet) return serial(subjectId, () => linkQuietly(subjectId, o.courseKey)).catch((e) => deps.toast(clean(e) || "That course couldn't be linked. Try again."));
    const chatId = ensureChat(subjectId);
    deps.openChat(chatId, subjectId);
    return serial(subjectId, async () => {
      let v = await subjectView(subjectId, true);
      if (o.courseKey && v.course?.key !== o.courseKey) v = await linkSubject(subjectId, { key: o.courseKey });
      if (!v.settings.setup) await editSubject(subjectId, { setup: startSetup(Date.now(), !!v.course) });
      await postNext(subjectId);
    }).catch((e) => deps.toast(clean(e) || "Setup couldn't start. Try again."));
  }
  /** On opening a setup chat: post what a restart left unasked. */
  const resume = (subjectId: string) => serial(subjectId, () => postNext(subjectId)).catch(() => {});

  /** An answer to `step`, from a card's buttons or a typed reply. Outside setup (or for another step) it only applies. */
  async function answer(subjectId: string, step: SetupStep, reply: Reply, lead = "") {
    // The first link of a subject that never had setup (the subject page, the hub) starts its setup thread.
    const first = await serial(subjectId, async () => {
      let v = await subjectView(subjectId, true), r = reply, how: "answered" | "skipped" = "answered";
      const st = v.settings.setup, waiting = !!st && !st.finished && pendingStep(v) === step;
      if (r.kind === "confirm" && step === "link") {
        const card = [...(setupChatOf(deps.chats(), subjectId)?.messages || [])].reverse().flatMap((m) => cardsIn(m.content)).find((c) => c.type === "course_link" && c.suggest);
        const key = suggested.get(subjectId) || (card?.type === "course_link" ? card.suggest : undefined);
        if (!key) throw Error("Which course is it? Tell me its code, like CSEN 301.");
        r = { kind: "link", courseKey: key };
      }
      if (r.kind === "link") v = await linkSubject(subjectId, { key: r.courseKey });
      else if (r.kind === "settings") v = await editSubject(subjectId, r.patch);
      else if (r.kind === "confirm" && step === "check") v = await editSubject(subjectId, { check: v.settings.check });
      else if (r.kind === "skip") how = "skipped";
      if (!st) return r.kind === "link";
      if (!waiting) return false;
      await editSubject(subjectId, { setup: answerStep(st, step, how, { linked: !!v.course, vps: v.vps }) });
      await postNext(subjectId, lead);
      return false;
    });
    // Linked from the subject's own page: it stays where the person is, and nothing is posted anywhere.
    if (first) await begin(subjectId, { quiet: true });
  }

  /** A message typed in a setup thread while it waits on a question. False once setup is done (the AI answers). */
  async function reply(chat: Chat, text: string): Promise<boolean> {
    const subjectId = chat.spaceId;
    if (!subjectId || !chat.setup) return false;
    let v: SubjectView;
    try { v = await subjectView(subjectId, true); } catch { return false; }
    const step = pendingStep(v);
    if (!step) return false;
    const all = await courses().catch(() => [] as HubCourse[]);
    let r = readReply(step, text, { courses: all, save: v.settings.save, ...scheduleContext(v) });
    if (r.kind === "unknown") {
      // Only now the AI: one short JSON answer, while Clem's mark shows it is thinking.
      const wait = uid();
      deps.updateChat(chat.id, (c) => ({ ...c, messages: [...c.messages, { id: wait, role: "assistant", content: "", at: Date.now() }] }));
      try { r = readAiReply(step, parseModelJson(await deps.ask(interpretPrompt(step, text, all), subjectId)), all); } catch { r = { kind: "unknown" }; }
      deps.updateChat(chat.id, (c) => ({ ...c, messages: c.messages.filter((m) => m.id !== wait) }));
    }
    if (r.kind === "unknown") { say(chat.id, NOT_UNDERSTOOD[step]); return true; }
    if (r.kind === "ask") { say(chat.id, r.text); return true; }
    try { await answer(subjectId, step, r, r.kind === "skip" ? "No problem, skipped.\n\n" : "Got it.\n\n"); }
    catch (e) { say(chat.id, clean(e) || "That didn't save. Try again, or use the card above."); }
    return true;
  }

  /** The settings_update blocks a subject chat's AI wrote because the person asked: applied once, as the answer ends. */
  async function applyUpdates(content: string, spaceId: string | null) {
    for (const card of cardsIn(content)) {
      if (card.type !== "settings_update") continue;
      const subjectId = card.everywhere ? ALL_SUBJECTS : card.subjectId || spaceId;
      if (!subjectId || (!card.everywhere && !deps.spaces().some((s) => s.id === subjectId && s.kind === "subject"))) continue;
      try {
        const v = await subjectView(subjectId);
        if (card.everywhere) {
          // For every course: what to keep and the Drive copy; each linked subject's cards then read it fresh.
          const { save, drive } = updatePatch(card, { save: v.settings.save });
          if (save || drive) { await editSubject(ALL_SUBJECTS, { ...(save ? { save } : {}), ...(drive ? { drive } : {}) }); void gucCache.revalidateAll(); }
          deps.toast(updateSummary(card) + ".");
          continue;
        }
        const patch = updatePatch(card, { save: v.settings.save, ...scheduleContext(v) });
        if (Object.keys(patch).length) await editSubject(subjectId, patch);
        if (card.unlink) await unlinkSubject(subjectId);
        if (card.checkNow) void checkSubjectNow(subjectId).catch(() => {});
        deps.toast(updateSummary(card) + ".");
      } catch (e) { deps.toast(clean(e) || "That setting didn't change. Try again."); }
    }
  }

  /** What a linked subject's chat tells the AI: the settings now, and how to change them when asked. */
  async function note(spaceId: string | null) {
    const space = spaceId && deps.spaces().find((s) => s.id === spaceId && s.kind === "subject");
    if (!space) return "";
    let v: SubjectView;
    try { v = await subjectView(space.id); } catch { return ""; }
    if (!v.course && !v.settings.setup) return "";
    const s = v.settings;
    return `GUC: ${v.course ? `this subject is linked to the CMS course ${v.course.code} (${v.course.name}). Clem saves ${describeSaveRules(s.save).toLowerCase()}, as soon as new files are posted (it looks every few minutes); Drive copy ${s.drive.enabled ? "on" : "off"}.` : "this subject has no CMS course linked."}
Never ask the user what to save, when to check or where files go: Clem already has defaults and they can change them whenever they like. When the user asks to change one of these (e.g. "stop saving videos", "unlink CMS", "check now"), change it by ending your answer with one block, giving only what changes, and say in one short sentence what you changed:
\`\`\`clem-card
{"type":"settings_update","save":{"videos":false}}
\`\`\`
Fields: "saveText": the user's own words about what to save (Clem reads them, e.g. "only PDFs from week 3"); "checkText": their own words about when to check (e.g. "every 2 hours on weekdays 8am-10pm"; GUC weekdays are Sat-Thu); "save": {"slides"|"assignments"|"sheets"|"videos"|"links"|"other": true|false}; "check": {"mode":"after_lectures"|"custom"|"off","times":[{"day":0-6 (0 is Sunday),"time":"HH:MM"}]}; "drive": {"enabled": true|false}; "unlink": true; "checkNow": true; "everywhere": true when they mean all their courses, not just this one (only what to save and the Drive copy). Never write it unless the user asked for that change.`;
  }

  /** Courses of a new term that no subject has: a subject that is clearly one of them is linked, quietly. Nothing is
   *  posted and nothing is offered; the rest wait in the hub's CMS tab, or for the person to ask. */
  let posting = false;
  async function linkNewCourses() {
    if (posting) return;
    posting = true;
    try {
      const found = await gucAsk<NewCourse[]>({ action: "gucNewCourses" });
      if (!found.length) return;
      const shown = found.slice(0, 20);
      // A subject that is clearly one of them (and has no course yet) is linked now, without a question.
      const all = await courses().catch(() => [] as HubCourse[]), taken = new Set(all.filter((c) => c.subjectId).map((c) => c.subjectId)), linked: string[] = [];
      for (const space of deps.spaces().filter((s) => s.kind === "subject" && !taken.has(s.id))) {
        const m = matchCourse({ name: space.name, description: space.description }, shown.filter((c) => !linked.includes(c.key)));
        if (!m.best || !m.sure) continue;
        const c = m.best.item;
        try { await linkSubject(space.id, { key: c.key }); linked.push(c.key); if (!(await subjectView(space.id)).settings.setup) await editSubject(space.id, { setup: { ...startSetup(Date.now(), true), finished: true } }); } catch { /* offered below instead */ }
      }
      const names = shown.filter((c) => linked.includes(c.key)).map((c) => c.code);
      if (names.length) deps.toast(`Linked ${names.join(", ")} on CMS to the subject${names.length === 1 ? "" : "s"} you already have.`);
      await gucAsk({ action: "gucAckNewCourses", keys: shown.map((c) => c.key) });
    } catch { /* not connected, or nothing new */ } finally { posting = false; }
  }

  /** What checks saved since last time: the files join their subject's Files (once each, by material). Nothing is
   *  written into any chat: news about a course (an announcement, a grade, a deadline, files that were saved) is said
   *  once, by the organizer in the main thread. Then acknowledged. */
  let inboxing = false;
  async function applyInbox() {
    if (inboxing) return;
    inboxing = true;
    try {
      const items = await gucAsk<InboxItem[]>({ action: "gucInbox" });
      if (!items.length) return;
      const subjects = new Set(deps.spaces().filter((x) => x.kind === "subject").map((x) => x.id)), have = new Set(deps.files().map((f) => f.id));
      const add: StoredFile[] = [];
      for (const i of items) if (i.file && subjects.has(i.subjectId) && !have.has("guc_" + i.file.id)) {
        have.add("guc_" + i.file.id);
        add.push({ id: "guc_" + i.file.id, name: i.file.name, size: i.file.size, type: i.file.type, created: i.at || Date.now(), spaceId: i.subjectId, folderId: null });
      }
      if (add.length) deps.addFiles(add);
      await gucAsk({ action: "gucAckInbox", keys: items.map((i) => i.key) });
    } catch { /* not connected, or the window closed mid-way: picked up next time */ } finally { inboxing = false; }
  }

  /** A new subject named after a CMS course, linked to it, with its setup thread open. */
  function createFromCourse(course: Pick<HubCourse, "key" | "code" | "name">, from?: string) {
    const space: Space = { id: uid(), name: course.name, description: course.code, kind: "subject", memory: "", sources: [] };
    deps.addSpace(space);
    // The subject whose card offered this goes on without a course.
    if (from) void answer(from, "link", { kind: "skip" }).catch(() => {});
    // Nothing to ask (the course is known), so nothing opens: the card shows it linked, and a line says so.
    void begin(space.id, { courseKey: course.key, quiet: true });
    return space.id;
  }

  return { begin, resume, answer, reply, applyUpdates, note, linkNewCourses, applyInbox, createFromCourse };
}
export type Setup = ReturnType<typeof createSetup>;

/** The card actions App hands every GUC card. */
export function cardActions(setup: Setup, app: Omit<GucActions, "answer" | "createFromCourse" | "openSetup">): GucActions {
  return { ...app, answer: (subjectId, step, reply) => setup.answer(subjectId, step, reply), createFromCourse: (c, from) => void setup.createFromCourse(c, from), openSetup: (subjectId) => void setup.begin(subjectId) };
}
