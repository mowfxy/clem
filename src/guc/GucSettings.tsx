import { useEffect, useState, type ReactNode } from "react";
import type { GucProgress, GucStatus } from "../../core/guc/types";
import type { SubjectLink } from "../../core/guc/settings";
import type { Space } from "../../core/types";
import { CheckSchedule, DriveFolder, SaveRules, Storage, type GucActions } from "./GucCards";
import { gucCache, useGuc as useGucRead } from "./useGuc";
import { PASSWORD_SAID } from "../../core/guc/password";
import { Icon } from "../Icons";
import { desktop } from "../desktop/bridge";
import { confirmDialog } from "../dialogs";
import { SettingRow } from "../settings/SettingsParts";
import "../drive/drive.css";
import "./guc.css";
import { ago, useGuc } from "./GucRow";

const message = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");

/** Sign in, watch the first sync, then sync now or disconnect (loaded when the dialog opens; the row is GucRow.tsx). */
export function GucManage({ actions, subjects = [] }: { actions?: GucActions; subjects?: Space[] }) {
  const { status, setStatus, refresh } = useGuc();
  const [username, setUsername] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [progress, setProgress] = useState<GucProgress | null>(null), [error, setError] = useState("");
  useEffect(() => desktop?.onGuc?.((p) => setProgress(p)), []);
  async function run(task: () => Promise<GucStatus>) {
    setBusy(true); setError(""); setProgress(null);
    try { setStatus(await task()); } catch (e) { setError(message(e)); await refresh(); } finally { setBusy(false); setProgress(null); }
  }
  const connect = () => {
    const name = username.trim();
    if (!/^(guc\\)?[\w.@-]{2,80}$/i.test(name)) return setError("Enter your GUC username, the one you use for the CMS.");
    if (!password) return setError("Enter your GUC password.");
    void run(async () => { const next = await desktop!.invoke({ action: "gucConnect", username: name, password }); setPassword(""); return next; });
  };
  const working = busy && <p className="guc-progress" role="status"><span className="gd-sync is-uploading" aria-hidden="true" />{progress?.label || "Signing in to GUC…"}</p>;

  if (!desktop) return <div className="gd-picker gd-connect guc-manage"><p>GUC works in the Clem desktop app.</p></div>;
  if (!status) return <div className="gd-picker gd-connect guc-manage"><div className="gd-skeleton" /><div className="gd-skeleton" /></div>;

  if (!status.connected) return <form className="gd-picker gd-connect guc-manage" onSubmit={(e) => { e.preventDefault(); connect(); }}>
    <div className="gd-hero" aria-hidden="true"><span className="gd-hero-tile guc-tile"><Icon name="guc" size={42} /></span></div>
    <h3>Connect GUC</h3>
    <p>Sign in with your GUC username and password. Clem reads your courses, schedule, grades and announcements from the CMS and the student portal.</p>
    <label className="guc-field"><span>Username</span><input autoComplete="username" spellCheck={false} value={username} disabled={busy} onChange={(e) => setUsername(e.target.value)} placeholder="first.last" autoFocus /></label>
    <label className="guc-field"><span>Password</span><input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} /></label>
    <p className="guc-note"><Icon name="verify" size={14} />Your password stays encrypted on this device and is never shown to the AI.</p>
    {working || <button className="gd-google" type="submit">Connect</button>}
    {error && <p className="gd-error" role="alert">{error}</p>}
  </form>;

  return <div className="gd-picker gd-connect guc-manage">
    <div className="gd-hero" aria-hidden="true"><span className="gd-hero-tile guc-tile"><Icon name="guc" size={42} /></span></div>
    <h3>GUC is connected</h3>
    <p>Signed in as <b>{status.username}</b> · {ago(status.lastSync)}</p>
    <ul>
      <li><Icon name="check" size={14} />{status.courses ? `${status.courses} courses this term` : "Your courses"}</li>
      <li><Icon name="check" size={14} />{status.linked ? `${status.linked} linked to subjects, checked every few hours` : "Link a course to a subject to check it for new files"}</li>
      {status.stats && <li><Icon name="check" size={14} />Last check: {status.stats.requests} pages, {status.stats.skipped} unchanged</li>}
    </ul>
    {status.passwordNeeded ? <NewPassword busy={busy} working={working} error={error} onSave={(pw) => run(async () => { const next = await desktop!.invoke({ action: "gucPassword", password: pw }); void gucCache.revalidateAll(); return next; })} /> : <>
      {status.error && <p className="gd-error" role="alert">{status.error.message}</p>}
      {error && <p className="gd-error" role="alert">{error}</p>}
      {working || <button className="gd-google" onClick={() => void run(() => desktop!.invoke({ action: "gucSync" }))}>Sync now</button>}
    </>}
    {actions && <LinkedSubjects actions={actions} subjects={subjects} />}
    <footer className="gd-foot guc-foot">
      <button className="gd-disconnect" disabled={busy} onClick={() => void confirmDialog({ title: "Disconnect GUC?", message: "Clem forgets your GUC password and the courses, grades and announcements it saved. Nothing on GUC changes.", confirm: "Disconnect", danger: true }).then((yes) => { if (yes) void run(() => desktop!.invoke({ action: "gucDisconnect" })); })}>Disconnect</button>
    </footer>
  </div>;
}

/** GUC stopped accepting the password (docs/GUC-VPS-ENGINE.md "Password expiry"): the new one, checked with GUC before
 *  it is kept. Not a disconnect: nothing else changes. */
function NewPassword({ busy, working, error, onSave }: { busy: boolean; working: ReactNode; error: string; onSave: (password: string) => Promise<unknown> }) {
  const [password, setPassword] = useState("");
  return <form className="guc-new-password" onSubmit={(e) => { e.preventDefault(); if (password) void onSave(password).then(() => setPassword("")); }}>
    <p className="guc-note"><Icon name="alert" size={14} />{PASSWORD_SAID}</p>
    <label className="guc-field"><span>New password</span><input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} autoFocus /></label>
    {working || <button className="gd-google" type="submit" disabled={!password}>Save password</button>}
    {error && <p className="gd-error" role="alert">{error}</p>}
  </form>;
}

/** Each linked subject with its settings, the same cards as its chat and page. */
function LinkedSubjects({ actions, subjects }: { actions: GucActions; subjects: Space[] }) {
  const links = useGucRead<SubjectLink[]>({ action: "gucLinks" }), [open, setOpen] = useState<string | null>(null);
  const shown = (links.data || []).filter((l) => subjects.some((s) => s.id === l.subjectId));
  if (!links.data) return <div className="guc-linked-list"><div className="gd-skeleton" /></div>;
  return <section className="guc-linked-list" aria-label="Linked subjects">
    <h4>Subjects</h4>
    {!shown.length ? <p className="guc-none">No subject is linked to a CMS course yet. Link one from its CMS tab or from GUC → CMS.</p>
      : shown.map((l) => { const name = subjects.find((s) => s.id === l.subjectId)!.name; return <div key={l.subjectId} className="guc-linked-item">
        <button type="button" aria-expanded={open === l.subjectId} onClick={() => setOpen(open === l.subjectId ? null : l.subjectId)}><span><b>{name}</b><small>{l.code} · {l.name}</small></span><Icon name="down" size={13} /></button>
        {open === l.subjectId && <div className="guc-settings-cards"><SaveRules subjectId={l.subjectId} actions={actions} /><CheckSchedule subjectId={l.subjectId} actions={actions} /><DriveFolder subjectId={l.subjectId} actions={actions} /><Storage subjectId={l.subjectId} actions={actions} /></div>}
      </div>; })}
  </section>;
}
