// A subject's GUC cards (```clem-card course_link, save_rules, check_schedule, drive_folder, storage, setup_done,
// settings_update, new_courses): drawn like Clem's other proposal cards, showing the subject's live settings from the
// engine (src/guc/subject.ts), never a copy frozen in the message. Edits show at once and are written back behind.
// The same cards sit on the subject page and in Settings → Connectors → GUC.
import { useEffect, useState, type ReactNode } from "react";
import type { ClemCard, FileSavedCard, NewCoursesCard, NewsCard, SettingsUpdateCard } from "../../core/guc/cards";
import { hubPath, relativeDue, weekLabel, type HubCourse } from "../../core/guc/hub";
import { SAVE_KINDS, SAVE_LABELS, describeSaveRules, hasFilters } from "../../core/guc/rules";
import { DAY_NAMES, GUC_DAYS, dailyChecks, describeChecks, nextRuns, type CheckSchedule } from "../../core/guc/schedule-rules";
import type { StoredFile } from "../../core/types";
import { nextStep, updateSummary, type Reply, type SetupStep } from "../../core/guc/setup-flow";
import type { SubjectView } from "../../core/guc/settings";
import { Icon } from "../Icons";
import { confirmDialog } from "../dialogs";
import { Switch } from "../settings/SettingsParts";
import { sizeLabel } from "../store";
import { PickMenu } from "../ui/PickMenu";
import { checkSubjectNow, editSubject, unlinkSubject, useSubject } from "./subject";
import { useGuc } from "./useGuc";
import "./guc.css";

/** What GUC cards ask of the app: the setup thread, subjects, Drive and navigation (src/guc/setup.ts, App.tsx). */
export type GucActions = {
  /** A setup answer from a card's buttons (Link, Looks good, Skip). Linking outside setup goes here too. */
  answer: (subjectId: string, step: SetupStep, reply: Reply) => Promise<void>;
  /** A new subject made from a CMS course, linked, with its own setup thread. `from`: the subject whose card offered it. */
  createFromCourse: (course: Pick<HubCourse, "key" | "code" | "name">, from?: string) => void;
  /** Opens the subject's setup chat, starting it the first time. */
  openSetup: (subjectId: string) => void;
  openHub: (path: string) => void;
  openSpace: (subjectId: string) => void;
  spaceName: (subjectId: string) => string | undefined;
  /** Chooses the Drive folder the subject's CMS copies go to (its week folders are made inside). */
  pickDrive: (subjectId: string) => void;
  openDriveWeb: (folderId: string) => void;
  /** Settings → Connectors, where Google Drive is connected again. */
  reconnectDrive: () => void;
  /** A saved file in Clem's viewer; the subject's Files tab; a new chat in the subject that summarizes a file. */
  openFile: (file: StoredFile) => void;
  showFiles: (subjectId: string) => void;
  summarize: (subjectId: string, file: { id: string; name: string }) => void;
  toast: (message: string) => void;
};
type GucCard = Extract<ClemCard, { type: "course_link" | "save_rules" | "check_schedule" | "drive_folder" | "storage" | "setup_done" | "settings_update" | "new_courses" | "file_saved" | "announcement" | "grade" | "deadline" }>;
export const GUC_CARDS = new Set<string>(["course_link", "save_rules", "check_schedule", "drive_folder", "storage", "setup_done", "settings_update", "new_courses", "file_saved", "announcement", "grade", "deadline"]);

const clean = (e: unknown) => String((e as Error)?.message || e || "").replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
/** The step the setup thread is waiting on, from the live settings. */
export const pendingStep = (v?: SubjectView) => (v?.settings.setup && !v.settings.setup.finished ? nextStep(v.settings.setup, { linked: !!v.course, vps: v.vps }) : null);
const fail = (actions?: GucActions) => (e: unknown) => actions?.toast(clean(e) || "That didn't save. Try again.");

function Frame({ icon, title, sub, children, footer, className = "", busy }: { icon: string; title: ReactNode; sub?: ReactNode; children?: ReactNode; footer?: ReactNode; className?: string; busy?: boolean }) {
  return <div className={`edit-proposal clem-card guc-card ${className}`} aria-busy={busy || undefined}>
    <header><Icon name={icon} size={16} /><div><strong>{title}</strong>{sub && <small>{sub}</small>}</div></header>
    {children && <div className="guc-card-body">{children}</div>}
    {footer && <footer>{footer}</footer>}
  </div>;
}
const Loading = ({ icon }: { icon: string }) => <Frame icon={icon} title={<span className="guc-card-skel" />} sub={<span className="guc-card-skel short" />} busy />;
/** "Looks good" and "Skip" while the setup thread waits on this card. */
function SetupButtons({ subjectId, step, actions, busy, confirm = "Looks good" }: { subjectId: string; step: SetupStep; actions?: GucActions; busy: boolean; confirm?: string }) {
  if (!actions) return null;
  return <><button type="button" disabled={busy} onClick={() => void actions.answer(subjectId, step, { kind: "skip" })}>Skip</button>
    <button type="button" className="primary" disabled={busy} onClick={() => void actions.answer(subjectId, step, { kind: "confirm" })}>{confirm}</button></>;
}

export function GucCardView({ card, actions, spaceId }: { card: GucCard; actions?: GucActions; spaceId?: string | null }) {
  if (card.type === "new_courses") return <NewCourses card={card} actions={actions} />;
  if (card.type === "file_saved") return <FileSaved card={card} actions={actions} />;
  if (card.type === "announcement" || card.type === "grade" || card.type === "deadline") return <News card={card} actions={actions} />;
  if (card.type === "settings_update") return <Updated card={card} actions={actions} subjectId={card.subjectId || spaceId || ""} />;
  if (card.type === "setup_done") return <SetupDone subjectId={card.subjectId} actions={actions} />;
  const setup = !!card.setup;
  if (card.type === "course_link") return <CourseLink subjectId={card.subjectId} suggest={card.suggest} setup={setup} actions={actions} />;
  if (card.type === "save_rules") return <SaveRules subjectId={card.subjectId} setup={setup} actions={actions} />;
  if (card.type === "check_schedule") return <CheckSchedule subjectId={card.subjectId} setup={setup} actions={actions} />;
  if (card.type === "drive_folder") return <DriveFolder subjectId={card.subjectId} setup={setup} actions={actions} />;
  return <Storage subjectId={card.subjectId} setup={setup} actions={actions} />;
}

// ---------- The CMS course ----------
export function CourseLink({ subjectId, suggest, setup = false, actions }: { subjectId: string; suggest?: string; setup?: boolean; actions?: GucActions }) {
  const v = useSubject(subjectId), courses = useGuc<HubCourse[]>({ action: "gucCourses" });
  const [picking, setPicking] = useState(false), [busy, setBusy] = useState(false);
  if (!v.data) return <Loading icon="guc" />;
  const waiting = setup && pendingStep(v.data) === "link";
  const run = (job: () => Promise<unknown>) => { setBusy(true); void job().catch(fail(actions)).finally(() => setBusy(false)); };
  const link = (key: string) => actions && run(() => actions.answer(subjectId, "link", { kind: "link", courseKey: key }));
  const c = v.data.course;
  if (c) return <Frame icon="guc" title={<><b>{c.code}</b> {c.name}</>} sub={`Linked · ${c.season}`} footer={<>
    <button type="button" onClick={() => actions?.openHub(hubPath("cms", c.key))}><Icon name="external" size={14} />Open in CMS</button>
    <button type="button" disabled={busy} onClick={() => void confirmDialog({ title: `Unlink ${c.code}?`, message: "Clem stops checking this course for this subject. Files already saved stay.", confirm: "Unlink" }).then((yes) => yes && run(() => unlinkSubject(subjectId)))}>Unlink</button>
  </>} />;
  const list = (courses.data || []).filter((x) => x.active && (!x.subjectId || x.subjectId === subjectId));
  const guess = !picking ? (courses.data || []).find((x) => x.key === suggest && (!x.subjectId || x.subjectId === subjectId)) : undefined;
  const picker = <PickMenu label="CMS course" value="" placeholder={courses.data ? "Pick a course" : "Loading courses…"} options={list.map((x) => ({ value: x.key, label: `${x.code} · ${x.name}` }))} onChange={(key) => key && link(key)} />;
  return <Frame icon="guc" busy={busy} title={guess ? <><b>{guess.code}</b> {guess.name}</> : "No CMS course linked"} sub={guess ? `${guess.season} · on CMS` : "Pick its course on CMS"}
    footer={<>
      {waiting && <button type="button" disabled={busy} onClick={() => void actions?.answer(subjectId, "link", { kind: "skip" })}>Skip</button>}
      {guess && actions && <button type="button" disabled={busy} onClick={() => actions.createFromCourse(guess, subjectId)}>New subject from this course</button>}
      {guess ? <><button type="button" disabled={busy} onClick={() => setPicking(true)}>Change</button><button type="button" className="primary" disabled={busy} onClick={() => link(guess.key)}>Link</button></> : picker}
    </>} />;
}

// ---------- What to save ----------
export function SaveRules({ subjectId, setup = false, actions }: { subjectId: string; setup?: boolean; actions?: GucActions }) {
  const v = useSubject(subjectId);
  if (!v.data) return <Loading icon="download" />;
  const rules = v.data.settings.save, waiting = setup && pendingStep(v.data) === "save", filters = hasFilters(rules);
  const clear = () => void editSubject(subjectId, { save: { types: null, weeks: null, names: null, maxMB: null } }).catch(fail(actions));
  return <Frame icon="download" title="What Clem saves from CMS" sub={describeSaveRules(rules)}
    footer={(filters || waiting) && <>{filters && <button type="button" onClick={clear}>Clear filters</button>}{waiting && <SetupButtons subjectId={subjectId} step="save" actions={actions} busy={false} />}</>}>
    <div className="guc-chips" role="group" aria-label="File kinds to save">
      {SAVE_KINDS.map((k) => { const on = rules.kinds[k]; return <button key={k} type="button" className="guc-chip" aria-pressed={on} onClick={() => void editSubject(subjectId, { save: { kinds: { [k]: !on } } }).catch(fail(actions))}>
        {on && <Icon name="check" size={13} />}{SAVE_LABELS[k]}
      </button>; })}
    </div>
    {!filters && setup && <p className="guc-card-line">Or say it, like “only PDFs from week 3” or “nothing over 50 MB”.</p>}
  </Frame>;
}

// ---------- When to check ----------
function useNow(every = 30_000) { const [now, setNow] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), every); return () => clearInterval(t); }, [every]); return now; }
/** "Sun 15 Nov, 12:00" on Cairo's clock. */
const runLabel = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t).replace(/^(\w+) (\d+ \w+),? /, "$1 $2, ");
/** One time on every GUC day (Friday too or not), nothing else: what the Daily button makes or "every day at 8pm". */
const isDaily = (c: CheckSchedule) => c.mode === "custom" && !c.every && !c.during && new Set(c.times.map((t) => t.day)).size === c.times.length && new Set(c.times.map((t) => t.time)).size === 1 && GUC_DAYS.every((d) => c.times.some((t) => t.day === d));
export function CheckSchedule({ subjectId, setup = false, actions }: { subjectId: string; setup?: boolean; actions?: GucActions }) {
  const v = useSubject(subjectId), now = useNow(), [checking, setChecking] = useState(false);
  if (!v.data) return <Loading icon="clock" />;
  const { check } = v.data.settings, after = v.data.suggested.mode === "after_lectures", waiting = setup && pendingStep(v.data) === "check";
  const daily = isDaily(check) ? check.times[0].time : "20:00", custom = check.mode === "custom" && !isDaily(check);
  const set = (patch: Parameters<typeof editSubject>[1]) => void editSubject(subjectId, patch).catch(fail(actions));
  const next = v.data.nextCheck ? relativeDue(v.data.nextCheck, now) : undefined, runs = v.data.course ? nextRuns(check, now, 3) : [];
  const checkNow = () => { setChecking(true); void checkSubjectNow(subjectId).then((x) => actions?.toast(x.lastCheck?.saved ? `Checked CMS just now · saved ${x.lastCheck.saved} file${x.lastCheck.saved === 1 ? "" : "s"}.` : "Checked CMS just now · nothing new."), fail(actions)).finally(() => setChecking(false)); };
  return <Frame icon="clock" title="When Clem checks CMS" sub={!v.data.course ? "Link a CMS course first" : next ? `Next check ${next.label} (${next.date})` : check.during ? "Waiting for its dates" : "Checks are off"}
    footer={<>{v.data.course && <button type="button" disabled={checking} onClick={checkNow}><Icon name="refresh" size={14} />{checking ? "Checking…" : "Check now"}</button>}{waiting && <SetupButtons subjectId={subjectId} step="check" actions={actions} busy={false} />}</>}>
    <div className="guc-seg" role="radiogroup" aria-label="When to check">
      {after && <button type="button" role="radio" aria-checked={check.mode === "after_lectures"} onClick={() => set({ check: v.data!.suggested })}>After lectures</button>}
      <button type="button" role="radio" aria-checked={isDaily(check)} onClick={() => set({ check: { mode: "custom", times: dailyChecks(daily), tz: check.tz } })}>Daily</button>
      {custom && <button type="button" role="radio" aria-checked>Custom</button>}
      <button type="button" role="radio" aria-checked={check.mode === "off"} onClick={() => set({ check: { mode: "off", times: [], tz: check.tz } })}>Off</button>
      {isDaily(check) && <label className="guc-time"><span>at</span><input type="time" aria-label="Check time" value={daily} onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && set({ check: { mode: "custom", times: check.times.map((t) => ({ ...t, time: e.target.value })), tz: check.tz } })} /></label>}
    </div>
    <p className="guc-card-line">{describeChecks(check)}{check.mode !== "off" ? " · Cairo time" : ""}</p>
    {runs.length > 1 && <p className="guc-card-line">Coming up: {runs.map(runLabel).join(" · ")}</p>}
    {v.data.lastCheck && <p className="guc-card-line">Last checked {relativeDue(v.data.lastCheck.at, now).label}{v.data.lastCheck.error ? " · it didn't finish" : v.data.lastCheck.saved ? ` · saved ${v.data.lastCheck.saved}` : ""}</p>}
  </Frame>;
}

// ---------- Google Drive ----------
export function DriveFolder({ subjectId, setup = false, actions }: { subjectId: string; setup?: boolean; actions?: GucActions }) {
  const v = useSubject(subjectId);
  if (!v.data) return <Loading icon="drive" />;
  const d = v.data.settings.drive, live = v.data.drive, waiting = setup && pendingStep(v.data) === "drive";
  const chosen = !!(d.folderId && d.folderName), reconnect = d.enabled && live.error === "reconnect";
  const status = !d.enabled ? "Saved files stay on this device only." : reconnect ? "Google Drive is disconnected, so copies are waiting."
    : live.error ? live.message || "The last copy didn't finish. Clem tries again on the next check."
    : live.copied || live.waiting ? `${live.copied} copied${live.waiting ? ` · ${live.waiting} waiting` : ""} · a folder per week` : "Saved files are copied here, a folder per week.";
  return <Frame icon="drive" title="Copy to Google Drive" sub={d.enabled ? `Folder: ${live.path}` : "Off"}
    footer={<>
      {reconnect && <button type="button" className="primary" onClick={() => actions?.reconnectDrive()}>Reconnect Drive</button>}
      {d.enabled && live.folderId && !reconnect && <button type="button" onClick={() => actions?.openDriveWeb(live.folderId!)}><Icon name="external" size={14} />Open</button>}
      {d.enabled && <button type="button" onClick={() => actions?.pickDrive(subjectId)}>Change folder</button>}
      {d.enabled && chosen && <button type="button" onClick={() => void editSubject(subjectId, { drive: { folderId: "", folderName: "" } }).catch(fail(actions))}>Use Clem/GUC</button>}
      {waiting && <SetupButtons subjectId={subjectId} step="drive" actions={actions} busy={false} confirm="Done" />}
    </>}>
    <label className="guc-switch-row"><span>Keep a copy of saved files there</span><Switch label="Copy saved files to Google Drive" checked={d.enabled} onChange={(on) => void editSubject(subjectId, { drive: { enabled: on } }).catch(fail(actions))} /></label>
    <p className="guc-card-line">{status}</p>
  </Frame>;
}

// ---------- Where files live ----------
export function Storage({ subjectId, setup = false, actions }: { subjectId: string; setup?: boolean; actions?: GucActions }) {
  const v = useSubject(subjectId);
  if (!v.data) return <Loading icon="device" />;
  const { location } = v.data.settings.storage, s = v.data.storage, waiting = setup && pendingStep(v.data) === "storage";
  const pick = (to: "device" | "vps") => void editSubject(subjectId, { storage: { location: to } }).catch(fail(actions));
  const split = s.files ? (s.onVps ? `${s.onVps} on your VPS, ${s.files - s.onVps} on this device · ${sizeLabel(s.bytes)}` : `${s.files} file${s.files === 1 ? "" : "s"}, ${sizeLabel(s.bytes)}`) : "nothing saved yet";
  // "Store my files on my VPS" (Settings → Connectors → VPS) decides for every file, so there is nothing to pick here.
  if (v.data.vpsFiles) return <Frame icon="server" title="Where files live" sub={`On your VPS · ${split}`} footer={waiting && <SetupButtons subjectId={subjectId} step="storage" actions={actions} busy={false} confirm="Sounds good" />}>
    <p className="guc-card-line">Files will be stored on your VPS. This device keeps recent and pinned ones so they open instantly.</p>
  </Frame>;
  return <Frame icon="device" title="Where files live" sub={`${location === "vps" ? "On your VPS" : "On this device"} · ${split}`}
    footer={waiting && <SetupButtons subjectId={subjectId} step="storage" actions={actions} busy={false} />}>
    <div className="guc-seg" role="radiogroup" aria-label="Where files live">
      <button type="button" role="radio" aria-checked={location === "device"} onClick={() => pick("device")}>This device</button>
      <button type="button" role="radio" aria-checked={location === "vps"} disabled={!v.data.vps} title={v.data.vps ? undefined : "Connect a VPS in Settings first"} onClick={() => pick("vps")}>My VPS</button>
    </div>
    {!v.data.vps && <p className="guc-card-line">Connect a VPS in Settings to keep files there.</p>}
  </Frame>;
}

// ---------- The end of setup: every setting, each one editable ----------
export function SetupDone({ subjectId, actions }: { subjectId: string; actions?: GucActions }) {
  const v = useSubject(subjectId), [open, setOpen] = useState<string | null>(null);
  if (!v.data) return <Loading icon="check" />;
  const s = v.data.settings, rows: [string, string, string][] = [
    ["link", "CMS course", v.data.course ? `${v.data.course.code} ${v.data.course.name}` : "Not linked"],
    ...(v.data.course ? [["save", "Saving", describeSaveRules(s.save)], ["check", "Checks", describeChecks(s.check)]] as [string, string, string][] : []),
    ["drive", "Google Drive", s.drive.enabled ? "Copying" : "Off"],
    ...(v.data.vps ? [["storage", "Files live", s.storage.location === "vps" ? "On your VPS" : "On this device"]] as [string, string, string][] : []),
  ];
  const Card = { link: CourseLink, save: SaveRules, check: CheckSchedule, drive: DriveFolder, storage: Storage }[open as SetupStep];
  return <Frame icon="check" title={`${actions?.spaceName(subjectId) || "This subject"} is set up`} sub="Tap a line to change it">
    <ul className="guc-summary">
      {rows.map(([id, label, value]) => <li key={id}><button type="button" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}><span>{label}</span><b>{value}</b><Icon name="down" size={13} /></button></li>)}
    </ul>
    {Card && <div className="guc-summary-edit"><Card subjectId={subjectId} actions={actions} /></div>}
  </Frame>;
}

// ---------- A change the AI made on request ----------
function Updated({ card, subjectId, actions }: { card: SettingsUpdateCard; subjectId: string; actions?: GucActions }) {
  const v = useSubject(subjectId || null);
  const now = v.data && (card.save ? `Saving: ${describeSaveRules(v.data.settings.save)}` : card.check ? `Checks: ${describeChecks(v.data.settings.check)}` : card.drive ? `Drive copy ${v.data.settings.drive.enabled ? "on" : "off"}` : v.data.course ? `Linked to ${v.data.course.code}` : "No CMS course linked");
  return <Frame icon="sliders" className="guc-updated" title={updateSummary(card)} sub={[actions?.spaceName(subjectId), now].filter(Boolean).join(" · ")} />;
}

// ---------- A new semester ----------
function NewCourses({ card, actions }: { card: NewCoursesCard; actions?: GucActions }) {
  const courses = useGuc<HubCourse[]>({ action: "gucCourses" }).data;
  const n = card.courses.length;
  return <Frame icon="guc" title={`${n} new course${n === 1 ? "" : "s"} this semester`} sub="Set them up? Each gets its own subject and a short setup chat.">
    <ul className="guc-new">
      {card.courses.map((c) => {
        const linked = courses?.find((x) => x.key === c.key)?.subjectId, name = linked && actions?.spaceName(linked);
        return <li key={c.key}><span className="guc-new-name"><b>{c.code}</b>{c.name}</span>
          {linked ? <button type="button" onClick={() => actions?.openSpace(linked)}><Icon name="check" size={13} />{name ? `Open ${name}` : "Set up"}</button>
            : <button type="button" className="primary" onClick={() => actions?.createFromCourse(c)}>Set up</button>}
        </li>;
      })}
    </ul>
  </Frame>;
}

// ---------- What a check saved ----------
function FileSaved({ card, actions }: { card: FileSavedCard; actions?: GucActions }) {
  const n = card.files.length + (card.more || 0), name = actions?.spaceName(card.subjectId);
  const asFile = (f: FileSavedCard["files"][number]): StoredFile => ({ id: "guc_" + f.id, name: f.name, type: f.type || "application/octet-stream", size: f.size || 0, created: Date.now(), spaceId: card.subjectId });
  return <Frame icon="download" title={`Saved ${n} new file${n === 1 ? "" : "s"} from CMS`} sub={name ? `In ${name}'s Files` : "In this subject's Files"}
    footer={<button type="button" onClick={() => actions?.showFiles(card.subjectId)}><Icon name="files" size={14} />Show in Files</button>}>
    <ul className="guc-new guc-saved">
      {card.files.map((f) => <li key={f.id}>
        <span className="guc-new-name"><span className="guc-saved-name">{f.name}</span>{(f.size || f.week) && <small>{[f.size ? sizeLabel(f.size) : "", f.week ? weekLabel(f.week) : ""].filter(Boolean).join(" · ")}</small>}</span>
        <button type="button" onClick={() => actions?.openFile(asFile(f))} aria-label={`Preview ${f.name}`}>Preview</button>
        <button type="button" onClick={() => actions?.summarize(card.subjectId, { id: "guc_" + f.id, name: f.name })} aria-label={`Summarize ${f.name}`}>Summarize</button>
      </li>)}
    </ul>
    {card.more ? <p className="guc-card-line">and {card.more} more in Files</p> : null}
  </Frame>;
}

// ---------- News a check found ----------
function News({ card, actions }: { card: NewsCard; actions?: GucActions }) {
  const [icon, path] = card.type === "announcement" ? ["megaphone", hubPath("announcements", card.id)] : card.type === "grade" ? ["spark", hubPath("grades")] : ["hourglass", hubPath("deadlines", card.id)];
  return <Frame icon={icon} className="guc-news" title={card.title} sub={card.detail}
    footer={<button type="button" onClick={() => actions?.openHub(path)}><Icon name="external" size={14} />{card.type === "announcement" ? "Open announcement" : card.type === "grade" ? "Open grades" : "Open deadlines"}</button>} />;
}

/** A day name for the check list ("Sun"), exported for the subject page's classes. */
export const dayShort = (day: string) => DAY_NAMES.find((d) => d.toLowerCase() === day.toLowerCase())?.slice(0, 3) || day.slice(0, 3);
