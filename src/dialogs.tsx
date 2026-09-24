import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import "./dialogs.css";

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirm?: string;
  cancel?: string;
  /** Destructive actions get a warning-coloured confirm button. */
  danger?: boolean;
};

function ConfirmDialog({ title, message, confirm = "Confirm", cancel = "Cancel", danger, onDone }: ConfirmOptions & { onDone: (ok: boolean) => void }) {
  const ref = useRef<HTMLDialogElement>(null), done = useRef(false);
  const finish = (ok: boolean) => { if (done.current) return; done.current = true; ref.current?.close(); onDone(ok); };
  useEffect(() => { ref.current?.showModal(); ref.current?.querySelector<HTMLButtonElement>(danger ? ".app-confirm-cancel" : ".app-confirm-ok")?.focus(); }, []);
  return (
    <dialog
      ref={ref}
      className="app-confirm"
      aria-labelledby="app-confirm-title"
      aria-describedby={message ? "app-confirm-message" : undefined}
      onCancel={(e) => { e.preventDefault(); finish(false); }}
      onClick={(e) => { if (e.target === e.currentTarget) finish(false); }}
    >
      <div className="app-confirm-body">
        <h2 id="app-confirm-title">{title}</h2>
        {message && <p id="app-confirm-message">{message}</p>}
        <div className="app-confirm-actions">
          <button type="button" className="app-confirm-cancel" onClick={() => finish(false)}>{cancel}</button>
          <button type="button" className={"app-confirm-ok" + (danger ? " danger" : "")} onClick={() => finish(true)}>{confirm}</button>
        </div>
      </div>
    </dialog>
  );
}

/** The in-app replacement for window.confirm: same design as the rest of Mowr, never the system dialog. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(<ConfirmDialog {...options} onDone={(ok) => { resolve(ok); setTimeout(() => { root.unmount(); host.remove(); }, 0); }} />);
  });
}
