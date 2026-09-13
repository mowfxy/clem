/**
 * Workflow D: retrieval + learning continuity.
 *
 * Ingests a small lecture corpus, indexes it, queries, records history,
 * tracks mastery, and writes a study-plan PDF.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { makeLexicalIndex, addToLexicalIndex, searchLexical } from '../../../core/src/retrieval/lexical.js';
import { makeVectorIndex, addToVectorIndex, searchVector } from '../../../core/src/retrieval/vector.js';
import { chunkText } from '../../../core/src/ingest/chunk.js';
import { HistoryStore } from '../../../core/src/store/history.js';
import { InMemorySqlite } from '../../../core/src/store/sqlite.js';
import { updateMastery, isMastered, isWeak } from '../../../core/src/assessment/mastery_rules.js';
import { createDocument, validateDocument } from '../../../core/src/pdf/document.js';
import type { TextDocument } from '../../../core/src/ingest/chunk.js';

const LECTURES: { id: string; title: string; body: string }[] = [
  { id: 'lec4', title: 'Lecture 4: SR flip-flops', body: 'Lecture 4 covers SR flip-flops: Set and Reset inputs with Q and Q-prime outputs. State table and timing diagrams.' },
  { id: 'lec5', title: 'Lecture 5: JK flip-flops', body: 'Lecture 5 covers JK flip-flops: J and K inputs with clock. Removes forbidden state of SR by toggling when both high.' },
  { id: 'lec6', title: 'Lecture 6: D flip-flops', body: 'Lecture 6 covers D flip-flops: Data input sampled on clock edge; Q follows D after the edge.' },
  { id: 'lec7', title: 'Lecture 7: T flip-flops', body: 'Lecture 7 covers T flip-flops: Toggle input; Q complements on each active clock edge when T is high.' },
];

export function runWorkflowD(): void {
  const lex = makeLexicalIndex();
  const vec = makeVectorIndex();

  for (const lec of LECTURES) {
    const doc: TextDocument = { id: lec.id, source: lec.title, text: lec.body, kind: 'text' };
    const chunks = chunkText(doc, { maxTokens: 80 });
    for (const ch of chunks) {
      addToLexicalIndex(lex, ch);
      addToVectorIndex(vec, ch);
    }
  }

  const lexHits = searchLexical(lex, 'JK flip-flop clock toggle', 3);
  const vecHits = searchVector(vec, 'edge-triggered data capture', 3);
  console.log('[workflow-d] lexical hits:', lexHits.length, 'top:', lexHits[0]?.chunkId);
  console.log('[workflow-d] vector hits:', vecHits.length, 'top:', vecHits[0]?.chunkId);

  // History: record imports + practice attempts.
  const db = new InMemorySqlite();
  const history = new HistoryStore(db);
  history.record({ type: 'import', courseId: 'DLD', payload: { src: 'lecture.pdf' } });
  history.record({ type: 'study-session-start', courseId: 'DLD' });
  history.record({ type: 'practice-attempt', courseId: 'DLD', topicId: 'kmap', correct: true, payload: { q: 'minimize 4-var' } });
  history.record({ type: 'practice-attempt', courseId: 'DLD', topicId: 'kmap', correct: false, payload: { q: 'minimize 4-var' } });
  history.record({ type: 'study-session-end', courseId: 'DLD' });
  const events = history.list({ courseId: 'DLD' });
  console.log('[workflow-d] history events:', events.length);

  // Mastery: track 1 correct + 1 wrong -> not mastered, not weak (depends on rules).
  let m: any = null;
  m = updateMastery(m, { topicId: 'kmap', correct: true });
  m = updateMastery(m, { topicId: 'kmap', correct: false });
  m = updateMastery(m, { topicId: 'kmap', correct: true });
  console.log('[workflow-d] mastery score:', m.score.toFixed(3), 'mastered:', isMastered(m), 'weak:', isWeak(m));

  const doc = createDocument({ title: 'Workflow D — Study Plan' });
  doc.addHeading('Workflow D: Retrieval + Mastery + History', 1);
  doc.addParagraph('Lexical top-1 hit: ' + (lexHits[0]?.chunkId ?? 'none'));
  doc.addParagraph('Vector top-1 hit: ' + (vecHits[0]?.chunkId ?? 'none'));
  doc.addParagraph('History events recorded: ' + events.length);
  doc.addParagraph('Mastery score for kmap topic: ' + m.score.toFixed(3));
  doc.addParagraph('Next study target: review K-map minimisation (corner grouping).');
  const bytes = doc.build();
  validateDocument(bytes);
  mkdirSync('output', { recursive: true });
  writeFileSync('output/workflow-d.pdf', bytes);
  console.log('[workflow-d] wrote output/workflow-d.pdf (' + bytes.byteLength + ' bytes)');
}
