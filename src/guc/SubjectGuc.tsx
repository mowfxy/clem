// A subject's CMS tab (src/space/SpacePage.tsx). Linked: its course's files, announcements, deadlines, grades and
// classes (the hub's own views, scoped to the course) and every GUC setting as the same cards the chat shows.
// Not linked: a picker that puts the likeliest course first, and the setup chat.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { hubPath, PERIOD_TIMES, type HubCourse } from "../../core/guc/hub";
import { matchCourse } from "../../core/guc/match";
import type { Space, StoredFile } from "../../core/types";
import { Icon } from "../Icons";
import { EmptyState } from "../ui/Calm";
import { DriveFolder, SaveRules, Storage, dayShort, type GucActions } from "./GucCards";
import { Announcements, CourseFiles, Deadlines, Grades, Problem, Skeleton } from "./GucHub";
import { checkSubjectNow, unlinkSubject, useSubject } from "./subject";
import { confirmDialog } from "../dialogs";
import { useGuc } from "./useGuc";
import { SubjectPasswordBanner } from "./GucPassword";
import { PASSWORD_ROUTE } from "../../core/guc/password";
import "../library.css";
import "./guc.css";

const TABS = [["files", "Files"], ["announcements", "Announcements"], ["deadlines", "Deadlines"], ["grades", "Grades"], ["classes", "Classes"], ["settings", "Settings"]] as const;
type Tab = (typeof TABS)[number][0];
const ORDER = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];

export function SubjectGuc({ space, actions, onOpenFile, onToast }: { space: Space; actions: GucActions; onOpenFile: (file: StoredFile) => void; onToast: (message: string) => void }) {
  const v = useSubject(space.id), [tab, setTab] = useState<Tab>("files");
  const connect = () => actions.openHub("/app/guc");
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const b = bar.current?.querySelector<HTMLElement>("[aria-selected=true]");
    if (!bar.current || !b) return;
    bar.current.style.setProperty("--tab-x", b.offsetLeft + "px"); bar.current.style.setProperty("--tab-w", b.offsetWidth + "px"); bar.current.dataset.ready = "1";
  }, [tab, !!v.data?.course]);
  if (!v.data) return v.error ? <Problem message={v.error} onRetry={() => void v.reload()} onConnect={connect} /> : <Skeleton rows={4} />;
  const course = v.data.course;
  if (!course) return <LinkPicker space={space} actions={actions} />;
  const slots = [...v.data.slots].sort((a, b) => ORDER.indexOf(a.day.toLowerCase()) - ORDER.indexOf(b.day.toLowerCase()) || a.period - b.period);
  return <div className="guc-hub guc-subject">
    <SubjectPasswordBanner onUpdate={() => actions.openHub(PASSWORD_ROUTE)} />
    <CourseBar subjectId={space.id} course={course} actions={actions} />
    <nav className="guc-tabs" role="tablist" aria-label={`${course.code} on GUC`} ref={bar}>
      {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
        {label}{id === "announcements" && course.unread > 0 && <span className="guc-count">{course.unread}</span>}
      </button>)}
    </nav>
    <section className="guc-panel" role="tabpanel" aria-label={TABS.find(([id]) => id === tab)?.[1]} key={tab}>
      {tab === "files" ? <CourseFiles courseKey={course.key} linked onOpenFile={onOpenFile} onConnect={connect} onToast={onToast} />
        : tab === "announcements" ? <Announcements only={course.key} onConnect={connect} />
        : tab === "deadlines" ? <Deadlines courseKey={course.key} onConnect={connect} />
        : tab === "grades" ? <Grades courseKey={course.key} onConnect={connect} />
        : tab === "classes" ? (slots.length ? <ul className="guc-classes">{slots.map((s) => <li key={s.id}>
            <b>{dayShort(s.day)}</b><span>{s.start || PERIOD_TIMES[s.period - 1]?.[0]}–{s.end || PERIOD_TIMES[s.period - 1]?.[1]}</span><span>{s.type || "Class"}</span><small>{[s.location, s.group].filter(Boolean).join(" · ")}</small>
          </li>)}</ul> : <EmptyState scene="calendar" line={`No ${course.code} classes on your GUC schedule yet.`} />)
        : <div className="guc-settings-cards">
          {/* Clem looks at CMS every few minutes by itself, so there is no schedule to set; where files live is only a
              choice once a VPS is connected. */}
          <SaveRules subjectId={space.id} actions={actions} />
          <DriveFolder subjectId={space.id} actions={actions} />
          {v.data.vps && <Storage subjectId={space.id} actions={actions} />}
        </div>}
    </section>
  </div>;
}

/** The linked course as one slim line across the tab: what it is on the left, Open in CMS and Unlink on the right. */
function CourseBar({ subjectId, course, actions }: { subjectId: string; course: { key: string; code: string; name: string; season: string }; actions: GucActions }) {
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false);
  const check = () => { setChecking(true); void checkSubjectNow(subjectId).then((x) => actions.toast(x.lastCheck?.saved ? `Checked CMS just now · saved ${x.lastCheck.saved} file${x.lastCheck.saved === 1 ? "" : "s"}.` : "Checked CMS just now · nothing new."), (e) => actions.toast(String((e as Error)?.message || e))).finally(() => setChecking(false)); };
  const unlink = () => void confirmDialog({ title: `Unlink ${course.code}?`, message: "Clem stops checking this course for this subject. Files already saved stay.", confirm: "Unlink" })
    .then((yes) => { if (!yes) return; setBusy(true); return unlinkSubject(subjectId).catch((e) => actions.toast(String((e as Error)?.message || e))).finally(() => setBusy(false)); });
  return <div className="guc-course-bar">
    <Icon name="guc" size={16} />
    <span><b>{course.code}</b> {course.name}<small>{course.season}</small></span>
    <button type="button" className="lib-btn" disabled={checking} onClick={check}><Icon name="refresh" size={14} />{checking ? "Checking…" : "Check now"}</button>
    <button type="button" className="lib-btn" onClick={() => actions.openHub(hubPath("cms", course.key))}><Icon name="external" size={14} />Open in CMS</button>
    <button type="button" className="lib-btn" disabled={busy} onClick={unlink}>Unlink</button>
  </div>;
}

/** Courses no other subject has, the likeliest first; linking one starts setup the first time. */
function LinkPicker({ space, actions }: { space: Space; actions: GucActions }) {
  const courses = useGuc<HubCourse[]>({ action: "gucCourses" }), [all, setAll] = useState(false), [busy, setBusy] = useState("");
  const free = useMemo(() => (courses.data || []).filter((c) => !c.subjectId || c.subjectId === space.id), [courses.data, space.id]);
  const m = useMemo(() => matchCourse({ name: space.name, description: space.description }, free.filter((c) => c.active)), [free, space.name, space.description]);
  if (!courses.data) return courses.error ? <Problem message={courses.error} onRetry={() => void courses.reload()} onConnect={() => actions.openHub("/app/guc")} /> : <Skeleton rows={3} />;
  const likely = [m.best, ...m.alternatives].filter(Boolean).map((c) => c!.item);
  const shown = all ? [...likely, ...free.filter((c) => !likely.includes(c))] : likely.length ? likely.slice(0, 3) : free.filter((c) => c.active).slice(0, 6);
  const link = (c: HubCourse) => { setBusy(c.key); void actions.answer(space.id, "link", { kind: "link", courseKey: c.key }).catch((e) => actions.toast(String((e as Error)?.message || e))).finally(() => setBusy("")); };
  if (!free.length) return <EmptyState scene="link" line="Every CMS course is already linked to a subject."><button type="button" className="secondary" onClick={() => actions.openHub(hubPath("cms"))}><Icon name="guc" size={16} />Browse CMS courses</button></EmptyState>;
  return <div className="guc-subject guc-link-pick">
    <header><b>Link a CMS course</b><span>Its files, announcements, deadlines and grades then show here, and Clem checks it for new files.</span></header>
    <ul>
      {shown.map((c, i) => <li key={c.key} className={i === 0 && m.sure && !all ? "is-best" : ""}>
        <span><b>{c.code}</b>{c.name}<small>{c.season}{i === 0 && m.sure && !all ? " · Best match" : ""}</small></span>
        <button type="button" className={i === 0 && m.sure ? "primary" : "secondary"} disabled={!!busy} onClick={() => link(c)}>{busy === c.key ? "Linking…" : "Link"}</button>
      </li>)}
    </ul>
    <footer>
      {!all && free.length > shown.length && <button type="button" className="secondary" onClick={() => setAll(true)}>Show all courses</button>}
      <button type="button" className="secondary" onClick={() => actions.openSetup(space.id)}><Icon name="chat" size={15} />Set up in a chat</button>
    </footer>
  </div>;
}
