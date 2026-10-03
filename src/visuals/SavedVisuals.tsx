import { lazy, Suspense, useEffect, useState } from 'react';
import type { Chat, Space, VisualRecord } from '../../core/types';
import { Icon } from '../Icons';
import { SpaceMark } from '../space/SpaceMark';

const VisualThumb = lazy(() => import('../Visual').then(m => ({ default: m.VisualThumb })));

/** Thumbnail for a model-drawn visual saved in history. */
export function SpecThumb({ spec }: { spec: unknown }) {
  const [html, setHtml] = useState('');
  useEffect(() => { let live = true; void Promise.all([import('../../core/visual-spec'), import('./SpecVisual')]).then(([core, view]) => { try { const svg = view.specSvg(core.compileVisual(spec)); if (live) setHtml(svg.replace(/<title>[\s\S]*?<\/title>/g, '')); } catch { /* an invalid saved spec keeps the empty frame */ } }); return () => { live = false; }; }, [spec]);
  return <div className="visual-thumb" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Where a saved visual lives: the subject or project its chat belongs to (with that space's sidebar mark), or a plain chat. */
export function VisualPlace({ space }: { space?: Space }) {
  return <span className={`visual-place ${space ? space.kind : 'chat'}`} title={space ? `${space.kind === 'subject' ? 'Subject' : 'Project'}: ${space.name}` : 'In a chat'}>
    {space ? <SpaceMark space={space} size={18} decorative /> : <span className="visual-place-icon"><Icon name="chat" size={12} /></span>}
    <span className="visual-place-name">{space ? space.name : 'Chat'}</span>
  </span>;
}

/**
 * Saved visuals as cards. The Visuals page shows all of them with where each one lives; a subject or project shows
 * its own (from chats inside it), so `showPlace` is off there.
 */
export function SavedVisuals({ visuals, chats, spaces, showPlace = true, onOpen, onRemove }: { visuals: VisualRecord[]; chats: Chat[]; spaces: Space[]; showPlace?: boolean; onOpen: (chatId: string) => void; onRemove: (id: string) => void }) {
  return <div className="lib-grid wide saved-visuals">
    {visuals.map((v) => {
      const chat = chats.find((c) => c.id === v.chatId);
      const space = chat?.spaceId ? spaces.find((s) => s.id === chat.spaceId) : undefined;
      return <article className="lib-card lib-visual" key={v.id}>
        <button type="button" className="lib-visual-open" onClick={() => onOpen(v.chatId)} aria-label={`Open ${v.title} in its chat`}>
          <Suspense fallback={<div className="visual-thumb" />}>{v.spec ? <SpecThumb spec={v.spec} /> : <VisualThumb scene={v.scene || 'projectile'} params={v.params} />}</Suspense>
        </button>
        <footer>
          <div>
            <strong>{v.title}</strong>
            <span className="visual-meta">{showPlace && <VisualPlace space={space} />}<span>{new Date(v.created).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span></span>
          </div>
          <button type="button" className="lib-card-chat" aria-label={`Remove ${v.title} from Visuals`} aria-description="Remove from Visuals (it stays in its chat)" onClick={() => onRemove(v.id)}><Icon name="close" size={15} /></button>
        </footer>
      </article>;
    })}
  </div>;
}
