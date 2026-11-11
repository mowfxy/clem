// The GUC hub (#/app/guc/<tab>/<id>/<sub>): schedule, announcements, CMS files, grades and deadlines from the engine's
// database. Every tab draws its cached copy on the first frame and refreshes behind it (src/guc/useGuc.ts).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { hubPath, relativeDue, sortDeadlines, weekGrid, weekStart, addDays, type HubAnnouncement, type HubCourse, type HubDeadline, type HubGrade, type HubHit, type HubMaterial, type HubMaterials, type HubOverview, type HubRoute, type HubSchedule, type HubTab, type Page } from "../../core/guc/hub";
import type { GucProgress } from "../../core/guc/types";
import type { StoredFile } from "../../core/types";
import { Icon } from "../Icons";
import { desktop } from "../desktop/bridge";
import { FileGlyph } from "../files/FileGlyph";
import { download, getBlob } from "../store";
import { EmptyState, PageHead } from "../ui/Calm";
import { PickMenu } from "../ui/PickMenu";
import { gucAsk, gucCache, gucPatch, gucPrefetch, useGuc } from "./useGuc";
import "../library.css";
import "./guc.css";

const TABS: [HubTab, string][] = [["schedule", "Schedule"], ["announcements", "Announcements"], ["cms", "CMS"], ["grades", "Grades"], ["deadlines", "Deadlines"]];
const clean = (e: unknown) => String((e as Error)?.message || e || "").replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
const authFailed = (m?: string) => !!m && /password|connect guc first|sign in again/i.test(m);
const ago = (t?: number) => { if (!t) return "Not synced yet"; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "Synced just now" : m < 60 ? `Synced ${m} min ago` : m < 1440 ? `Synced ${Math.round(m / 60)} h ago` : "Synced " + new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }); };
/** "Week: 2026-11-07" → "Week of 7 November". */
const weekLabel = (week: string, month: "long" | "short" = "long") => { const d = /(\d{4}-\d{2}-\d{2})/.exec(week)?.[1]; return d ? "Week of " + new Date(d + "T12:00:00Z").toLocaleDateString([], { day: "numeric", month, timeZone: "UTC" }) : week; };
const asFile = (m: { id: string; name: string; type: string; firstSeen?: number }): StoredFile => ({ id: "guc_" + m.id, name: m.name, type: m.type, size: 0, created: m.firstSeen || Date.now(), spaceId: null, remote: true });
const sameCode = (a: string, b: string) => a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();

function useNow(every = 60_000) { const [now, setNow] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), every); return () => clearInterval(t); }, [every]); return now; }
function scrollerOf(node: Element | null): HTMLElement | null {
  for (let el = node?.parentElement; el; el = el.parentElement) if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

/** Placeholder rows while a tab has nothing cached yet: never a blank page. */
export function Skeleton({ rows = 5, tall = false }: { rows?: number; tall?: boolean }) {
  return <div className="guc-skel" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <span key={i} className={tall ? "tall" : ""} />)}</div>;
}
function Problem({ message, onRetry, onConnect }: { message: string; onRetry: () => void; onConnect: () => void }) {
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

export function GucHub({ route, go, onOpenFile, onConnect, onToast }: { route: HubRoute; go: (path: string) => void; onOpenFile: (file: StoredFile) => void; onConnect: () => void; onToast: (message: string) => void }) {
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
  const counts: Partial<Record<HubTab, number>> = { announcements: o.counts.unread, deadlines: o.counts.deadlines };
  return <div className="page lib guc-hub">
    <PageHead title="GUC" line={busy ? progress || "Syncing…" : ago(o.lastSync)}>
      <button type="button" className="lib-btn" disabled={busy} onClick={() => void sync()}><Icon name="refresh" size={15} />{busy ? "Syncing" : "Sync now"}</button>
    </PageHead>
    {o.error && <div className="guc-banner" role="status">
      <Icon name="alert" size={16} /><span>{o.error.kind === "auth" ? "GUC didn't accept your password, so this may be out of date." : o.error.message}</span>
      {o.error.kind === "auth" ? <button type="button" className="lib-btn strong" onClick={onConnect}>Reconnect</button> : <button type="button" className="lib-btn" disabled={busy} onClick={() => void sync()}>Try again</button>}
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
        : route.tab === "cms" ? <Cms course={route.id} material={route.sub} go={go} onOpenFile={onOpenFile} onConnect={onConnect} onToast={onToast} />
        : route.tab === "grades" ? <Grades onConnect={onConnect} />
        : <Deadlines focus={route.id} onConnect={onConnect} />}
    </section>
  </div>;
}

/** Hovering a tab warms what it shows first. */
function prefetchTab(tab: HubTab) {
  if (tab === "schedule") gucPrefetch({ action: "gucSchedule", weekStart: weekStart(Date.now()) });
  else if (tab === "announcements") gucPrefetch({ action: "gucAnnouncements" });
  else if (tab === "cms") gucPrefetch({ action: "gucCourses" });
  else if (tab === "grades") gucPrefetch({ action: "gucGrades" });
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
function Announcements({ focus, onConnect }: { focus?: string; onConnect: () => void }) {
  const [course, setCourse] = useState("");
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
    <div className="guc-bar">
      <PickMenu label="Course" value={course} options={options} onChange={setCourse} />
    </div>
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
function Cms({ course, material, go, onOpenFile, onConnect, onToast }: { course?: string; material?: string; go: (path: string) => void; onOpenFile: (file: StoredFile) => void; onConnect: () => void; onToast: (message: string) => void }) {
  const courses = useGuc<HubCourse[]>({ action: "gucCourses" });
  const list = (courses.data || []).filter((c) => c.active);
  const key = course || list.find((c) => c.materials)?.key || list[0]?.key;
  const mats = useGuc<HubMaterials>(key ? { action: "gucMaterials", courseId: key } : null);
  const [q, setQ] = useState(""), [dq, setDq] = useState("");
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 180); return () => clearTimeout(t); }, [q]);
  const hits = useGuc<HubHit[]>(dq.length >= 2 ? { action: "gucSearch", query: dq } : null, { maxAge: 30_000 });
  const rows = useMemo(() => (mats.data?.weeks || []).flatMap((w) => [{ kind: "week" as const, key: "w:" + w.week, week: w }, ...w.items.map((m) => ({ kind: "file" as const, key: m.id, m }))]), [mats.data]);
  const open = (m: Pick<HubMaterial, "id" | "name" | "type" | "firstSeen">) => onOpenFile(asFile(m));
  // A deep link to one file opens its preview once its course has loaded.
  const opened = useRef("");
  useEffect(() => { const m = material && mats.data?.weeks.flatMap((w) => w.items).find((x) => x.id === material); if (m && opened.current !== m.id) { opened.current = m.id; open(m); } }, [material, mats.data]);
  const dwell = useRef(0);
  const warm = (id: string) => { clearTimeout(dwell.current); dwell.current = window.setTimeout(() => gucPrefetch({ action: "gucFile", materialId: id }, 10 * 60_000), 250); };
  const save = async (m: HubMaterial) => { try { const blob = await getBlob("guc_" + m.id); if (blob) download(blob, m.name); } catch (e) { onToast(clean(e) || "This file could not be downloaded."); } };
  const fileRow = (m: HubMaterial, extra?: ReactNode) => <div className={`guc-file ${m.id === material ? "is-focus" : ""}`} onPointerEnter={() => warm(m.id)} onPointerLeave={() => clearTimeout(dwell.current)}>
    <button type="button" className="guc-file-open" onClick={() => open(m)} onFocus={() => warm(m.id)} aria-label={`Preview ${m.title}`}>
      <FileGlyph file={m} size={26} /><span><b>{m.title}</b><small>{extra || [m.kind, m.name].filter(Boolean).join(" · ")}</small></span>
    </button>
    <button type="button" className="icon-button" aria-label={`Download ${m.title}`} onClick={() => void save(m)}><Icon name="download" size={16} /></button>
  </div>;

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
          ? <div key={"m" + h.id}>{fileRow({ id: h.id, courseKey: h.courseKey, week: h.week || "", title: h.title, kind: "", name: h.name || h.title, type: h.fileType || "", firstSeen: 0, stored: false }, [h.code, h.snippet].filter(Boolean).join(" · "))}</div>
          : <button type="button" key={"a" + h.id} className="guc-hit" onClick={() => go(hubPath("announcements", h.id))}><Icon name="megaphone" size={18} /><span><b>{h.code || h.title}</b><small>{h.snippet}</small></span></button>)}
    </div>
      : <div className="guc-cms">
        <nav className="guc-courses" aria-label="Courses">
          {list.map((c) => <button key={c.key} type="button" className={c.key === key ? "active" : ""} aria-current={c.key === key ? "page" : undefined}
            onClick={() => go(hubPath("cms", c.key))} onPointerEnter={() => gucPrefetch({ action: "gucMaterials", courseId: c.key })} onFocus={() => gucPrefetch({ action: "gucMaterials", courseId: c.key })}>
            <b>{c.code || c.name}</b><span>{c.name}</span>{c.unread > 0 && <span className="guc-dot" role="img" aria-label={`${c.unread} unread`} />}
          </button>)}
        </nav>
        <div className="guc-files">
          {current && <h2 className="guc-course-title">{current.code} <span>{current.name}</span></h2>}
          {!mats.data ? (mats.error ? <Problem message={mats.error} onRetry={() => void mats.reload()} onConnect={onConnect} /> : <Skeleton rows={6} />)
            : !rows.length ? <EmptyState scene="folder" line={current?.subjectId ? "No files in this course yet." : "No files read from this course yet. Clem reads the files of courses linked to a subject."} />
            : <VList key={key} items={rows} keyOf={(r) => r.key} estimate={(r) => (r.kind === "week" ? 40 : 52)} label="Files" render={(r) => r.kind === "week"
              ? <h3 className="guc-week">{weekLabel(r.week.week)}<span>{r.week.items.length}</span></h3>
              : fileRow(r.m)} />}
        </div>
      </div>}
  </>;
}

// ---------- Grades ----------
function Grades({ onConnect }: { onConnect: () => void }) {
  const grades = useGuc<HubGrade[]>({ action: "gucGrades" });
  if (!grades.data) return grades.error ? <Problem message={grades.error} onRetry={() => void grades.reload()} onConnect={onConnect} /> : <Skeleton rows={5} />;
  if (!grades.data.length) return <EmptyState scene="checklist" line="No grades on your transcript yet." />;
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

// ---------- Deadlines ----------
function Deadlines({ focus, onConnect }: { focus?: string; onConnect: () => void }) {
  const now = useNow();
  const data = useGuc<HubDeadline[]>({ action: "gucDeadlines" });
  const list = useMemo(() => sortDeadlines(data.data || [], now), [data.data, now]);
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

/** A subject's CMS tab (src/space/SpacePage.tsx): its linked course, or a calm placeholder until linking arrives. */
export function SubjectCms({ subjectId, go }: { subjectId: string; go: (path: string) => void }) {
  const courses = useGuc<HubCourse[]>({ action: "gucCourses" });
  const linked = courses.data?.find((c) => c.subjectId === subjectId);
  useEffect(() => { if (linked) gucPrefetch({ action: "gucMaterials", courseId: linked.key }); }, [linked?.key]);
  if (!courses.data) return courses.error ? <Problem message={courses.error} onRetry={() => void courses.reload()} onConnect={() => go("/app/guc")} /> : <Skeleton rows={3} />;
  if (!linked) return <div className="guc-link-empty">
    <EmptyState scene="link" line="Link a CMS course to this subject to see its files and announcements here.">
      <button type="button" className="secondary" onClick={() => go(hubPath("cms"))}><Icon name="guc" size={16} />Browse CMS courses</button>
    </EmptyState>
  </div>;
  return <div className="guc-linked">
    <div><b>{linked.code}</b><span>{linked.name} · {linked.season}</span></div>
    <button type="button" className="secondary" onClick={() => go(hubPath("cms", linked.key))}><Icon name="files" size={16} />Files</button>
    <button type="button" className="secondary" onClick={() => go(hubPath("announcements"))}><Icon name="megaphone" size={16} />Announcements{linked.unread > 0 && <span className="guc-count">{linked.unread}</span>}</button>
  </div>;
}

