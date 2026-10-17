import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../Icons';
import { sizeLabel } from '../store';
import type { StoredFile } from '../../core/types';
import './storage-summary.css';

export const kinds = [
  // A saved YouTube video is a Markdown transcript, so it is told apart before Documents claims it.
  { id: 'video', label: 'Videos', test: (f: StoredFile) => !!f.video },
  { id: 'pdf', label: 'PDFs', test: (f: StoredFile) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name) },
  { id: 'doc', label: 'Documents', test: (f: StoredFile) => /word|presentation|spreadsheet|officedocument|text\/|json|csv|markdown/.test(f.type) || /\.(docx?|pptx?|xlsx?|txt|md|csv|rtf|odt)$/i.test(f.name) },
  { id: 'image', label: 'Images', test: (f: StoredFile) => f.type.startsWith('image/') },
  { id: 'media', label: 'Audio & video', test: (f: StoredFile) => f.type.startsWith('audio/') || f.type.startsWith('video/') },
  { id: 'other', label: 'Other', test: () => true },
] as const;
export type FileKind = (typeof kinds)[number]['id'];
/** The first kind a file belongs to: the same grouping the storage bar and the Files page filters use. */
export const kindOf = (f: StoredFile): FileKind => kinds.find((k) => k.test(f))!.id;

/** How much the person keeps in Mowr, what kind of files it is, and how much room the device has left. */
export function StorageSummary({ files }: { files: StoredFile[] }) {
  const local = files.filter((f) => !f.remote);
  const total = local.reduce((n, f) => n + f.size, 0);
  const groups = useMemo(() => {
    const sums = new Map<string, { bytes: number; count: number }>(kinds.map((k) => [k.id, { bytes: 0, count: 0 }]));
    for (const f of local) { const k = kinds.find((x) => x.test(f))!; const g = sums.get(k.id)!; g.bytes += f.size; g.count++; }
    return kinds.map((k) => ({ ...k, ...sums.get(k.id)! })).filter((g) => g.count > 0);
  }, [files]);
  const [free, setFree] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void navigator.storage?.estimate?.().then((e) => { if (live && e.quota) setFree(Math.max(0, e.quota - (e.usage || 0))); }).catch(() => {});
    return () => { live = false; };
  }, [total]);

  return <section className="storage-card" aria-label="Storage">
    <div className="storage-top">
      <span className="storage-emblem" aria-hidden="true"><Icon name="files" size={20} /></span>
      <div className="storage-figure">
        <strong>{total ? sizeLabel(total) : 'Nothing stored yet'}</strong>
        <span>{local.length ? `${local.length} ${local.length === 1 ? 'file' : 'files'}` : 'Uploaded files appear here'}</span>
      </div>
      <span className="storage-where"><Icon name="device" size={14} />Private to this device{free !== null ? ` · ${sizeLabel(free)} free` : ''}</span>
    </div>
    <div className="storage-bar" role="img" aria-label={groups.map((g) => `${g.label} ${sizeLabel(g.bytes)}`).join(', ') || 'Empty'}>
      {groups.map((g) => <span key={g.id} className={`k-${g.id}`} style={{ flexGrow: Math.max(g.bytes, total * 0.02) }} />)}
    </div>
    {groups.length > 0 && <ul className="storage-legend">
      {groups.map((g) => <li key={g.id}><i className={`k-${g.id}`} aria-hidden="true" />{g.label}<span>{sizeLabel(g.bytes)}</span></li>)}
    </ul>}
  </section>;
}
