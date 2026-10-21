import type { AnswerUsage, Chat, StoredFile, StudySet, VisualRecord } from './types';

/** Two usage reports for the same reply (a plan's steps, a retry) as one: counts add up, the files opened join. */
export function addUsage(a: AnswerUsage | undefined, b: AnswerUsage): AnswerUsage {
  if (!a) return b;
  const t = a.tokens || b.tokens ? {
    input: (a.tokens?.input || 0) + (b.tokens?.input || 0), cacheRead: (a.tokens?.cacheRead || 0) + (b.tokens?.cacheRead || 0),
    cacheWrite: (a.tokens?.cacheWrite || 0) + (b.tokens?.cacheWrite || 0), output: (a.tokens?.output || 0) + (b.tokens?.output || 0),
  } : undefined;
  const read = [...new Set([...(a.read || []), ...(b.read || [])])];
  return { model: b.model || a.model, ...(t ? { tokens: t } : {}), calls: (a.calls || 0) + (b.calls || 0), ms: (a.ms || 0) + (b.ms || 0), ...(read.length ? { read } : {}), ...((a.web || 0) + (b.web || 0) ? { web: (a.web || 0) + (b.web || 0) } : {}) };
}

/**
 * Public API list prices, US dollars per million tokens (fresh input, output), by model family. Clem's answers run on
 * the person's own plans, which are not billed per token: this is what the same tokens would cost on the API, rounded,
 * so a thread's weight can be compared. Prompt-cache reads are priced at a tenth of input, writes at a quarter more.
 */
const RATES: [RegExp, number, number][] = [
  [/opus/i, 5, 25], [/sonnet/i, 3, 15], [/haiku/i, 1, 5],
  [/gemini.*flash-?lite|flash-?lite/i, 0.1, 0.4], [/gemini.*flash|flash/i, 0.3, 2.5], [/gemini/i, 1.25, 10],
  [/grok.*(mini|fast)/i, 0.2, 0.5], [/grok/i, 3, 15],
  [/(gpt|codex|o\d).*(mini|nano)|luna/i, 0.25, 2], [/gpt|codex|^o\d/i, 1.25, 10],
];
const FALLBACK: [number, number] = [2, 10];
export function rateOf(model = ''): [number, number] {
  const hit = RATES.find(([re]) => re.test(model));
  return hit ? [hit[1], hit[2]] : FALLBACK;
}
/** One reply's tokens at API prices, in dollars. */
export function costOf(usage: AnswerUsage | undefined, model?: string) {
  const t = usage?.tokens;
  if (!t) return 0;
  const [input, output] = rateOf(usage.model || model);
  return (t.input * input + t.cacheRead * input * 0.1 + t.cacheWrite * input * 1.25 + t.output * output) / 1_000_000;
}
/** "$0.04", "< $0.01", "$1.20", "$12". */
export function money(dollars: number) {
  if (dollars <= 0) return '$0';
  if (dollars < 0.01) return '< $0.01';
  return '$' + (dollars < 10 ? dollars.toFixed(2) : Math.round(dollars).toLocaleString());
}

/** Everything the thread's info panel shows, worked out from the chat as saved. */
export function threadUsage(chat: Chat, { files = [], visuals = [], studySets = [] }: { files?: StoredFile[]; visuals?: VisualRecord[]; studySets?: StudySet[] } = {}) {
  const replies = chat.messages.filter((m) => m.role === 'assistant' && m.content);
  const asked = chat.messages.filter((m) => m.role === 'user');
  const counted = replies.filter((m) => m.usage?.tokens);
  const tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  let cost = 0, calls = 0, ms = 0, web = 0;
  const read = new Set<string>(), models = new Set<string>();
  for (const m of replies) {
    const u = m.usage;
    if (m.model) models.add(m.model);
    if (!u) continue;
    if (u.tokens) { tokens.input += u.tokens.input; tokens.cacheRead += u.tokens.cacheRead; tokens.cacheWrite += u.tokens.cacheWrite; tokens.output += u.tokens.output; }
    cost += costOf(u, m.model);
    calls += u.calls || 0;
    ms += u.ms || 0;
    web += u.web || 0;
    for (const name of u.read || []) read.add(name);
  }
  const byId = new Map(files.map((f) => [f.id, f]));
  const named = (ids: Iterable<string>) => [...new Set(ids)].map((id) => byId.get(id)).filter((f): f is StoredFile => !!f);
  const sent = named(asked.flatMap((m) => [...(m.attachments || []), ...(m.context || [])]));
  const made = named(replies.flatMap((m) => m.attachments || []));
  const drive = new Set(asked.flatMap((m) => (m.drive || []).map((d) => d.id))).size;
  // Visuals drawn in the chat (```visual blocks) and the ones saved from it.
  const drawn = replies.reduce((n, m) => n + (m.content.match(/```visual\b/g)?.length || 0) + (m.visual && m.visual !== 'choose' ? 1 : 0), 0);
  const saved = visuals.filter((v) => v.chatId === chat.id).length;
  const sets = studySets.filter((s) => s.chatId === chat.id);
  return {
    messages: asked.length, replies: replies.length, counted: counted.length,
    tokens, total: tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output,
    cost, calls, ms, web, models: [...models],
    sent, drive, made, read: [...read],
    visuals: Math.max(drawn, saved),
    flashcards: sets.filter((s) => s.kind === 'flashcards').reduce((n, s) => n + s.items.length, 0),
    quizzes: sets.filter((s) => s.kind === 'quiz').length,
  };
}
