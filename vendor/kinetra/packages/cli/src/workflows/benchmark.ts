/**
 * Benchmark workflow: runs the retrieval benchmark against the built-in
 * SR/JK/D flip-flop near-duplicate corpus.
 */
import { runBenchmark, type BenchmarkCase } from '../../../core/src/retrieval/benchmark.js';
import { makeIndex, addChunks } from '../../../core/src/retrieval/index.js';
import type { Chunk } from '../../../core/src/ingest/chunk.js';

function chunk(id: string, text: string, sourceId: string, heading: string): Chunk {
  return { id, sourceId, index: 0, heading, startLine: 0, endLine: 0, text, depth: 0 };
}

export function runBenchmarkCli(): void {
  const idx = makeIndex();
  const chunks: Chunk[] = [
    chunk('lec4-sr-1', 'Lecture 4: SR flip-flops. The SR latch has set and reset inputs. SR flip-flop behaviour depends on S and R.', 'lec4', 'Lecture 4: SR flip-flops'),
    chunk('lec4-sr-2', 'The SR flip-flop is the simplest latch. Forbidden state arises when both S and R are high.', 'lec4', 'SR latch details'),
    chunk('lec5-jk-1', 'Lecture 5: JK flip-flops. The JK flip-flop toggles when both J and K are high. JK avoids the forbidden state of SR.', 'lec5', 'Lecture 5: JK flip-flops'),
    chunk('lec5-jk-2', 'JK flip-flops implement master-slave designs to avoid race conditions in JK circuits.', 'lec5', 'JK master-slave'),
    chunk('lec6-d-1', 'Lecture 6: D flip-flops. The D flip-flop captures data on the clock edge. D eliminates the race condition.', 'lec6', 'Lecture 6: D flip-flops'),
    chunk('lec6-d-2', 'D flip-flops are edge-triggered and store one bit of data each clock cycle.', 'lec6', 'D edge-triggered'),
  ];
  addChunks(idx, chunks);
  const cases: BenchmarkCase[] = [
    { query: 'SR latch set reset forbidden state', expectedSourceIds: ['lec4'] },
    { query: 'JK flip-flop toggle master slave race', expectedSourceIds: ['lec5'] },
    { query: 'D flip-flop edge triggered data capture', expectedSourceIds: ['lec6'] },
    { query: 'what is a flip-flop', expectedSourceIds: ['lec4', 'lec5', 'lec6'] },
  ];
  const r = runBenchmark(idx, cases);
  console.log('[benchmark] meanRecall=' + r.meanRecall.toFixed(3) + ' meanMrr=' + r.meanMrr.toFixed(3) + ' passRate=' + r.passRate.toFixed(3) + ' total=' + r.total);
}
