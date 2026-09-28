import { useState } from "react";
import { Icon } from "../Icons";

/** A pencil drawn to match the app's line icons. */
export function PencilIcon({ size = 16 }: { size?: number }) {
  return <Icon name="rename" size={size} />;
}

/** Keeps the original extension when a new name is typed without one. */
export function withExtension(name: string, original: string) {
  const clean = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim().slice(0, 180);
  const ext = original.match(/\.[A-Za-z0-9]{1,6}$/)?.[0] || "";
  if (!clean) return original;
  return ext && !clean.toLowerCase().endsWith(ext.toLowerCase()) ? clean + ext : clean;
}

/** Inline name editor: Enter or leaving the field saves, Escape cancels. The extension is shown
 *  separately so it can't be lost by accident. */
export function RenameField({ name, onSave, onCancel }: { name: string; onSave: (name: string) => void; onCancel: () => void }) {
  const ext = name.match(/\.[A-Za-z0-9]{1,6}$/)?.[0] || "";
  const [value, setValue] = useState(ext ? name.slice(0, -ext.length) : name);
  const save = () => { const next = withExtension(value, name); if (next !== name) onSave(next); else onCancel(); };
  return <span className="rename-field">
    <input autoFocus value={value} aria-label="File name" onFocus={(e) => e.currentTarget.select()} onChange={(e) => setValue(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { e.preventDefault(); onCancel(); } }} />
    {ext && <span className="rename-ext">{ext}</span>}
  </span>;
}
