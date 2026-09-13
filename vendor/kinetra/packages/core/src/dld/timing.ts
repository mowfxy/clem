/**
 * Deterministic timing diagram representation.
 *
 * A timing diagram is a list of (time, signal, value) changes. Renders can
 * derive a square-wave SVG from the change list. The canonical form keeps
 * the list sparse: only transitions are stored.
 */

export type LogicValue = 0 | 1 | "X" | "Z";

export interface Transition {
  time: number;
  signal: string;
  to: LogicValue;
}

export interface TimingSpec {
  name: string;
  signals: string[];
  transitions: Transition[];
  /** Optional annotations shown above transitions. */
  annotations: { time: number; text: string }[];
  /** Duration of the diagram in time units. */
  duration: number;
}

export function newTiming(name: string, signals: string[], duration: number): TimingSpec {
  return { name, signals: [...signals], transitions: [], annotations: [], duration };
}

export function addTransition(t: TimingSpec, time: number, signal: string, to: LogicValue): void {
  if (!t.signals.includes(signal)) throw new Error(`Unknown signal: ${signal}`);
  if (time < 0 || time > t.duration) throw new Error(`Time ${time} out of range`);
  t.transitions.push({ time, signal, to });
  t.transitions.sort((a, b) => a.time - b.time || a.signal.localeCompare(b.signal));
}

export function addAnnotation(t: TimingSpec, time: number, text: string): void {
  t.annotations.push({ time, text });
  t.annotations.sort((a, b) => a.time - b.time);
}

/** Sample the value of a signal at a given time. */
export function sampleAt(t: TimingSpec, time: number, signal: string): LogicValue {
  let cur: LogicValue = 0;
  for (const tr of t.transitions) {
    if (tr.time > time) break;
    if (tr.signal === signal) cur = tr.to;
  }
  return cur;
}

/** Build a clock signal with period `period` and 50% duty cycle. */
export function clock(name: string, duration: number, period: number): TimingSpec {
  const t = newTiming("clock", [name], duration);
  for (let time = 0; time < duration; time += period / 2) {
    addTransition(t, time, name, time % period === 0 ? 0 : 1);
  }
  return t;
}
