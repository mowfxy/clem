// The Telegram main thread in the laptop's window (docs/MAIN-THREAD.md "Telegram"): the same loop as the VPS worker's
// (desktop/telegram-thread.ts), on the window's workspace, with Clem's organizer model and the engine's actions in the
// main process (desktop/engine/thread-tools.ts, the same as the worker's). It never goes through the app's chat
// pipeline: no working folder, no hand-off, no file tools. Messages are answered one at a time, in the order they came.
import { telegramTurn, type ThreadDeps } from '../../desktop/telegram-thread.ts';
import type { State } from '../store';
import type { TelegramTurn } from '../../desktop/contracts';

type Invoke = (request: Record<string, unknown>) => Promise<any>;
export type WindowThread = {
  state: () => State;
  patch: (fn: (s: State) => State) => void;
  invoke: Invoke;
  /** The main thread's model (Clem's organizer, or the default model). */
  model: () => string | undefined;
  reasoning?: () => string | undefined;
  /** GUC is connected (its part of the Now card is asked for). */
  guc?: () => boolean;
  clock?: () => number;
};

/** The deps of the Telegram main thread in the window. */
export function windowThreadDeps(w: WindowThread): ThreadDeps<State> {
  return {
    ws: { state: () => w.state(), change: (fn) => w.patch(fn) },
    complete: ({ system, user }) => w.invoke({ action: 'tgComplete', system, user, ...(w.model() ? { model: w.model() } : {}), ...(w.reasoning?.() ? { reasoning: w.reasoning() } : {}) }),
    run: (tool) => w.invoke({ action: 'tgTool', tool }),
    before: (text) => w.invoke({ action: 'tgBefore', text }),
    guc: async () => (w.guc?.() === false ? null : await w.invoke({ action: 'gucNow' }).catch(() => null)),
    model: w.model(),
    clock: w.clock,
  };
}

/** Telegram turns for the window: one at a time, each answered once (a message seen twice is answered once). */
export function windowTelegram(w: WindowThread & { answer: (id: string, text: string) => void; undo: (key: string) => Promise<boolean>; confirm: (key: string) => Promise<boolean> }) {
  let chain: Promise<unknown> = Promise.resolve();
  const seen = new Set<string>();
  const one = async (turn: TelegramTurn): Promise<string> => {
    if ('text' in turn) return (await telegramTurn(windowThreadDeps(w), turn.text)).text;
    const tap = turn.tap;
    if (tap.t === 'undo') return (await w.undo(tap.key)) ? 'Undone.' : 'That can’t be undone any more.';
    if (tap.t === 'confirm') return (await w.confirm(tap.key)) ? 'Done.' : 'That couldn’t be done.';
    // An older lecture message's Summarize or Make flashcards: study, done in the app (declined as the words would be).
    if (tap.t === 'summarize' || tap.t === 'flashcards') return (await telegramTurn(windowThreadDeps(w), tap.t === 'summarize' ? `Summarize ${tap.name} in 3 lines, then what I should remember for the exam.` : `Make flashcards from ${tap.name} for this subject.`)).text;
    return 'Done.';
  };
  return (turn: TelegramTurn) => {
    if (seen.has(turn.id)) return chain;
    seen.add(turn.id);
    if (seen.size > 500) seen.delete(seen.values().next().value!);
    chain = chain.then(() => one(turn)).then((text) => w.answer(turn.id, text), (e: Error) => w.answer(turn.id, e?.message && /Clem isn’t ready|workspace hasn't reached/.test(e.message) ? e.message : 'Clem couldn’t answer that just now. Try again in a moment.'));
    return chain;
  };
}
