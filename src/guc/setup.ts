// The setup thread and the other ways GUC settings change from a chat (docs/GUC-VPS-ENGINE.md → Subject setup).
// core/guc/setup-flow.ts decides; this posts Clem's questions into the subject's pinned "Setup" chat, applies answers
// from cards and typed replies through the engine (src/guc/subject.ts), asks the AI only to read a reply the local
// parser can't, applies the settings_update blocks a subject chat's AI writes, and posts new-semester courses in the
// main thread, and shows what checks saved and found (the engine's inbox): saved files join the subject's Files and a
// card goes into its Setup chat. App.tsx gives it the workspace through `SetupDeps`.
import { cardBlock, cardsIn } from "../../core/guc/cards";
import type { HubCourse } from "../../core/guc/hub";
import { matchCourse } from "../../core/guc/match";
import { describeSaveRules } from "../../core/guc/rules";
import { describeChecks } from "../../core/guc/schedule-rules";
import type { InboxItem, NewCourse, SubjectView } from "../../core/guc/settings";
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
const posted = (chat?: Chat) => (chat?.messages || []).flatMap((m) => (m.role === "assistant" ? cardsIn(m.content).map(stepOfCard).filter((s): s is SetupStep | "done" => !!s) : []));

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
  const say = (chatId: string, content: string) => deps.updateChat(chatId, (c) => ({ ...c, updated: Date.now(), messages: [...c.messages, { id: uid(), role: "assistant", content, at: Date.now() }] }));

  function ensureChat(subjectId: string) {
    const have = setupChatOf(deps.chats(), subjectId);
    if (have) return have.id;
    const chat: Chat = { id: uid(), title: "Setup", spaceId: subjectId, messages: [], updated: Date.now(), pinned: true, setup: true, renamed: true };
    deps.addChat(chat);
    return chat.id;
  }

  /** Posts the question the thread is missing (after an answer, on opening it, after a restart). */
  async function postNext(subjectId: string, lead = "") {
    const v = await subjectView(subjectId, true), st = v.settings.setup, chat = setupChatOf(deps.chats(), subjectId);
    if (!st || !chat) return;
    const step = toPost(st, { linked: !!v.course, vps: v.vps }, posted(chat));
    if (!step) return;
    const space = deps.spaces().find((s) => s.id === subjectId);
    const all = await courses(), free = all.filter((c) => !c.subjectId || c.subjectId === subjectId);
    const guess = !v.course && space ? matchCourse({ name: space.name, description: space.description }, free.filter((c) => c.active)) : undefined;
    const course = v.course || guess?.best?.item;
    const check = v.suggested.mode === "after_lectures" ? `Half an hour after each lecture works well: ${describeChecks(v.suggested).replace("After each lecture: ", "")}` : `I'd check ${describeChecks(v.suggested).replace(/^Every/, "every")}`;
    say(chat.id, lead + setupMessage(step, { subjectId, subject: space?.name || "this subject", course: course && { key: course.key, code: course.code, name: course.name }, linked: !!v.course, sure: guess?.sure, save: describeSaveRules(v.settings.save), check, first: !posted(chat).length }));
  }

  /** Opens the subject's setup thread, starting it the first time (linked to `courseKey` when made from a course). */
  function begin(subjectId: string, o: { courseKey?: string } = {}) {
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
        if (!card || card.type !== "course_link" || !card.suggest) throw Error("Pick the course in the card above.");
        r = { kind: "link", courseKey: card.suggest };
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
    if (first) await begin(subjectId);
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
      const subjectId = card.subjectId || spaceId;
      if (!subjectId || !deps.spaces().some((s) => s.id === subjectId && s.kind === "subject")) continue;
      try {
        const v = await subjectView(subjectId);
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
    return `GUC: ${v.course ? `this subject is linked to the CMS course ${v.course.code} (${v.course.name}). Clem saves ${describeSaveRules(s.save).toLowerCase()}; checks: ${describeChecks(s.check)} (Africa/Cairo); Drive copy ${s.drive.enabled ? "on" : "off"}.` : "this subject has no CMS course linked."}
When the user asks to change one of these (e.g. "stop saving videos", "check every day at 9pm", "unlink CMS", "check now"), change it by ending your answer with one block, giving only what changes, and say in one short sentence what you changed:
\`\`\`clem-card
{"type":"settings_update","save":{"videos":false}}
\`\`\`
Fields: "saveText": the user's own words about what to save (Clem reads them, e.g. "only PDFs from week 3"); "checkText": their own words about when to check (e.g. "every 2 hours on weekdays 8am-10pm"; GUC weekdays are Sat-Thu); "save": {"slides"|"assignments"|"sheets"|"videos"|"links"|"other": true|false}; "check": {"mode":"after_lectures"|"custom"|"off","times":[{"day":0-6 (0 is Sunday),"time":"HH:MM"}]}; "drive": {"enabled": true|false}; "unlink": true; "checkNow": true. Never write it unless the user asked for that change.`;
  }

  /** Courses of a new term that no subject has: one card in the main thread, each with Set up. */
  let posting = false;
  async function postNewCourses(mainId: string | undefined) {
    if (!mainId || posting) return;
    posting = true;
    try {
      const found = await gucAsk<NewCourse[]>({ action: "gucNewCourses" });
      if (!found.length) return;
      const shown = found.slice(0, 20);
      say(mainId, `${shown.length === 1 ? "A new course is" : `${shown.length} new courses are`} on CMS this semester. Want me to set ${shown.length === 1 ? "it" : "them"} up?\n\n` + cardBlock({ type: "new_courses", courses: shown.map(({ key, code, name }) => ({ key, code, name })) }));
      await gucAsk({ action: "gucAckNewCourses", keys: shown.map((c) => c.key) });
    } catch { /* not connected, or nothing new */ } finally { posting = false; }
  }

  /** What checks saved and found since last time: files into the subject's Files (once each, by material), and one
   *  message per subject in its Setup chat with a file_saved card and a card per piece of news. Then acknowledged. */
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
      for (const subjectId of new Set(items.map((i) => i.subjectId))) {
        if (!subjects.has(subjectId)) continue;
        const mine = items.filter((i) => i.subjectId === subjectId), files = mine.filter((i) => i.file), news = mine.filter((i) => !i.file).slice(-10);
        const cards: ClemCard[] = [
          ...(files.length ? [{ type: "file_saved" as const, subjectId, files: files.slice(0, 50).map((i) => ({ id: i.file!.id, name: i.file!.name, size: i.file!.size, type: i.file!.type, ...(i.file!.week ? { week: i.file!.week } : {}) })), ...(files.length > 50 ? { more: files.length - 50 } : {}) }] : []),
          ...news.map((i): ClemCard => i.kind === "new_announcement" ? { type: "announcement", subjectId, id: i.key.replace(/^ann:/, ""), courseKey: i.courseKey, title: i.title, ...(i.detail ? { detail: i.detail } : {}) }
            : i.kind === "new_grade" ? { type: "grade", subjectId, title: i.title, ...(i.detail ? { detail: i.detail } : {}) }
            : { type: "deadline", subjectId, id: i.key.replace(/^dl:/, "").split(":")[0], changed: i.kind === "deadline_changed", title: i.title, ...(i.detail ? { detail: i.detail } : {}) }),
        ];
        const lead = [files.length ? `Saved ${files.length} new file${files.length === 1 ? "" : "s"} from CMS.` : "", news.length ? `${news.length === 1 ? "Something new" : news.length + " new things"} on CMS.` : ""].filter(Boolean).join(" ");
        const blocks = cards.flatMap((c) => { try { return [cardBlock(c)]; } catch { return []; } });
        if (blocks.length) say(ensureChat(subjectId), lead + "\n\n" + blocks.join("\n\n"));
      }
      await gucAsk({ action: "gucAckInbox", keys: items.map((i) => i.key) });
    } catch { /* not connected, or the window closed mid-way: picked up next time */ } finally { inboxing = false; }
  }

  /** A new subject named after a CMS course, linked to it, with its setup thread open. */
  function createFromCourse(course: Pick<HubCourse, "key" | "code" | "name">, from?: string) {
    const space: Space = { id: uid(), name: course.name, description: course.code, kind: "subject", memory: "", sources: [] };
    deps.addSpace(space);
    // The subject whose card offered this goes on without a course.
    if (from) void answer(from, "link", { kind: "skip" }).catch(() => {});
    void begin(space.id, { courseKey: course.key });
    return space.id;
  }

  return { begin, resume, answer, reply, applyUpdates, note, postNewCourses, applyInbox, createFromCourse };
}
export type Setup = ReturnType<typeof createSetup>;

/** The card actions App hands every GUC card. */
export function cardActions(setup: Setup, app: Omit<GucActions, "answer" | "createFromCourse" | "openSetup">): GucActions {
  return { ...app, answer: (subjectId, step, reply) => setup.answer(subjectId, step, reply), createFromCourse: (c, from) => void setup.createFromCourse(c, from), openSetup: (subjectId) => void setup.begin(subjectId) };
}
