// GUC password expiry (docs/GUC-VPS-ENGINE.md "Password expiry"): the banner on the hub and subject pages, and the
// main-thread card, both with Update password (Settings → Connectors → GUC, on the "New password" field). Live state:
// once the new password works, every copy says so.
import type { HubOverview } from "../../core/guc/hub";
import { PASSWORD_NOTICE, PASSWORD_SAID } from "../../core/guc/password";
import { Icon } from "../Icons";
import { useGuc } from "./useGuc";

/** On a GUC page, while the password is needed. */
export function PasswordBanner({ onUpdate }: { onUpdate: () => void }) {
  return <div className="guc-banner guc-password-banner" role="status">
    <Icon name="alert" size={16} /><span>{PASSWORD_SAID}</span>
    <button type="button" className="lib-btn strong" onClick={onUpdate}>Update password</button>
  </div>;
}
/** The banner on a subject's page: only while the password is needed. */
export function SubjectPasswordBanner({ onUpdate }: { onUpdate: () => void }) {
  const o = useGuc<HubOverview>({ action: "gucOverview" }).data;
  return o?.passwordNeeded ? <PasswordBanner onUpdate={onUpdate} /> : null;
}

/** The guc_password card in the main thread. */
export function GucPasswordCard({ onUpdate }: { onUpdate?: () => void }) {
  const o = useGuc<HubOverview>({ action: "gucOverview" }).data;
  const fixed = !!o && o.connected && !o.passwordNeeded;
  return <div className="edit-proposal clem-card guc-password-card">
    <header>
      <Icon name={fixed ? "check" : "alert"} size={16} />
      <div><strong>{fixed ? "GUC accepts your password again" : PASSWORD_NOTICE.title}</strong><small>{fixed ? "Clem's GUC checks are back on." : PASSWORD_NOTICE.body}</small></div>
    </header>
    {!fixed && onUpdate && <footer><button type="button" className="primary" onClick={onUpdate}>Update password</button></footer>}
  </div>;
}
