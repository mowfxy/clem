import type { CSSProperties, ReactNode } from 'react';
import type { Space } from '../../core/types';

/** A subject's or project's own mark: a glyph for its discipline, read from its name, or a monogram of the name. */
type Theme = { test: RegExp; color: string; glyph: ReactNode };
const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const themes: Theme[] = [
  { test: /\b(math\w*|calculus|algebra|geometry|trig\w*|statistic\w*|probability|arithmetic|linear|discrete)\b|\bmat[h ]?\d/i, color: '#8f9dff', glyph: <path {...s} d="M11.5 3.5h-7l4 4.5-4 4.5h7" /> },
  { test: /\b(physics|mechanics|quantum|thermo\w*|electro\w*|optics|relativity|astro\w*)\b/i, color: '#b49ddb', glyph: <g {...s}><ellipse cx="8" cy="8" rx="6" ry="2.4" /><ellipse cx="8" cy="8" rx="6" ry="2.4" transform="rotate(60 8 8)" /><ellipse cx="8" cy="8" rx="6" ry="2.4" transform="rotate(-60 8 8)" /><circle cx="8" cy="8" r=".9" fill="currentColor" /></g> },
  { test: /\b(chem\w*|organic|inorganic|biochem\w*|pharma\w*)\b/i, color: '#8fcfae', glyph: <path {...s} d="M6.3 2.5h3.4M6.8 2.5v4.2L3.4 12.4a1 1 0 0 0 .9 1.6h7.4a1 1 0 0 0 .9-1.6L9.2 6.7V2.5M4.9 10h6.2" /> },
  { test: /\b(bio\w*|ecology|genetic\w*|anatomy|physiology|botany|zoology|microbio\w*|cell|evolution|neuro\w*)\b/i, color: '#a6d57f', glyph: <path {...s} d="M3 13c0-6 4-10 10-10 0 6-4 10-10 10zM3 13l5.5-5.5" /> },
  { test: /\b(medic\w*|health|nursing|clinical|pathology|surgery|dental)\b/i, color: '#e58f86', glyph: <path {...s} d="M1.8 8.5h3l1.6-3.5 3 7 1.6-3.5h3.2" /> },
  { test: /\b(code|coding|program\w*|computer|computing|software|cs\d*|web|data science|machine learning|ai|algorithms?|javascript|python)\b/i, color: '#7fc8e0', glyph: <path {...s} d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" /> },
  { test: /\b((?:macro|micro)?econ\w*|finance|business|accounting|marketing|management|investing|market)\b/i, color: '#e0bf6e', glyph: <path {...s} d="M2.5 13.5h11M4 13V9.5M7.2 13V5.5M10.4 13V7.5M13 13V3.5" /> },
  { test: /\b(history|historical|civics|politic\w*|government|law|legal|philosophy|classics)\b/i, color: '#d8b48a', glyph: <path {...s} d="M2.5 13.5h11M3.5 6.5h9M8 2.5l5 4H3zM5 6.5v7M8 6.5v7M11 6.5v7" /> },
  { test: /\b(english|literature|writing|essay\w*|poetry|reading|language\w*|spanish|french|german|arabic|chinese|japanese|latin|linguistics|grammar)\b/i, color: '#e59a7e', glyph: <path {...s} d="M3 13.2 4.6 8.5l6-6 2.9 2.9-6 6zM9.3 3.8l2.9 2.9M3 13.2l3-1" /> },
  { test: /\b(geo\w*|earth|climate|environment\w*|ocean\w*)\b/i, color: '#6fc3b0', glyph: <g {...s}><circle cx="8" cy="8" r="5.8" /><path d="M2.2 8h11.6M8 2.2c-2.2 3.3-2.2 8.3 0 11.6M8 2.2c2.2 3.3 2.2 8.3 0 11.6" /></g> },
  { test: /\b(music\w*|piano|guitar|song\w*|composition)\b/i, color: '#e38fc0', glyph: <g {...s}><path d="M6 11.8V3.6l7-1.4v8" /><circle cx="4.4" cy="11.8" r="1.7" /><circle cx="11.4" cy="10.2" r="1.7" /></g> },
  { test: /\b(art\w*|design|drawing|painting|photo\w*|film|architecture)\b/i, color: '#f0a36a', glyph: <g {...s}><path d="M8 2.3a5.7 5.7 0 1 0 0 11.4c1 0 1.3-.8.8-1.5-.6-.8-.2-1.8.8-1.8h1.6a2.5 2.5 0 0 0 2.5-2.5C13.7 4.7 11.2 2.3 8 2.3z" /><circle cx="5.2" cy="7" r=".6" fill="currentColor" /><circle cx="7.6" cy="4.9" r=".6" fill="currentColor" /><circle cx="10.4" cy="5.8" r=".6" fill="currentColor" /></g> },
  { test: /\b(engineer\w*|mechanical|electrical|civil|robotics|circuits?)\b/i, color: '#a9b4c9', glyph: <path {...s} d="M10.2 2.6a3.2 3.2 0 0 0-3 4.3L2.6 11.5l1.9 1.9 4.6-4.6a3.2 3.2 0 0 0 4.3-3l-1.9 1.9-1.7-.4-.4-1.7z" /> },
  { test: /\b(psych\w*|sociology|anthropology|mindfulness)\b/i, color: '#c4a6ea', glyph: <g {...s}><circle cx="8" cy="8" r="5.8" /><path d="M5.5 9.5c1.4 1.4 3.6 1.4 5 0M5.8 6.3h.01M10.2 6.3h.01" /></g> },
];
const fallback = ['#8f9dff', '#e59a7e', '#8fcfae', '#e0bf6e', '#b49ddb', '#7fc8e0', '#e38fc0'];

function hash(text: string) { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h >>> 0; }
/** Up to two characters: the first letters of the first two words, or a letter and its number ("Unit 4" → U4). */
function monogram(name: string) {
  const words = name.trim().split(/[\s_-]+/).filter(Boolean);
  if (!words.length) return '·';
  const first = [...words[0]][0].toUpperCase(), second = words[1] ? [...words[1]][0] : '';
  return (first + (second && /[\p{L}\p{N}]/u.test(second) ? second.toUpperCase() : '')).slice(0, 2);
}

export function spaceTheme(space: Pick<Space, 'id' | 'name' | 'description'>) {
  const found = themes.find(t => t.test.test(space.name)) || themes.find(t => t.test.test(space.description || ''));
  return found ? { color: found.color, glyph: found.glyph, letters: '' } : { color: fallback[hash(space.id) % fallback.length], glyph: null, letters: monogram(space.name) };
}

export function SpaceMark({ space, size = 20 }: { space: Pick<Space, 'id' | 'name' | 'description' | 'kind'>; size?: number }) {
  const theme = spaceTheme(space);
  return <span className={`space-mark ${space.kind}`} style={{ '--mark': theme.color, width: size, height: size } as CSSProperties} title={`${space.kind === 'subject' ? 'Subject' : 'Project'}: ${space.name}`} aria-label={`In ${space.kind} ${space.name}`}>
    {theme.glyph ? <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 16 16" aria-hidden="true">{theme.glyph}</svg> : <span className="space-mark-letters" aria-hidden="true">{theme.letters}</span>}
  </span>;
}
