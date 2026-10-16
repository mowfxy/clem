import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icons";

/** A small text-only pick list in Mowr's menu style (src/popups.css): the trigger shows the current choice, the menu
 *  ticks it. Used where a native <select> would otherwise appear. */
export function PickMenu<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  const id = useId(), menu = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) || options[0];
  return <>
    <button type="button" className="pick-trigger" aria-label={`${label}: ${current.label}`} popoverTarget={id} onClick={(e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (menu.current) { menu.current.style.left = `${Math.max(8, Math.min(rect.right - 180, window.innerWidth - 196))}px`; menu.current.style.top = `${rect.bottom + 6}px`; }
    }}>{current.label}<Icon name="down" size={13} /></button>
    {createPortal(<div id={id} ref={menu} popover="auto" role="menu" aria-label={label} className="chat-options history-filter-menu pick-menu">
      {options.map((o) => <button key={o.value} role="menuitemradio" aria-checked={o.value === value} onClick={() => { menu.current?.hidePopover(); onChange(o.value); }}>
        <span className="history-filter-check" aria-hidden="true">{o.value === value ? "✓" : ""}</span>{o.label}
      </button>)}
    </div>, document.body)}
  </>;
}
