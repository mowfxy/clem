import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { desktop } from "../desktop/bridge";
import { api } from "../Cloud";
import { Icon } from "../Icons";
import "../dialogs.css";

export type ContactKind = "help" | "bug" | "idea";
type Category = "Contact support" | "Report a bug" | "Suggest a feature";

const variants: Record<ContactKind, { category: Category; title: string; lead: string; card: string; icon: string; send: string }> = {
  help: { category: "Contact support", title: "Contact support", lead: "Questions about your account, models or files. A person from the Clem team reads every message.", card: "Questions about your account, models or files", icon: "chat", send: "Send to support" },
  bug: { category: "Report a bug", title: "Report a bug", lead: "Tell us what went wrong. Clear steps help us fix it quickly.", card: "Something broke or behaved unexpectedly", icon: "alert", send: "Send report" },
  idea: { category: "Suggest a feature", title: "Suggest a feature", lead: "What would make Clem more useful to you? We read every idea.", card: "Share an idea that would make Clem better", icon: "spark", send: "Send idea" },
};
const helpTopics = ["Account & sign-in", "Models & usage", "Chats & files", "Something else"];
const impact = ["Nice to have", "Important to me", "Blocking my work"];

/** Chooser for the three kinds of request; each opens its own focused popup. */
export function ContactOptions({ onSent }: { onSent?: () => void | Promise<void> }) {
  const [open, setOpen] = useState<ContactKind | null>(null);
  return (
    <div className="contact-options" role="list">
      {(Object.keys(variants) as ContactKind[]).map((kind) => (
        <button key={kind} role="listitem" type="button" className={"contact-option contact-" + kind} onClick={() => setOpen(kind)}>
          <span className="contact-option-mark" aria-hidden="true"><ContactGlyph kind={kind} /></span>
          <span className="contact-option-text"><strong>{variants[kind].title}</strong><small>{variants[kind].card}</small></span>
          <Icon name="arrow" size={15} />
        </button>
      ))}
      {open && <ContactDialog kind={open} onClose={() => setOpen(null)} onSent={onSent} />}
    </div>
  );
}

function ContactGlyph({ kind }: { kind: ContactKind }) {
  return <Icon name={kind === "bug" ? "bug" : kind === "idea" ? "idea" : "question"} size={20} />;
}

export function ContactDialog({ kind, onClose, onSent }: { kind: ContactKind; onClose: () => void; onSent?: () => void | Promise<void> }) {
  const v = variants[kind];
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [sent, setSent] = useState(false), [dirty, setDirty] = useState(false);
  const [topic, setTopic] = useState(helpTopics[0]), [weight, setWeight] = useState(impact[0]);
  useEffect(() => { ref.current?.showModal(); ref.current?.querySelector<HTMLElement>("input,textarea")?.focus(); }, []);
  // A half-written message is not thrown away by a stray click outside the popup or Escape.
  const casualClose = () => { if (!busy && (!dirty || sent)) onClose(); };
  async function submit(form: HTMLFormElement) {
    const f = new FormData(form), text = (name: string) => String(f.get(name) || "").trim();
    let subject = text("subject"), message = "";
    if (kind === "help") { message = text("message"); subject = `[${topic}] ${subject}`; }
    if (kind === "bug") {
      message = ["What happened:\n" + text("happened"), text("steps") && "Steps to reproduce:\n" + text("steps"), text("expected") && "What I expected:\n" + text("expected"), f.get("system") && "System: " + navigator.userAgent].filter(Boolean).join("\n\n");
    }
    if (kind === "idea") message = ["The idea:\n" + text("idea"), text("why") && "Why it would help:\n" + text("why"), "How much it matters: " + weight].filter(Boolean).join("\n\n");
    subject = subject.slice(0, 150);
    if (message.length < 10) { setError("Please add a little more detail (at least 10 characters)."); return; }
    setBusy(true); setError("");
    try {
      const payload = { category: v.category, subject, message: message.slice(0, 10000) };
      if (desktop) await desktop.invoke({ action: "supportSend", ...payload, diagnostics: kind === "bug" && f.get("logs") === "on" });
      else await api("support", "POST", payload);
      setSent(true); setDirty(false);
      await onSent?.();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return createPortal(
    <dialog
      ref={ref}
      className={"contact-dialog contact-" + kind}
      aria-labelledby="contact-title"
      onCancel={(e) => { e.preventDefault(); casualClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) casualClose(); }}
    >
      <header>
        <span className="contact-option-mark" aria-hidden="true"><ContactGlyph kind={kind} /></span>
        <div><h2 id="contact-title">{v.title}</h2>{!sent && <p>{v.lead}</p>}</div>
        <button type="button" className="contact-close" aria-label="Close" disabled={busy} onClick={onClose}><Icon name="close" size={16} /></button>
      </header>
      {sent ? (
        <div className="contact-sent" role="status">
          <svg className="contact-sent-mark" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" /><path d="m15 24.5 6 6 12-13" /></svg>
          <h3>{kind === "bug" ? "Thanks for the report" : kind === "idea" ? "Thanks for the idea" : "Message sent"}</h3>
          <p>{desktop ? "Replies from the team appear in Help & support and in a notice above your account." : "We reply by email."}</p>
          <button type="button" className="contact-primary" onClick={onClose} autoFocus>Done</button>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }} onInput={() => setDirty(true)}>
          {kind === "help" && <>
            <fieldset className="contact-chips"><legend>Topic</legend>{helpTopics.map((t) => <button type="button" key={t} aria-pressed={topic === t} onClick={() => setTopic(t)}>{t}</button>)}</fieldset>
            <label>Subject<input name="subject" required maxLength={120} placeholder="A short summary" /></label>
            <label>Message<textarea name="message" rows={6} required minLength={10} maxLength={10000} placeholder="How can we help?" /></label>
          </>}
          {kind === "bug" && <>
            <label>Title<input name="subject" required maxLength={150} placeholder="e.g. PDF export stops at 90%" /></label>
            <label>What happened?<textarea name="happened" rows={3} required minLength={10} maxLength={4000} placeholder="Describe what you saw, including any error message." /></label>
            <label><span>Steps to reproduce <span className="contact-optional">Optional</span></span><textarea name="steps" rows={3} maxLength={3000} placeholder={"1. Open a chat\n2. …"} /></label>
            <label><span>What did you expect? <span className="contact-optional">Optional</span></span><input name="expected" maxLength={1500} /></label>
            <label className="contact-check"><input type="checkbox" name="system" defaultChecked /> Include the app version and system details</label>
            {desktop && <label className="contact-check"><input type="checkbox" name="logs" defaultChecked /> Include diagnostic logs (errors and timings, never your chats or files)</label>}
          </>}
          {kind === "idea" && <>
            <label>Your idea<input name="subject" required maxLength={150} placeholder="e.g. Export flashcards to Anki" /></label>
            <label>What should Clem do?<textarea name="idea" rows={4} required minLength={10} maxLength={5000} placeholder="Describe how it would work for you." /></label>
            <label><span>Why would it help? <span className="contact-optional">Optional</span></span><textarea name="why" rows={2} maxLength={3000} /></label>
            <fieldset className="contact-chips"><legend>How much would this matter?</legend>{impact.map((t) => <button type="button" key={t} aria-pressed={weight === t} onClick={() => setWeight(t)}>{t}</button>)}</fieldset>
          </>}
          {error && <p className="contact-error" role="alert">{error}</p>}
          <footer>
            <small>Please leave out passwords, API keys and other sensitive details.</small>
            <button type="button" className="contact-secondary" disabled={busy} onClick={onClose}>Cancel</button>
            <button className="contact-primary" disabled={busy}>{busy ? "Sending…" : v.send}<Icon name="arrow" size={15} /></button>
          </footer>
        </form>
      )}
    </dialog>,
    document.body,
  );
}
