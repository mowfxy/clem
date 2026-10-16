import { useEffect, useRef } from "react";
import { Icon } from "../Icons";

/** Every workspace shortcut in one place, grouped the way people look for them. */
export const SHORTCUTS: { group: string; items: [string, string[]][] }[] = [
  { group: "Go anywhere", items: [
    ["Command palette", ["Ctrl", "K"]],
    ["Search everything", ["Ctrl", "Shift", "F"]],
    ["New chat", ["Ctrl", "N"]],
    ["New temporary chat", ["Ctrl", "Shift", "N"]],
    ["New chat · Visuals · Projects · Subjects · Files", ["Ctrl", "1–5"]],
    ["Back · Forward", ["Alt", "← / →"]],
    ["Settings", ["Ctrl", ","]],
  ] },
  { group: "Conversations", items: [
    ["Previous or next chat", ["Alt", "↑ / ↓"]],
    ["Find in this page", ["Ctrl", "F"]],
    ["Send", ["Enter"]],
    ["New line", ["Shift", "Enter"]],
    ["Commands", ["/"]],
    ["Capture screen", ["Ctrl", "Shift", "Space"]],
  ] },
  { group: "Help", items: [
    ["Show these shortcuts", ["Ctrl", "/"]],
    ["Close a window or menu", ["Esc"]],
  ] },
];

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  let row = 0;
  return <dialog ref={dialog} className="shortcuts-sheet" aria-label="Keyboard shortcuts" onClose={onClose} onClick={(e) => { if (e.target === dialog.current) onClose(); }}>
    <header><h2>Keyboard shortcuts</h2><button className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" size={18} /></button></header>
    <div className="sheet-body">
      {SHORTCUTS.map(({ group, items }) => <section key={group}>
        <h3>{group}</h3>
        {items.map(([label, keys]) => <div className="sheet-row" key={label} style={{ animationDelay: `${Math.min(row++, 12) * 18}ms` }}>
          <span>{label}</span>
          <span className="sheet-keys">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
        </div>)}
      </section>)}
    </div>
  </dialog>;
}
