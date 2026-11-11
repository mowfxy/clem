// A subject's GUC view (desktop/engine/subjects.ts) in the window: one cached read per subject that every card, the
// subject page and Settings share, and edits that show at once and are written back behind (one request, the engine's
// answer replaces the guess; a refusal puts the engine's copy back).
import { mergeSettings, type SettingsPatch, type SubjectView } from "../../core/guc/settings";
import { nextCheck } from "../../core/guc/schedule-rules";
import type { HubCourse } from "../../core/guc/hub";
import type { DesktopRequest } from "../../desktop/contracts";
import { gucAsk, gucCache, gucKey, gucPatch, useGuc } from "./useGuc";

export const subjectRequest = (subjectId: string): DesktopRequest => ({ action: "gucSubject", subjectId });
export const useSubject = (subjectId: string | null) => useGuc<SubjectView>(subjectId ? subjectRequest(subjectId) : null);
const key = (subjectId: string) => gucKey(subjectRequest(subjectId));

/** The subject's view now: the cached copy, else asked for. */
export async function subjectView(subjectId: string, fresh = false): Promise<SubjectView> {
  const have = gucCache.get<SubjectView>(key(subjectId))?.data;
  if (have && !fresh) return have;
  const v = await gucAsk<SubjectView>(subjectRequest(subjectId));
  gucCache.mutate<SubjectView>(key(subjectId), () => v);
  return v;
}
const put = (v: SubjectView) => gucCache.mutate<SubjectView>(key(v.subjectId), () => v);
const reload = (subjectId: string) => gucCache.revalidate(key(subjectId), () => gucAsk<SubjectView>(subjectRequest(subjectId)));
/** Courses and links changed: the course lists, Settings' links and other subjects (a course moves) refresh behind. */
const refreshCourses = () => void gucCache.revalidateAll((k) => /"action":"guc(Courses|Links|NewCourses|Subject)"/.test(k));
const refreshLinks = () => void gucCache.revalidateAll((k) => k.includes('"action":"gucLinks"'));

/** Changes settings: on screen now, then in the engine. */
export async function editSubject(subjectId: string, patch: SettingsPatch) {
  gucCache.mutate<SubjectView>(key(subjectId), (v) => {
    if (!v) return v;
    const settings = mergeSettings(v.settings, patch), check = settings.check || v.settings.check;
    return { ...v, settings: { ...settings, check }, nextCheck: v.course ? nextCheck(check, Date.now()) : undefined };
  });
  try { const v = await gucAsk<SubjectView>({ action: "gucSetSettings", subjectId, patch }); put(v); if (patch.setup === undefined) refreshLinks(); return v; }
  catch (e) { void reload(subjectId); throw e; }
}

/** Links a course (a light sync of it follows in the engine); the course list shows the link at once. */
export async function linkSubject(subjectId: string, course: Pick<HubCourse, "key">) {
  gucPatch<HubCourse[]>("gucCourses", (cs) => cs.map((c) => (c.key === course.key ? { ...c, subjectId } : c.subjectId === subjectId ? { ...c, subjectId: undefined } : c)));
  try { const v = await gucAsk<SubjectView>({ action: "gucLink", subjectId, courseId: course.key }); put(v); refreshCourses(); return v; }
  catch (e) { refreshCourses(); throw e; }
}
export async function unlinkSubject(subjectId: string) {
  gucCache.mutate<SubjectView>(key(subjectId), (v) => (v ? { ...v, course: undefined, nextCheck: undefined, slots: [] } : v));
  gucPatch<HubCourse[]>("gucCourses", (cs) => cs.map((c) => (c.subjectId === subjectId ? { ...c, subjectId: undefined } : c)));
  try { const v = await gucAsk<SubjectView>({ action: "gucUnlink", subjectId }); put(v); refreshCourses(); return v; }
  catch (e) { void reload(subjectId); refreshCourses(); throw e; }
}
export async function checkSubjectNow(subjectId: string) {
  const v = await gucAsk<SubjectView>({ action: "gucCheckNow", subjectId });
  put(v);
  void gucCache.revalidateAll((k) => k.includes(v.course?.key || "-"));
  return v;
}
