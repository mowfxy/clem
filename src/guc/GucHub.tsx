// The GUC hub (#/app/guc/<tab>/<id>/<sub>): schedule, announcements, CMS files, grades and deadlines from the engine's
// database. Every tab draws its cached copy on the first frame and refreshes behind it (src/guc/useGuc.ts).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { hubPath, relativeDue, sortDeadlines, weekGrid, weekLabel, weekStart, addDays, type HubAnnouncement, type HubCourse, type HubDeadline, type HubGrade, type HubHit, type HubMail, type HubTerm, type HubMaterial, type HubMaterials, type HubOverview, type HubRoute, type HubSchedule, type HubTab, type Page } from "../../core/guc/hub";
import type { GucProgress } from "../../core/guc/types";
import { sameCode } from "../../core/guc/codes";
import { matchSubject } from "../../core/guc/match";
import type { Space, StoredFile } from "../../core/types";
import { Icon } from "../Icons";
import { desktop } from "../desktop/bridge";
import { FileGlyph } from "../files/FileGlyph";
import { download, getBlob } from "../store";
import { EmptyState, PageHead } from "../ui/Calm";
import { PickMenu } from "../ui/PickMenu";
import type { GucActions } from "./GucCards";
import { gucAsk, gucCache, gucPatch, gucPrefetch, useGuc } from "./useGuc";
import { PasswordBanner } from "./GucPassword";
import { PASSWORD_ROUTE } from "../../core/guc/password";
import "../library.css";
import "./guc.css";

const TABS: [HubTab, string][] = [["schedule", "Schedule"], ["announcements", "Announcements"], ["cms", "CMS"], ["grades", "Grades"], ["exams", "Exams"], ["deadlines", "Deadlines"], ["mail", "Mail"]];
/** What each part of GUC is called when a sync couldn't read it. */
const PART_NAMES: Record<string, string> = { courses: "your course list", schedule: "your schedule", grades: "this term's grades", exams: "exam seats", transcript: "your transcript", mail: "your GUC mail" };
const clean = (e: unknown) => String((e as Error)?.message || e || "").replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
const authFailed = (m?: string) => !!m && /password|connect guc first|sign in again/i.test(m);
const ago = (t?: number) => { if (!t) return "Not synced yet"; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "Synced just now" : m < 60 ? `Synced ${m} min ago` : m < 1440 ? `Synced ${Math.round(m / 60)} h ago` : "Synced " + new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }); };
const asFile = (m: { id: string; name: string; type: string; firstSeen?: number }): StoredFile => ({ id: "guc_" + m.id, name: m.name, type: m.type, size: 0, created: m.firstSeen || Date.now(), spaceId: null, remote: true });

function useNow(every = 60_000) { const [now, setNow] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), every); return () => clearInterval(t); }, [every]); return now; }
function scrollerOf(node: Element | null): HTMLElement | null {
  for (let el = node?.parentElement; el; el = el.parentElement) if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/** Placeholder rows while a tab has nothing cached yet: never a blank page. */
export function Skeleton({ rows = 5, tall = false }: { rows?: number; tall?: boolean }) {
  return <div className="guc-skel" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <span key={i} className={tall ? "tall" : ""} />)}</div>;
}
export function Problem({ message, onRetry, onConnect }: { message: string; onRetry: () => void; onConnect: () => void }) {
  const auth = authFailed(message);
  return <div className="guc-problem" role="alert">
    <Icon name="alert" size={18} />
    <p>{auth ? "GUC didn't accept your password. Sign in again to see the latest." : message || "Clem couldn't read your GUC data."}</p>
    {auth ? <button type="button" className="lib-btn strong" onClick={onConnect}>Reconnect</button> : <button type="button" className="lib-btn" onClick={onRetry}><Icon name="refresh" size={15} />Try again</button>}
  </div>;
}

/** Rows in the page's own scroll, only the ones near the view mounted. */
function VList<T>({ items, keyOf, estimate, render, onEnd, scrollTo, label }: { items: T[]; keyOf: (t: T) => string; estimate: (t: T) => number; render: (t: T, i: number) => ReactNode; onEnd?: () => void; scrollTo?: number; label?: string }) {
  const list = useRef<HTMLDivElement>(null), scroller = useRef<HTMLElement | null>(null);
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => { const el = (scroller.current = scrollerOf(list.current)); if (el && list.current) setMargin(Math.round(list.current.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop)); }, []);
  const virtual = useVirtualizer({ count: items.length, getScrollElement: () => scroller.current, estimateSize: (i) => estimate(items[i]), getItemKey: (i) => keyOf(items[i]), overscan: 8, scrollMargin: margin, initialRect: { width: 800, height: typeof window === "undefined" ? 900 : window.innerHeight } });
  const shown = virtual.getVirtualItems();
  useEffect(() => { if (onEnd && shown.length && shown[shown.length - 1].index >= items.length - 4) onEnd(); }, [shown.at(-1)?.index, items.length]);
  useEffect(() => { if (scrollTo !== undefined && scrollTo >= 0) virtual.scrollToIndex(scrollTo, { align: "center" }); }, [scrollTo, margin]);
  return <div ref={list} className="guc-vlist" role="list" aria-label={label} style={{ height: virtual.getTotalSize() }}>
    {shown.map((v) => <div key={v.key} role="listitem" data-index={v.index} ref={virtual.measureElement} className="guc-vrow" style={{ transform: `translateY(${v.start - margin}px)` }}>{render(items[v.index], v.index)}</div>)}
  </div>;
}

export function GucHub({ route, go, onOpenFile, onConnect, onToast, actions, subjects = [] }: { route: HubRoute; go: (path: string) => void; onOpenFile: (file: StoredFile) => void; onConnect: () => void; onToast: (message: string) => void; actions?: GucActions; subjects?: Space[] }) {
  const overview = useGuc<HubOverview>({ action: "gucOverview" });
  const o = overview.data;
  const [syncing, setSyncing] = useState(false), [progress, setProgress] = useState("");
  useEffect(() => desktop?.onGuc?.((p: GucProgress) => setProgress(p.phase === "done" ? "" : p.label)), []);
  const sync = async () => {
    setSyncing(true);
    try { await gucAsk({ action: "gucSync" }); } catch {} finally { setSyncing(false); setProgress(""); void gucCache.revalidateAll(); }
  };
  const tabBar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const bar = tabBar.current, b = bar?.querySelector<HTMLElement>("[aria-selected=true]");
    if (!bar || !b) return;
    bar.style.setProperty("--tab-x", b.offsetLeft + "px"); bar.style.setProperty("--tab-w", b.offsetWidth + "px"); bar.dataset.ready = "1";
  }, [route.tab, o?.connected]);

  if (!desktop) return <div className="page lib guc-hub"><PageHead title="GUC" /><EmptyState scene="plug" line="GUC works in the Clem desktop app." /></div>;
  if (!o) return <div className="page lib guc-hub">{overview.error ? <><PageHead title="GUC" /><Problem message={overview.error} onRetry={() => void overview.reload()} onConnect={onConnect} /></> : <><PageHead title="GUC" line=" " /><Skeleton rows={6} tall /></>}</div>;
  if (!o.connected) return <div className="page lib guc-hub">
    <PageHead title="GUC" line="Your schedule, announcements, files, grades and deadlines in one place." />
    <EmptyState scene="plug" line="Connect your GUC account to see them here.">
      <button type="button" className="lib-btn strong" onClick={onConnect}><Icon name="guc" size={16} />Connect GUC</button>
    </EmptyState>
  </div>;

  const busy = syncing || o.syncing;
  const counts: Partial<Record<HubTab, number>> = { announcements: o.counts.unread, deadlines: o.counts.deadlines, exams: o.counts.exams, mail: o.counts.mail };
  const missed = (o.missed || []).filter((m) => m !== "courses" || !o.error).map((m) => PART_NAMES[m] || m);
  return <div className="page lib guc-hub">
    <PageHead title="GUC" line={busy ? progress || "Syncing…" : ago(o.lastSync)}>
      <button type="button" className="lib-btn" disabled={busy} onClick={() => void sync()}><Icon name="refresh" size={15} />{busy ? "Syncing" : "Sync now"}</button>
    </PageHead>
    {o.passwordNeeded ? <PasswordBanner onUpdate={() => go(PASSWORD_ROUTE)} /> : o.error && <div className="guc-banner" role="status">
      <Icon name="alert" size={16} /><span>{o.error.kind === "auth" ? "GUC didn't accept your password, so this may be out of date." : o.error.message}</span>
      {o.error.kind === "auth" ? <button type="button" className="lib-btn strong" onClick={onConnect}>Reconnect</button> : <button type="button" className="lib-btn" disabled={busy} onClick={() => void sync()}>Try again</button>}
    </div>}
    {!o.passwordNeeded && !o.error && missed.length > 0 && !busy && <div className="guc-banner is-soft" role="status">
      <Icon name="alert" size={16} /><span>GUC didn’t let Clem read {missed.length > 1 ? missed.slice(0, -1).join(", ") + " and " + missed.at(-1) : missed[0]} this time. The rest is up to date; Clem keeps trying every few minutes.</span>
    </div>}
    <nav className="guc-tabs" role="tablist" aria-label="GUC" ref={tabBar}>
      {TABS.map(([id, label], i) => <button key={id} type="button" role="tab" aria-selected={route.tab === id} tabIndex={route.tab === id ? 0 : -1} className={route.tab === id ? "active" : ""}
        onClick={() => go(hubPath(id))}
        onPointerEnter={() => prefetchTab(id)} onFocus={() => prefetchTab(id)}
        onKeyDown={(e) => { const to = e.key === "ArrowRight" ? (i + 1) % TABS.length : e.key === "ArrowLeft" ? (i - 1 + TABS.length) % TABS.length : -1; if (to < 0) return; e.preventDefault(); go(hubPath(TABS[to][0])); requestAnimationFrame(() => tabBar.current?.querySelectorAll<HTMLButtonElement>("[role=tab]")[to]?.focus()); }}>
        {label}{!!counts[id] && <span className="guc-count">{counts[id]}</span>}
      </button>)}
    </nav>
    <section className="guc-panel" role="tabpanel" aria-label={TABS.find(([id]) => id === route.tab)?.[1]} key={route.tab}>
      {route.tab === "schedule" ? <Schedule week={route.id} go={go} onConnect={onConnect} />
        : route.tab === "announcements" ? <Announcements focus={route.id} onConnect={onConnect} />
        : route.tab === "cms" ? <Cms course={route.id} material={route.sub} go={go} onOpenFile={onOpenFile} onConnect={onConnect} onToast={onToast} actions={actions} subjects={subjects} />
        : route.tab === "grades" ? <><ThisTerm onConnect={onConnect} /><Grades onConnect={onConnect} /></>
        : route.tab === "exams" ? <Exams onConnect={onConnect} />
        : route.tab === "mail" ? <Mail onConnect={onConnect} />
        : <Deadlines focus={route.id} onConnect={onConnect} />}
    </section>
  </div>;
}

/** Hovering a tab warms what it shows first. */
function prefetchTab(tab: HubTab) {
  if (tab === "schedule") gucPrefetch({ action: "gucSchedule", weekStart: weekStart(Date.now()) });
  else if (tab === "announcements") gucPrefetch({ action: "gucAnnouncements" });
  else if (tab === "cms") gucPrefetch({ action: "gucCourses" });
  else if (tab === "grades") { gucPrefetch({ action: "gucGrades" }); gucPrefetch({ action: "gucTerm" }); }
  else if (tab === "exams") gucPrefetch({ action: "gucTerm" });
  else if (tab === "mail") gucPrefetch({ action: "gucMail" });
  else gucPrefetch({ action: "gucDeadlines" });
}

// ---------- Schedule ----------
function Schedule({ week, go, onConnect }: { week?: string; go: (path: string) => void; onConnect: () => void }) {
  const now = useNow(), thisWeek = weekStart(now), start = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStart(Date.parse(week + "T12:00:00Z")) : thisWeek;
  const current = useGuc<HubSchedule>({ action: "gucSchedule", weekStart: thisWeek });
  const shown = useGuc<HubSchedule>(start === thisWeek ? null : { action: "gucSchedule", weekStart: start }, { placeholder: current.data });
  const data = start === thisWeek ? current : shown;
  const courses = useGuc<HubCourse[]>({ action: "gucCourses" }).data || [];
  const grid = useMemo(() => weekGrid(data.data?.slots || [], start, now), [data.data, start, now]);
  const t = new Date(now).toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const label = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString([], { day: "numeric", month: "short", timeZone: "UTC" });
  return <>
    <div className="guc-bar">
      <div className="guc-weeknav">
        <button type="button" className="icon-button guc-prev" aria-label="Previous week" onClick={() => go(hubPath("schedule", addDays(start, -7)))}><Icon name="right" size={16} /></button>
        <strong>{label(start)} – {label(addDays(start, 5))}</strong>
        <button type="button" className="icon-button" aria-label="Next week" onClick={() => go(hubPath("schedule", addDays(start, 7)))}><Icon name="right" size={16} /></button>
        {start !== thisWeek && <button type="button" className="lib-btn" onClick={() => go(hubPath("schedule"))}>This week</button>}
      </div>
    </div>
    {!data.data ? (data.error ? <Problem message={data.error} onRetry={() => void data.reload()} onConnect={onConnect} /> : <Skeleton rows={6} tall />)
      : !data.data.slots.length ? <EmptyState scene="calendar" line="No classes on your GUC schedule yet. It shows up once the portal publishes it." />
      : <div className="guc-grid-wrap"><div className="guc-grid" style={{ gridTemplateColumns: `76px repeat(${grid.days.length}, minmax(112px, 1fr))` }} role="table" aria-label="Weekly schedule">
        <div className="guc-grid-corner" role="columnheader" />
        {grid.days.map((d) => <div key={d.date} role="columnheader" className={`guc-day ${d.today ? "is-today" : ""}`} aria-current={d.today ? "date" : undefined}><b>{d.name.slice(0, 3)}</b><small>{label(d.date)}</small></div>)}
        {grid.periods.map((p, pi) => <div key={p.n} className="guc-grid-row" role="row">
          <div className="guc-period" role="rowheader"><b>{p.n}</b><small>{p.start}</small></div>
          {grid.days.map((d) => {
            const slots = d.cells[pi], live = d.today && t >= p.start && t <= p.end;
            return <div key={d.date} role="cell" className={`guc-cell ${d.today ? "is-today" : ""} ${live ? "is-now" : ""}`}>
              {slots.map((s) => { const course = courses.find((c) => sameCode(c.code, s.code)); return <button type="button" key={s.id} className={`guc-slot kind-${(s.type || "class").toLowerCase()}`} disabled={!course} onClick={() => course && go(hubPath("cms", course.key))} title={s.name}>
                <b>{s.code}</b><span>{[s.type, s.location].filter(Boolean).join(" · ")}</span>{s.group && <small>{s.group}</small>}
              </button>; })}
            </div>;
          })}
        </div>)}
      </div></div>}
  </>;
}

// ---------- Announcements ----------
/** `only`: one course's announcements (a subject's page), without the course picker. */
export function Announcements({ focus, onConnect, only }: { focus?: string; onConnect: () => void; only?: string }) {
  const [picked, setCourse] = useState(""), course = only || picked;
  const courses = useGuc<HubCourse[]>({ action: "gucCourses" }).data || [];
  const first = useGuc<Page<HubAnnouncement>>({ action: "gucAnnouncements", ...(course ? { courseId: course } : {}) });
  const [more, setMore] = useState<{ items: HubAnnouncement[]; next?: string; loading?: boolean }>({ items: [] });
  useEffect(() => setMore({ items: [] }), [course]);
  const next = more.items.length ? more.next : first.data?.next;
  const items = useMemo(() => [...(first.data?.items || []), ...more.items.filter((a) => !first.data?.items.some((b) => b.id === a.id))], [first.data, more.items]);
  const loadMore = () => {
    if (!next || more.loading) return;
    setMore((m) => ({ ...m, loading: true }));
    void gucAsk<Page<HubAnnouncement>>({ action: "gucAnnouncements", cursor: next, ...(course ? { courseId: course } : {}) })
      .then((p) => setMore((m) => ({ items: [...m.items, ...p.items], next: p.next })), () => setMore((m) => ({ ...m, loading: false })));
  };
  // Unread rows keep their dot for this visit; seeing one marks it read in the engine (and everywhere cached) at once.
  const fresh = useRef(new Set<string>()), pending = useRef(new Set<string>()), timer = useRef(0);
  for (const a of items) if (!a.read) fresh.current.add(a.id);
  const flush = () => {
    const ids = [...pending.current]; pending.current.clear();
    if (!ids.length) return;
    const hit = new Set(ids);
    gucPatch<Page<HubAnnouncement>>("gucAnnouncements", (p) => ({ ...p, items: p.items.map((a) => (hit.has(a.id) ? { ...a, read: true } : a)) }));
    setMore((m) => ({ ...m, items: m.items.map((a) => (hit.has(a.id) ? { ...a, read: true } : a)) }));
    gucPatch<HubOverview>("gucOverview", (o) => ({ ...o, counts: { ...o.counts, unread: Math.max(0, o.counts.unread - ids.length) } }));
    gucPatch<HubCourse[]>("gucCourses", (cs) => cs.map((c) => ({ ...c, unread: Math.max(0, c.unread - items.filter((a) => hit.has(a.id) && a.courseKey === c.key).length) })));
    void gucAsk({ action: "gucMarkRead", ids }).catch(() => void gucCache.revalidateAll());
  };
  const observer = useMemo(() => typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { const id = (e.target as HTMLElement).dataset.unread; if (id) { pending.current.add(id); delete (e.target as HTMLElement).dataset.unread; } }
    clearTimeout(timer.current); timer.current = window.setTimeout(flush, 700);
  }, { threshold: 0.6 }), []);
  useEffect(() => () => { observer?.disconnect(); clearTimeout(timer.current); flush(); }, []);
  const at = focus ? items.findIndex((a) => a.id === focus) : -1;
  useEffect(() => { if (focus && at < 0 && next && items.length < 400) loadMore(); }, [focus, at, next]);
  const options = [{ value: "", label: "All courses" }, ...courses.filter((c) => c.active).map((c) => ({ value: c.key, label: c.code || c.name }))];
  return <>
    {!only && <div className="guc-bar">
      <PickMenu label="Course" value={course} options={options} onChange={setCourse} />
    </div>}
    {!first.data ? (first.error ? <Problem message={first.error} onRetry={() => void first.reload()} onConnect={onConnect} /> : <Skeleton rows={5} tall />)
      : !items.length ? <EmptyState scene="bell" line={course ? "No announcements in this course yet." : "No announcements yet. New ones show up here after each sync."} />
      : <VList items={items} keyOf={(a) => a.id} estimate={() => 96} scrollTo={at} onEnd={loadMore} label="Announcements" render={(a) => {
        const unread = fresh.current.has(a.id);
        return <article className={`guc-ann ${unread ? "is-unread" : ""} ${a.id === focus ? "is-focus" : ""}`} data-unread={a.read ? undefined : a.id} ref={(el) => { if (el && !a.read) observer?.observe(el); }}>
          <header>{unread && <span className="guc-dot" role="img" aria-label="Unread" />}<b>{a.code || a.course}</b><span>{a.course}</span>{a.week && <small>{weekLabel(a.week, "short")}</small>}</header>
          <p>{a.text}</p>
        </article>;
      }} />}
    {more.loading && <Skeleton rows={2} />}
  </>;
}

// ---------- CMS ----------
/** One CMS file: preview on click, warmed on hover, download beside it. */
function FileRow({ m, extra, focus, onOpenFile, onToast }: { m: HubMaterial; extra?: ReactNode; focus?: boolean; onOpenFile: (file: StoredFile) => void; onToast: (message: string) => void }) {
  const dwell = useRef(0);
  const warm = (id: string) => { clearTimeout(dwell.current); dwell.current = window.setTimeout(() => gucPrefetch({ action: "gucFile", materialId: id }, 10 * 60_000), 250); };
  const save = async () => { try { const blob = await getBlob("guc_" + m.id); if (blob) download(blob, m.name); } catch (e) { onToast(clean(e) || "This file could not be downloaded."); } };
  return <div className={`guc-file ${focus ? "is-focus" : ""}`} onPointerEnter={() => warm(m.id)} onPointerLeave={() => clearTimeout(dwell.current)}>
    <button type="button" className="guc-file-open" onClick={() => onOpenFile(asFile(m))} onFocus={() => warm(m.id)} aria-label={`Preview ${m.title}`}>
      <FileGlyph file={m} size={26} /><span><b>{m.title}</b><small>{extra || [m.kind, m.name].filter(Boolean).join(" · ")}</small></span>
    </button>
    <button type="button" className="icon-button" aria-label={`Download ${m.title}`} onClick={() => void save()}><Icon name="download" size={16} /></button>
  </div>;
}

/** One course's files by week (the hub's CMS tab, and a linked subject's page). */
export function CourseFiles({ courseKey, material, linked, onOpenFile, onConnect, onToast }: { courseKey: string; material?: string; linked?: boolean; onOpenFile: (file: StoredFile) => void; onConnect: () => void; onToast: (message: string) => void }) {
  const mats = useGuc<HubMaterials>({ action: "gucMaterials", courseId: courseKey });
  const rows = useMemo(() => (mats.data?.weeks || []).flatMap((w) => [{ kind: "week" as const, key: "w:" + w.week, week: w }, ...w.items.map((m) => ({ kind: "file" as const, key: m.id, m }))]), [mats.data]);
  // A deep link to one file opens its preview once its course has loaded.
  const opened = useRef("");
  useEffect(() => { const m = material && mats.data?.weeks.flatMap((w) => w.items).find((x) => x.id === material); if (m && opened.current !== m.id) { opened.current = m.id; onOpenFile(asFile(m)); } }, [material, mats.data]);
  if (!mats.data) return mats.error ? <Problem message={mats.error} onRetry={() => void mats.reload()} onConnect={onConnect} /> : <Skeleton rows={6} />;
  if (!rows.length) return <EmptyState scene="folder" line={linked ? "No files in this course yet." : "No files listed for this course yet. Clem lists every current course's files on its next check."} />;
  return <VList key={courseKey} items={rows} keyOf={(r) => r.key} estimate={(r) => (r.kind === "week" ? 40 : 52)} label="Files" render={(r) => r.kind === "week"
    ? <h3 className="guc-week">{weekLabel(r.week.week)}<span>{r.week.items.length}</span></h3>
    : <FileRow m={r.m} focus={r.m.id === material} onOpenFile={onOpenFile} onToast={onToast} />} />;
}

/** A course's subject: open it, or make one from the course, or link one that has none. */
function CourseSubject({ course, subjects, actions, onToast }: { course: HubCourse; subjects: Space[]; actions?: GucActions; onToast: (message: string) => void }) {
  const courses = useGuc<HubCourse[]>({ action: "gucCourses" }).data || [];
  if (!actions) return null;
  const linked = course.subjectId && subjects.find((s) => s.id === course.subjectId);
  if (linked) return <button type="button" className="lib-btn" onClick={() => actions.openSpace(linked.id)}><Icon name="subjects" size={15} />{linked.name}</button>;
  const free = subjects.filter((s) => !courses.some((c) => c.subjectId === s.id));
  const guess = matchSubject(course, free);
  const ordered = [...(guess.best ? [guess.best.item] : []), ...free.filter((s) => s.id !== guess.best?.item.id)];
  return <>
    {ordered.length > 0 && <PickMenu label="Link to a subject" value="" placeholder="Link to a subject" options={ordered.map((s) => ({ value: s.id, label: s.name }))} onChange={(id) => id && void actions.answer(id, "link", { kind: "link", courseKey: course.key }).catch((e) => onToast(clean(e)))} />}
    <button type="button" className="lib-btn strong" onClick={() => actions.createFromCourse(course)}><Icon name="plus" size={15} />Create subject from this course</button>
  </>;
}

function Cms({ course, material, go, onOpenFile, onConnect, onToast, actions, subjects = [] }: { course?: string; material?: string; go: (path: string) => void; onOpenFile: (file: StoredFile) => void; onConnect: () => void; onToast: (message: string) => void; actions?: GucActions; subjects?: Space[] }) {
  const courses = useGuc<HubCourse[]>({ action: "gucCourses" });
  const list = (courses.data || []).filter((c) => c.active);
  const key = course || list.find((c) => c.materials)?.key || list[0]?.key;
  const [q, setQ] = useState(""), [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 180); return () => clearTimeout(t); }, [q]);
  const hits = useGuc<HubHit[]>(dq.length >= 2 ? { action: "gucSearch", query: dq } : null, { maxAge: 30_000 });
  const subjectName = (id?: string) => (id ? subjects.find((s) => s.id === id)?.name : undefined);

  if (!courses.data) return courses.error ? <Problem message={courses.error} onRetry={() => void courses.reload()} onConnect={onConnect} /> : <Skeleton rows={6} />;
  if (!list.length) return <EmptyState scene="folder" line="No courses this term yet. They show up after your next sync." />;
  const current = list.find((c) => c.key === key);
  return <>
    <div className="guc-bar">
      <label className="lib-find guc-find"><Icon name="search" size={16} /><input aria-label="Search all courses" placeholder="Search files and announcements" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} /></label>
    </div>
    {dq.length >= 2 ? <div className="guc-results" aria-live="polite">
      {!hits.data ? <Skeleton rows={3} /> : !hits.data.length ? <p className="guc-none">Nothing matches “{dq}”.</p>
        : hits.data.map((h) => h.type === "material"
          ? <div key={"m" + h.id}><FileRow m={{ id: h.id, courseKey: h.courseKey, week: h.week || "", title: h.title, kind: "", name: h.name || h.title, type: h.fileType || "", firstSeen: 0, stored: false }} extra={[h.code, h.snippet].filter(Boolean).join(" · ")} onOpenFile={onOpenFile} onToast={onToast} /></div>
          : <button type="button" key={"a" + h.id} className="guc-hit" onClick={() => go(hubPath("announcements", h.id))}><Icon name="megaphone" size={18} /><span><b>{h.code || h.title}</b><small>{h.snippet}</small></span></button>)}
    </div>
      : <div className="guc-cms">
        <nav className="guc-courses" aria-label="Courses">
          {list.map((c) => <button key={c.key} type="button" className={c.key === key ? "active" : ""} aria-current={c.key === key ? "page" : undefined}
            onClick={() => go(hubPath("cms", c.key))} onPointerEnter={() => gucPrefetch({ action: "gucMaterials", courseId: c.key })} onFocus={() => gucPrefetch({ action: "gucMaterials", courseId: c.key })}>
            <b>{c.code || c.name}</b><span>{subjectName(c.subjectId) ? `${c.name} · ${subjectName(c.subjectId)}` : c.name}</span>{c.unread > 0 && <span className="guc-dot" role="img" aria-label={`${c.unread} unread`} />}
          </button>)}
        </nav>
        <div className="guc-files">
          {current && <div className="guc-course-head"><h2 className="guc-course-title">{current.code} <span>{current.name}</span></h2><div className="guc-course-subject"><CourseSubject course={current} subjects={subjects} actions={actions} onToast={onToast} /></div></div>}
          {key && <CourseFiles courseKey={key} material={material} linked={!!current?.subjectId} onOpenFile={onOpenFile} onConnect={onConnect} onToast={onToast} />}
        </div>
      </div>}
  </>;
}

// ---------- Grades ----------
/** `courseKey`: one course's grades (a subject's page). */
export function Grades({ onConnect, courseKey }: { onConnect: () => void; courseKey?: string }) {
  const grades = useGuc<HubGrade[]>(courseKey ? { action: "gucGrades", courseId: courseKey } : { action: "gucGrades" });
  if (!grades.data) return grades.error ? <Problem message={grades.error} onRetry={() => void grades.reload()} onConnect={onConnect} /> : <Skeleton rows={5} />;
  if (!grades.data.length) return <EmptyState scene="checklist" line={courseKey ? "No grade for this course on your transcript yet." : "No grades on your transcript yet."} />;
  const semesters = [...new Set(grades.data.map((g) => g.semester))];
  return <>{semesters.map((s) => {
    const rows = grades.data!.filter((g) => g.semester === s), latest = rows[0].latest;
    return <section key={s} className={`guc-sem ${latest ? "is-latest" : ""}`} aria-label={s}>
      <h3>{s}{latest && <span className="guc-tag">Latest</span>}</h3>
      {rows.map((g) => <div key={g.id} className={`guc-grade ${g.fresh ? "is-fresh" : ""}`}>
        <span><b>{g.code}</b>{g.name}</span>
        {g.fresh && <span className="guc-tag">New</span>}
        <small>{g.hours ? `${g.hours} h` : ""}</small>
        <strong aria-label={g.letter ? `Grade ${g.letter}` : "No grade yet"}>{g.letter || (g.numeric ?? "—")}</strong>
      </div>)}
    </section>;
  })}</>;
}

// ---------- This term (CheckGrade), exam seats and mail ----------
/** Midterms and coursework from the portal's CheckGrade page, above the transcript. Nothing posted yet: nothing shown. */
export function ThisTerm({ onConnect, code }: { onConnect: () => void; code?: string }) {
  const term = useGuc<HubTerm>({ action: "gucTerm" });
  if (!term.data) return term.error ? <Problem message={term.error} onRetry={() => void term.reload()} onConnect={onConnect} /> : null;
  const mine = (c: string) => !code || sameCode(c, code);
  const mids = term.data.midterms.filter((m) => mine(m.code) && m.grade);
  const work = term.data.coursework.filter((w) => mine(w.code) && w.entries.some((e) => e.elements.some((x) => x.grade)));
  if (!mids.length && !work.length) return null;
  return <section className="guc-sem is-latest guc-term" aria-label="This term">
    <h3>This term<span className="guc-tag">Live</span></h3>
    {mids.map((m) => <div key={m.id} className={`guc-grade ${m.fresh ? "is-fresh" : ""}`}>
      <span><b>{m.code}</b>{m.course.replace(m.code, "").replace(/^\s*[-–:]\s*/, "") || "Midterm"}</span>
      {m.fresh ? <span className="guc-tag">New</span> : <small>Midterm</small>}<small />
      <strong>{m.grade}</strong>
    </div>)}
    {work.map((w) => <details key={w.id} className="guc-work">
      <summary><span><b>{w.code}</b>Coursework</span><small>{w.entries.length} {w.entries.length === 1 ? "assessment" : "assessments"}</small></summary>
      <ul>{w.entries.map((e, i) => <li key={i}><span>{e.name}</span><span className="guc-work-parts">{e.elements.map((x, j) => <span key={j}>{x.name && x.name !== e.name ? <small>{x.name}</small> : null}<strong>{x.grade || "—"}</strong></span>)}</span></li>)}</ul>
    </details>)}
  </section>;
}

export function Exams({ onConnect, code }: { onConnect: () => void; code?: string }) {
  const term = useGuc<HubTerm>({ action: "gucTerm" });
  if (!term.data) return term.error ? <Problem message={term.error} onRetry={() => void term.reload()} onConnect={onConnect} /> : <Skeleton rows={3} />;
  const exams = term.data.exams.filter((e) => !code || sameCode(e.code, code));
  if (!exams.length) return <EmptyState scene="checklist" line="No exam seats posted yet. Clem checks the portal every half hour and tells you when they are." />;
  return <ol className="guc-exams">{exams.map((e) => <li key={e.id} className="guc-exam">
    <div className="guc-exam-when"><b>{e.day || e.date}</b><small>{[e.day ? e.date : "", e.start && `${e.start}${e.end ? "–" + e.end : ""}`].filter(Boolean).join(" · ")}</small></div>
    <span><strong>{e.course}</strong><small>{e.type}</small></span>
    <div className="guc-exam-seat"><small>Hall</small><b>{e.hall || "—"}</b><small>Seat</small><b>{e.seat || "—"}</b></div>
  </li>)}</ol>;
}

export function Mail({ onConnect }: { onConnect: () => void }) {
  const mail = useGuc<HubMail>({ action: "gucMail" });
  if (!mail.data) return mail.error ? <Problem message={mail.error} onRetry={() => void mail.reload()} onConnect={onConnect} /> : <Skeleton rows={5} />;
  if (!mail.data.items.length) return <EmptyState scene="checklist" line={mail.data.missed ? "Clem couldn’t reach your GUC mail yet. It will try again in a few minutes." : "Your GUC Inbox will show here after the next check."} />;
  const when = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""; };
  return <ul className="guc-mail" aria-label="GUC mail">{mail.data.items.map((m) => <MailItem key={m.id} m={m} when={when} />)}<li className="guc-mail-note"><small>Read-only. Open Outlook to reply; Clem never sends, moves or marks your mail.</small></li></ul>;
}

type OpenMail = { text: string; cut: boolean } | { error: string } | "loading";
/** One message: its preview, and its whole text once opened (read from GUC then, kept only on screen). */
function MailItem({ m, when }: { m: HubMail["items"][number]; when: (iso: string) => string }) {
  const [open, setOpen] = useState<OpenMail | null>(null);
  const toggle = () => {
    if (open === "loading") return;
    if (open) return setOpen(null);
    setOpen("loading");
    gucAsk<{ text: string; cut: boolean }>({ action: "gucMailMessage", id: m.id }).then((r) => setOpen({ text: r.text, cut: r.cut }), (e) => setOpen({ error: (e as Error)?.message || "Clem couldn’t open this message." }));
  };
  return <li className={(m.read ? "" : "is-unread") + (open ? " is-open" : "")}>
    <button type="button" className="guc-mail-open" aria-expanded={!!open} onClick={toggle}>
      <div className="guc-mail-head"><b>{m.from.replace(/\s*<[^>]+>$/, "")}</b><time>{when(m.received)}</time></div>
      <strong>{m.subject}{m.attachments && <Icon name="attach" size={13} />}</strong>
      {!open && m.preview && <p>{m.preview}</p>}
    </button>
    {open === "loading" ? <p className="guc-mail-body is-loading">Opening…</p>
      : open && "error" in open ? <p className="guc-mail-body is-error">{open.error}</p>
      : open ? <div className="guc-mail-body">{open.text || "This message has no text."}{open.cut && <small> (The message continues; open it in Outlook for the rest.)</small>}</div> : null}
  </li>;
}

// ---------- Deadlines ----------
/** `courseKey`: one course's deadlines (a subject's page). */
export function Deadlines({ focus, onConnect, courseKey }: { focus?: string; onConnect: () => void; courseKey?: string }) {
  const now = useNow();
  const data = useGuc<HubDeadline[]>({ action: "gucDeadlines" });
  const list = useMemo(() => sortDeadlines((data.data || []).filter((d) => !courseKey || d.courseKey === courseKey), now), [data.data, now, courseKey]);
  useEffect(() => { if (focus) document.querySelector(`[data-deadline="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: "center" }); }, [focus, !!data.data]);
  if (!data.data) return data.error ? <Problem message={data.error} onRetry={() => void data.reload()} onConnect={onConnect} /> : <Skeleton rows={4} />;
  if (!list.length) return <EmptyState scene="alarm" line="No deadlines found. Clem picks them out of announcements and course pages." />;
  const firstPast = list.findIndex((d) => d.past);
  return <ol className="guc-deadlines">
    {list.map((d, i) => { const r = relativeDue(d.due, now); return <li key={d.id} data-deadline={d.id} className={`tone-${r.tone} ${d.id === focus ? "is-focus" : ""}`}>
      {i === firstPast && <h3 className="guc-past-head">Past</h3>}
      <div className="guc-deadline"><b className="guc-when">{r.label}</b><span><strong>{d.title}</strong><small>{[d.code, r.date].filter(Boolean).join(" · ")}</small></span></div>
    </li>; })}
  </ol>;
}
