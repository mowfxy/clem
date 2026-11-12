import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icons";

/** A small text-only pick list in Clem's menu style (src/popups.css): the trigger shows the current choice, the menu
 *  ticks it. Used where a native <select> would otherwise appear. */
export function PickMenu<T extends string>({ label, value, options, onChange, placeholder }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; /** Shown on the trigger while `value` is none of the options (an action menu: "Move to…"). */ placeholder?: string }) {
  const id = useId(), menu = useRef<HTMLDivElement>(null), trigger = useRef<DOMRect | null>(null), button = useRef<HTMLButtonElement>(null);
  // Inside a modal dialog (Settings) everything outside it is inert, so the menu goes in the dialog; else in the body.
  const [host, setHost] = useState<Element | null>(null);
  useLayoutEffect(() => setHost(button.current?.closest("dialog") || document.body), []);
  const current = options.find((o) => o.value === value) || (placeholder === undefined ? options[0] : { value, label: placeholder });
  return <>
    <button ref={button} type="button" className="pick-trigger" aria-label={`${label}: ${current.label}`} popoverTarget={id} onClick={(e) => {
      const rect = (trigger.current = e.currentTarget.getBoundingClientRect());
      if (menu.current) { menu.current.style.left = `${Math.max(8, Math.min(rect.right - 180, window.innerWidth - 196))}px`; menu.current.style.top = `${rect.bottom + 6}px`; }
    }}>{current.label}<Icon name="down" size={13} /></button>
    {host && createPortal(<div id={id} ref={menu} popover="auto" role="menu" aria-label={label} className="chat-options history-filter-menu pick-menu" onToggle={(e) => {
      // Opens above its trigger when there is no room below (a trigger near the bottom of the window).
      const el = e.currentTarget, rect = trigger.current;
      if ((e.nativeEvent as ToggleEvent).newState !== "open" || !rect) return;
      if (rect.bottom + 6 + el.offsetHeight > window.innerHeight - 8) el.style.top = `${Math.max(8, rect.top - 6 - el.offsetHeight)}px`;
    }}>
      {options.map((o) => <button key={o.value} role="menuitemradio" aria-checked={o.value === value} onClick={() => { menu.current?.hidePopover(); onChange(o.value); }}>
        <span className="history-filter-check" aria-hidden="true">{o.value === value ? "✓" : ""}</span>{o.label}
      </button>)}
    </div>, host)}
  </>;
}
