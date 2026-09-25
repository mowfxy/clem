import { useMemo, useState } from "react";
import type { StoredFile } from "../../core/types";
import { Icon } from "../Icons";
import { sizeLabel } from "../store";

const ext = (name: string) => (name.includes(".") ? name.split(".").pop()!.toUpperCase().slice(0, 4) : "FILE");

/** Pick a saved file for the conversation. Files from here come first; searching looks everywhere. */
export function SavedFilePicker({ files, spaceId, attached, onPick }: { files: StoredFile[]; spaceId: string | null; attached: string[]; onPick: (file: StoredFile) => void }) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? files.filter((f) => f.name.toLowerCase().includes(q)) : files.filter((f) => f.spaceId === spaceId);
    return [...pool].sort((a, b) => Number(b.spaceId === spaceId) - Number(a.spaceId === spaceId) || (b.updated || b.created) - (a.updated || a.created)).slice(0, 200);
  }, [files, spaceId, query]);
  return <div className="saved-picker">
    <div className="saved-search"><Icon name="research" size={15} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${files.length} saved file${files.length === 1 ? "" : "s"}`} aria-label="Search saved files" onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) { e.preventDefault(); onPick(shown[0]); } }} /></div>
    <div className="saved-list" role="listbox" aria-label="Saved files">
      {shown.map((f) => <button key={f.id} role="option" aria-selected={attached.includes(f.id)} onClick={() => onPick(f)}>
        <span className="saved-ext">{ext(f.name)}</span>
        <span className="saved-name">{f.name}</span>
        <small>{sizeLabel(f.size)}</small>
        {attached.includes(f.id) && <Icon name="check" size={14} />}
      </button>)}
      {!shown.length && <p className="saved-empty">{query ? `No files match “${query}”.` : "No files here yet. Search to find files from anywhere, or upload one with the + button."}</p>}
    </div>
  </div>;
}
