import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../Icons';
import { getBlob, sizeLabel } from '../store';
import './composer-files.css';

/** A file's kind, for its tile colour (the same palette as the document cards in documents.css). */
export function fileKind(name: string, type = '') {
  const ext = (name.includes('.') ? name.split('.').pop()! : '').toUpperCase();
  if (type.startsWith('image/') || /^(PNG|JPE?G|GIF|WEBP|SVG|HEIC|BMP)$/.test(ext)) return 'image';
  if (ext === 'PDF') return 'pdf';
  if (/^(DOCX?|RTF|ODT)$/.test(ext)) return 'doc';
  if (/^(PPTX?|KEY|ODP)$/.test(ext)) return 'slides';
  if (/^(XLSX?|CSV|TSV|ODS)$/.test(ext)) return 'sheet';
  if (/^(ZIP|RAR|7Z|TAR|GZ)$/.test(ext)) return 'archive';
  if (/^(JSON|XML|YAML|YML)$/.test(ext)) return 'data';
  return 'text';
}

export type TrayItem = { key: string; name: string; type?: string; size?: number; /** A stored file's id: pictures show as a thumbnail. */ fileId?: string; /** Drawn in the tile instead of the type label (a Drive file's icon). */ icon?: ReactNode; note?: string; onRemove: () => void };

function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let live = true, made = ''; void getBlob(id).then((b) => { if (b && live) { made = URL.createObjectURL(b); setUrl(made); } }); return () => { live = false; if (made) URL.revokeObjectURL(made); }; }, [id]);
  return url ? <img src={url} alt="" /> : <span className="cf-wait" />;
}

/** What goes with the message, above the chat box's tools: pictures as small photos, files as cards with their kind. */
export function ComposerFiles({ items }: { items: TrayItem[] }) {
  if (!items.length) return null;
  return <div className="composer-files" role="list" aria-label="Attached">
    {items.map((item) => {
      const kind = fileKind(item.name, item.type);
      const ext = (item.name.includes('.') ? item.name.split('.').pop()! : 'file').toUpperCase().slice(0, 4);
      const remove = <button type="button" className="cf-remove" aria-label={`Remove ${item.name}`} onClick={item.onRemove}><Icon name="close" size={11} /></button>;
      if (kind === 'image' && item.fileId) return <div role="listitem" key={item.key} className="cf-photo" title={item.name}><Thumb id={item.fileId} />{remove}</div>;
      return <div role="listitem" key={item.key} className={'cf-card dc-' + kind} title={item.name}>
        <span className="cf-tile" aria-hidden="true">{item.icon || <b>{ext}</b>}</span>
        <span className="cf-text"><strong>{item.name}</strong><small>{item.note || [ext, item.size ? sizeLabel(item.size) : ''].filter(Boolean).join(' · ')}</small></span>
        {remove}
      </div>;
    })}
  </div>;
}
