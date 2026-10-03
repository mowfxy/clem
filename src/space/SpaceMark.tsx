import type { Space } from '../../core/types';
import { strokes } from '../Icons';
import './space-mark.css';

/**
 * A subject's or project's own mark: a hand-drawn glyph for its discipline, picked by the model from the
 * name, description and first chat (`space.mark`), read from the name until then, or a bookmark when none fits. Drawn on the same 32-unit grid and pen as the app's icons;
 * each glyph has its own hover motion in space-mark.css (keyed by `m-<key>`, strokes by `stroke-<i>`).
 */
type Theme = { key: string; test: RegExp; strokes: string[] };
const ring = (x: number, y: number, r: number) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
const bar = (x: number, top: number) => `F M${x} ${top}h3.5v${25 - top}H${x}Z`;
// A stroke starting with "F " is also filled with the soft grey, as in the app's icons.
const themes: Theme[] = [
  { key: 'maths', test: /\b(math\w*|calculus|algebra|geometry|trig\w*|statistic\w*|probability|arithmetic|linear|discrete)\b|\bmat[h ]?\d/i, strokes: ['M23 7H9l8.5 9L9 25h14'] },
  { key: 'physics', test: /\b(physics|mechanics|quantum|thermo\w*|electro\w*|optics|relativity|astro\w*)\b/i, strokes: ['M4 16c0-3.3 5.4-6 12-6s12 2.7 12 6-5.4 6-12 6-12-2.7-12-6Z', 'M10 5.6c2.9-1.7 7.9 1.6 11.2 7.4s3.8 11.6.8 13.3-7.9-1.6-11.2-7.4S7 7.3 10 5.6Z', 'M22 5.6c2.9 1.7 2.6 7.6-.7 13.4s-8.3 9.1-11.2 7.4-2.6-7.6.7-13.4S19 3.9 22 5.6Z', 'F ' + ring(16, 16, 2.2)] },
  { key: 'chemistry', test: /\b(chem\w*|organic|inorganic|biochem\w*|pharma\w*)\b/i, strokes: ['M11.5 4h9', 'M14 4v8.5L6.6 24.3A2.5 2.5 0 0 0 8.7 28h14.6a2.5 2.5 0 0 0 2.1-3.7L18 12.5V4', 'F M9.3 20h13.4l2.7 4.3A2.5 2.5 0 0 1 23.3 28H8.7a2.5 2.5 0 0 1-2.1-3.7Z'] },
  { key: 'biology', test: /\b(bio\w*|ecology|genetic\w*|anatomy|physiology|botany|zoology|microbio\w*|cell|evolution|neuro\w*)\b/i, strokes: ['F M6 26C5 13 12 6 26 5c1 14-6 21-20 21Z', 'M6 26l12-12'] },
  { key: 'medicine', test: /\b(medic\w*|health|nursing|clinical|pathology|surgery|dental)\b/i, strokes: ['M3 17h6l3-8 5 16 4-11 2 3h6'] },
  { key: 'code', test: /\b(code|coding|program\w*|computer|computing|software|cs\d*|web|data science|machine learning|ai|algorithms?|javascript|python)\b/i, strokes: ['M11 9l-7 7 7 7', 'M21 9l7 7-7 7', 'M18 6l-4 20'] },
  { key: 'economics', test: /\b((?:macro|micro)?econ\w*|finance|business|accounting|marketing|management|investing|market)\b/i, strokes: ['M4 28h24', bar(6.5, 19), bar(12.5, 12), bar(18.5, 15), bar(24.5, 6)] },
  { key: 'history', test: /\b(history|historical|civics|politic\w*|government|law|legal|philosophy|classics)\b/i, strokes: ['M5 28h22', 'F M16 4l11 7H5Z', 'M9 14v10M16 14v10M23 14v10'] },
  { key: 'language', test: /\b(english|literature|writing|essay\w*|poetry|reading|language\w*|spanish|french|german|arabic|chinese|japanese|latin|linguistics|grammar)\b/i, strokes: ['F M8 23l1.5-5.5L21 6a2.1 2.1 0 0 1 3 3L12.5 20.5Z', 'M19 8l3 3', 'M5 28c4-1.5 9-1.5 13 0'] },
  { key: 'earth', test: /\b(geo\w*|earth|climate|environment\w*|ocean\w*)\b/i, strokes: [ring(16, 16, 12), 'M4 16h24', 'F M16 4c-4.5 4-4.5 20 0 24 4.5-4 4.5-20 0-24Z'] },
  { key: 'music', test: /\b(music\w*|piano|guitar|song\w*|composition)\b/i, strokes: ['M12 23V8l14-4v15', 'F ' + ring(9, 23, 3), 'F ' + ring(23, 19, 3)] },
  { key: 'art', test: /\b(art\w*|design|drawing|painting|photo\w*|film|architecture)\b/i, strokes: ['F M16 4C9.4 4 4 9.4 4 16s5.4 12 12 12c1.9 0 2.6-1.5 1.6-3-1-1.6 0-3 2-3H23c2.8 0 5-2.2 5-5.5C28 9.2 22.6 4 16 4Z', 'M10 15v.1M14 10v.1M20 10v.1'] },
  { key: 'engineering', test: /\b(engineer\w*|mechanical|electrical|civil|robotics|circuits?)\b/i, strokes: ['F M21.5 4a6.5 6.5 0 0 0-6.2 8.5L5 22.8a2.3 2.3 0 0 0 3.2 3.2L18.5 15.7A6.5 6.5 0 0 0 27 9.5l-3.7 3.7-3.3-1.2-1.2-3.3L22.5 5A6.5 6.5 0 0 0 21.5 4Z'] },
  { key: 'mind', test: /\b(psych\w*|sociology|anthropology|mindfulness)\b/i, strokes: ['F M17 4c-6 0-10 4.5-10 10 0 2.4.8 4 1.2 5.2L6 23.5l3 .8V28h8v-4c6 0 10-4 10-10S22.5 4 17 4Z', 'M14 13.5a3 3 0 1 1 3 3'] },
];
const other: Theme = { key: 'other', test: /$^/, strokes: ['F M9 4h14v24l-7-5-7 5Z', 'M12.5 10h7'] };

/** Every key the model may choose from. */
export const markKeys = [...themes.map(t => t.key), other.key] as const;

export function spaceTheme(space: Pick<Space, 'name' | 'description' | 'mark'>) {
  const picked = space.mark?.for === space.name ? [...themes, other].find(t => t.key === space.mark!.key) : undefined;
  return picked || themes.find(t => t.test.test(space.name)) || themes.find(t => t.test.test(space.description || '')) || other;
}

/** `bare` draws the glyph alone at `size` (cards); otherwise it sits on a small grey tile (sidebar). */
/** `decorative` when the space's name is written right beside the mark, so it is not announced twice. */
export function SpaceMark({ space, size = 20, bare = false, decorative = false }: { space: Pick<Space, 'id' | 'name' | 'description' | 'kind' | 'mark'>; size?: number; bare?: boolean; decorative?: boolean }) {
  const theme = spaceTheme(space), glyph = bare ? size : Math.round(size * 0.66);
  return <span className={`space-mark m-${theme.key} ${bare ? 'bare' : ''}`} style={{ width: size, height: size }} {...(decorative ? { 'aria-hidden': true } : { 'aria-description': `${space.kind === 'subject' ? 'Subject' : 'Project'}: ${space.name}`, 'aria-label': `In ${space.kind} ${space.name}` })}>
    <svg className="drawn-icon" width={glyph} height={glyph} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={bare ? 2.1 : 2.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {strokes(theme.strokes)}
    </svg>
  </span>;
}
