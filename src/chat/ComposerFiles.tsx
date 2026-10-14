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

/** A long name keeps its start and its end: "Lecture 4 – Osmosis and wat…potential.pdf". */
const middle = (name: string, max = 64) => {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.'), ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : '';
  const stem = name.slice(0, name.length - ext.length), keep = max - ext.length - 1;
  return stem.slice(0, Math.ceil(keep * .7)) + '…' + stem.slice(-Math.floor(keep * .3)) + ext;
};

function Thumb({ id }: { id: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let live = true, made = ''; void getBlob(id).then((b) => { if (b && live) { made = URL.createObjectURL(b); setUrl(made); } }); return () => { live = false; if (made) URL.revokeObjectURL(made); }; }, [id]);
  return url ? <img src={url} alt="" /> : <span className="cf-wait" />;
}

/** What goes with the message, above the chat box's tools, as Claude shows it: square tiles, a picture filling its
 *  tile, a file showing its name with its type in a small badge. */
export function ComposerFiles({ items }: { items: TrayItem[] }) {
  if (!items.length) return null;
  return <div className="composer-files" role="list" aria-label="Attached">
    {items.map((item) => {
      const kind = fileKind(item.name, item.type);
      const ext = (item.name.includes('.') ? item.name.split('.').pop()! : 'file').toUpperCase().slice(0, 4);
      const remove = <button type="button" className="cf-remove" aria-label={`Remove ${item.name}`} onClick={item.onRemove}><Icon name="close" size={11} /></button>;
      if (kind === 'image' && item.fileId) return <div role="listitem" key={item.key} className="cf-tile cf-photo" title={item.name}><Thumb id={item.fileId} />{remove}</div>;
      return <div role="listitem" key={item.key} className={'cf-tile cf-file dc-' + kind} title={item.name + (item.size ? ' · ' + sizeLabel(item.size) : '')}>
        <span className="cf-name">{middle(item.name)}</span>
        <span className="cf-badge">{item.icon}{item.note || ext}</span>
        {remove}
      </div>;
    })}
  </div>;
}
