/**
 * Finite state machine representation and basic simulation.
 */

import { KinetraError } from "../errors.js";

export interface FSMState {
  id: string;
  name: string;
  /** Optional output value(s) when the FSM is in this state (Moore) or with the transition (Mealy). */
  output?: string;
}

export interface FSMTransition {
  from: string;
  to: string;
  /** Boolean expression string over the input variables. */
  condition: string;
  /** Optional Mealy output. */
  output?: string;
}

export interface FSM {
  name: string;
  inputs: string[];
  outputs: string[];
  states: FSMState[];
  transitions: FSMTransition[];
  initial: string;
}

export function newFSM(name: string, inputs: string[], outputs: string[], initial: string): FSM {
  return { name, inputs, outputs, states: [], transitions: [], initial };
}

export function addState(f: FSM, name: string, output?: string): FSMState {
  const s: FSMState = { id: name, name, output };
  f.states.push(s);
  return s;
}

export function addTransition(f: FSM, from: string, to: string, condition: string, output?: string): void {
  f.transitions.push({ from, to, condition, output });
}

export function simulateFSM(f: FSM, trace: { inputs: Record<string, 0 | 1> }[]): { state: string; outputs: Record<string, 0 | 1> }[] {
  let cur = f.initial;
  const log: { state: string; outputs: Record<string, 0 | 1> }[] = [];
  for (const step of trace) {
    const tr = f.transitions.find((t) => t.from === cur && evaluateCondition(t.condition, step.inputs));
    if (tr) cur = tr.to;
    const stateObj = f.states.find((s) => s.id === cur)!;
    const out: Record<string, 0 | 1> = {};
    for (const o of f.outputs) out[o] = stateObj.output === "1" ? 1 : 0;
    log.push({ state: cur, outputs: out });
  }
  return log;
}

function evaluateCondition(cond: string, inputs: Record<string, 0 | 1>): boolean {
  // Simple "expr" evaluator: supports var names, !, &, |, (, ).
  let s = cond;
  for (const [k, v] of Object.entries(inputs)) {
    s = s.replaceAll(k, v.toString());
  }
  s = s.replaceAll("!", "not ").replaceAll("&", " and ").replaceAll("|", " or ");
  // eslint-disable-next-line no-new-func
  try {
    const py = s.replaceAll(" and ", " && ").replaceAll(" or ", " || ").replaceAll("not ", "!");
    return Boolean(new Function(`return (${py});`)());
  } catch (e) {
    throw new KinetraError("validation", `Cannot evaluate FSM condition: ${cond}`, { error: String(e) });
  }
}
