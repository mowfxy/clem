import type { Space } from '../../core/types';
import './space-mark.css';

/**
 * A subject's or project's own mark: a hand-drawn glyph for its discipline, picked by the model from the
 * name, description and first chat (`space.mark`), read from the name until then, or a bookmark when none fits. Drawn on the same 32-unit grid and pen as the app's icons;
 * each glyph has its own hover motion in space-mark.css (keyed by `m-<key>`, strokes by `stroke-<i>`).
 */
type Theme = { key: string; test: RegExp; strokes: string[] };
const themes: Theme[] = [
  { key: 'maths', test: /\b(math\w*|calculus|algebra|geometry|trig\w*|statistic\w*|probability|arithmetic|linear|discrete)\b|\bmat[h ]?\d/i, strokes: ['M23 7Q16 6 9 7L17 16L9 25Q16 26 23 25'] },
  { key: 'physics', test: /\b(physics|mechanics|quantum|thermo\w*|electro\w*|optics|relativity|astro\w*)\b/i, strokes: ['M4 16Q4 11 16 11Q28 11 28 16Q28 21 16 21Q4 21 4 16Z', 'M9.8 5.4Q14 3 20 13.4Q26 23.8 22.2 26.6Q18 29 12 18.6Q6 8.2 9.8 5.4Z', 'M22.2 5.4Q26 8.2 20 18.6Q14 29 9.8 26.6Q6 23.8 12 13.4Q18 3 22.2 5.4Z', 'M16 15.2L16.1 16.8'] },
  { key: 'chemistry', test: /\b(chem\w*|organic|inorganic|biochem\w*|pharma\w*)\b/i, strokes: ['M11 4Q16 3 21 4', 'M13 4L13 12L6 24Q5 28 9 28L23 28Q27 28 26 24L19 12L19 4', 'M9 20Q16 18 23 20'] },
  { key: 'biology', test: /\b(bio\w*|ecology|genetic\w*|anatomy|physiology|botany|zoology|microbio\w*|cell|evolution|neuro\w*)\b/i, strokes: ['M6 26Q4 7 26 5Q28 25 6 26Z', 'M6 26Q12 20 18 13'] },
  { key: 'medicine', test: /\b(medic\w*|health|nursing|clinical|pathology|surgery|dental)\b/i, strokes: ['M3 17L9 17L12 9L17 25L21 14L23 17L29 17'] },
  { key: 'code', test: /\b(code|coding|program\w*|computer|computing|software|cs\d*|web|data science|machine learning|ai|algorithms?|javascript|python)\b/i, strokes: ['M11 9L4 16L11 23', 'M21 9L28 16L21 23', 'M18 7L14 25'] },
  { key: 'economics', test: /\b((?:macro|micro)?econ\w*|finance|business|accounting|marketing|management|investing|market)\b/i, strokes: ['M4 28Q16 27 28 28', 'M8 25L8 19', 'M14 25L14 12', 'M20 25L20 16', 'M26 25L26 6'] },
  { key: 'history', test: /\b(history|historical|civics|politic\w*|government|law|legal|philosophy|classics)\b/i, strokes: ['M5 28Q16 27 27 28', 'M16 4L27 11L5 11Z', 'M9 13L9 25M16 13L16 25M23 13L23 25'] },
  { key: 'language', test: /\b(english|literature|writing|essay\w*|poetry|reading|language\w*|spanish|french|german|arabic|chinese|japanese|latin|linguistics|grammar)\b/i, strokes: ['M8 23L10 17L22 5Q25 3 27 6Q28 8 26 10L14 22Z', 'M20 7L25 12', 'M5 28Q11 26 18 28'] },
  { key: 'earth', test: /\b(geo\w*|earth|climate|environment\w*|ocean\w*)\b/i, strokes: ['M28 16C28 32 4 32 4 16C4 0 28 0 28 16Z', 'M4.5 16Q16 15 27.5 16', 'M16 4Q9 16 16 28Q23 16 16 4Z'] },
  { key: 'music', test: /\b(music\w*|piano|guitar|song\w*|composition)\b/i, strokes: ['M12 24L12 8L26 4L26 20', 'M12 24Q12 28 8 28Q5 28 5 25Q5 22 9 22Q12 22 12 24Z', 'M26 20Q26 24 22 24Q19 24 19 21Q19 18 23 18Q26 18 26 20Z'] },
  { key: 'art', test: /\b(art\w*|design|drawing|painting|photo\w*|film|architecture)\b/i, strokes: ['M16 4C7 4 3 11 4 18C5 25 11 28 16 28Q19 28 18 25Q16 21 20 21L24 21Q28 21 28 16C28 9 23 4 16 4Z', 'M10 14L10.2 14.1M15 9L15.2 9.1M21 11L21.2 11.1'] },
  { key: 'engineering', test: /\b(engineer\w*|mechanical|electrical|civil|robotics|circuits?)\b/i, strokes: ['M22 4Q15 4 14 11Q14 13 15 14L5 23Q4 26 7 27Q9 28 11 26L19 17Q20 18 22 18Q28 17 28 11L24 14L20 12L19 8Z'] },
  { key: 'mind', test: /\b(psych\w*|sociology|anthropology|mindfulness)\b/i, strokes: ['M16 4C8 4 5 10 6 16Q7 20 5 23Q9 25 10 28L20 28Q20 24 23 23Q28 21 27 14Q26 4 16 4Z', 'M13 13Q16 9 19 13Q21 17 16 17'] },
];
const other: Theme = { key: 'other', test: /$^/, strokes: ['M9 4Q16 3 23 4L24 28L16 22L8 28Z', 'M12 10Q16 9 20 10'] };

/** Every key the model may choose from. */
export const markKeys = [...themes.map(t => t.key), other.key] as const;

export function spaceTheme(space: Pick<Space, 'name' | 'description' | 'mark'>) {
  const picked = space.mark?.for === space.name ? [...themes, other].find(t => t.key === space.mark!.key) : undefined;
  return picked || themes.find(t => t.test.test(space.name)) || themes.find(t => t.test.test(space.description || '')) || other;
}

/** `bare` draws the glyph alone at `size` (cards); otherwise it sits on a small grey tile (sidebar). */
export function SpaceMark({ space, size = 20, bare = false }: { space: Pick<Space, 'id' | 'name' | 'description' | 'kind' | 'mark'>; size?: number; bare?: boolean }) {
  const theme = spaceTheme(space), glyph = bare ? size : Math.round(size * 0.66);
  return <span className={`space-mark m-${theme.key} ${bare ? 'bare' : ''}`} style={{ width: size, height: size }} title={`${space.kind === 'subject' ? 'Subject' : 'Project'}: ${space.name}`} aria-label={`In ${space.kind} ${space.name}`}>
    <svg className="drawn-icon" width={glyph} height={glyph} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={bare ? 2.1 : 2.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {theme.strokes.map((d, i) => <path key={i} pathLength={1} d={d} className={`stroke stroke-${i}`} />)}
    </svg>
  </span>;
}
