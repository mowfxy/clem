/**
 * How many characters one request may carry, by provider. Roughly 3.5 characters per token for technical text;
 * each budget leaves room for Mowr's instructions, the Kinetra tool guide and a long answer.
 * - ChatGPT (Codex): about 272k input tokens.
 * - Claude and Grok: about 200k tokens.
 */
export type ContextBudget = {
  /** Text of the person's files (attached, open, in the subject or project). */
  sources: number;
  /** The whole request: conversation, files, Drive and video transcripts. */
  conversation: number;
  /** Hard ceiling on what reaches the provider, checked before sending. */
  ceiling: number;
};

export function contextBudget(model?: string): ContextBudget {
  if (/^(claude|grok):/.test(model || "")) return { sources: 280_000, conversation: 440_000, ceiling: 520_000 };
  return { sources: 440_000, conversation: 680_000, ceiling: 780_000 };
}
