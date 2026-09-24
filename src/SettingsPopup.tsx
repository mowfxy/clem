import { useEffect, useRef, useState, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
export function SettingsPopup({
  title,
  description,
  action = "Manage",
  bare = false,
  children,
}: {
  title: string;
  /** Only the button, for rows that already show their own title. */
  bare?: boolean;
  description?: string;
  action?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false),
    ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    if (open) ref.current?.showModal();
  }, [open]);
  return (
    <>
      {bare ? (
        <button type="button" className="secondary" onClick={() => setOpen(true)}>
          {action}
        </button>
      ) : (
        <div className="settings-action">
          <div>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>
          <button type="button" onClick={() => setOpen(true)}>
            {action}
          </button>
        </div>
      )}
      {open &&
        createPortal(
          <dialog
            ref={ref}
            className="settings-dialog"
            aria-labelledby={id}
            onCancel={() => setOpen(false)}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                const r = e.currentTarget.getBoundingClientRect();
                if (
                  e.clientX < r.left ||
                  e.clientX > r.right ||
                  e.clientY < r.top ||
                  e.clientY > r.bottom
                )
                  setOpen(false);
              }
            }}
          >
            <header>
              <h2 id={id}>{title}</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </header>
            <div className="settings-dialog-body">{children}</div>
          </dialog>,
          document.body,
        )}
    </>
  );
}
