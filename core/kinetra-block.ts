// A ```kinetra block in an answer ({"title","caption","module","fn","args"}): read the same way by the chat
// (src/chat/KinetraFigure.tsx), Telegram's photos (src/telegram/figure-draw.ts) and the VPS worker. Pure.
import { parseModelJson } from './model-json.ts';

export type KinetraBlock = { title: string; caption?: string; module: string; fn: string; args: unknown[] };

export function readKinetraBlock(body: string): KinetraBlock | null {
  let value: any;
  try { value = parseModelJson(body); } catch { return null; }
  const figure = value?.figure && typeof value.figure === 'object' ? { ...value.figure, ...value, figure: undefined } : value;
  if (typeof figure?.module !== 'string' || typeof figure?.fn !== 'string' || !Array.isArray(figure?.args)) return null;
  return { title: typeof figure.title === 'string' && figure.title.trim() ? figure.title.trim() : '', caption: typeof figure.caption === 'string' ? figure.caption : undefined, module: figure.module, fn: figure.fn, args: figure.args };
}

