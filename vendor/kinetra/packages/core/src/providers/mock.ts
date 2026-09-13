/**
 * Mock provider.
 *
 * Deterministic, offline-only provider used as the default for tests and for
 * local development without API keys. Routes answers by inspecting the last
 * user message and the active system prompt; emits keyword-style answers
 * that downstream code can validate.
 */

import type {
  ChatMessage,
  GenerateRequest,
  GenerateResponse,
  ProviderAdapter,
  ProviderCapabilities,
} from "./types.js";

const CAPS: ProviderCapabilities = {
  text: true,
  vision: false,
  toolCalling: false,
  structuredOutput: true,
  contextTokens: 8192,
  supportsJson: true,
};

/**
 * Heuristic canned responses for the canonical demo prompts. Each entry is
 * a function so the response can carry schema-aware hints.
 */
const RULES: Array<{ match: RegExp; respond: (m: string) => string }> = [
  { match: /simplify\s+(?:the\s+)?(?:boolean\s+)?expression/i,
    respond: (_m) => "Provide the expression in the prompt and the engine will simplify it deterministically." },
  { match: /k[- ]?map|minterms?|maxterms?/i,
    respond: (_m) => "Describe the function as a sum or list of minterms, then call the K-map engine." },
  { match: /truth\s*table/i,
    respond: (_m) => "List the variables and a Boolean expression; the engine emits a canonical truth table." },
  { match: /render|schematic|circuit\s*diagram/i,
    respond: (_m) => "Specify the netlist: gates, inputs, outputs. The engine returns an SVG schematic." },
  { match: /pdf|document|typeset/i,
    respond: (_m) => "Compose the document model (sections, figures, equations) and the PDF emitter writes a byte-stable file." },
  { match: /study|practice|flashcard/i,
    respond: (_m) => "Generate targeted practice from your mastery history; the engine picks weak topics." },
];

function respond(messages: ChatMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const text = lastUser?.content ?? "";
  for (const rule of RULES) {
    if (rule.match.test(text)) return rule.respond(text);
  }
  if (text.length === 0) return "(empty prompt)";
  return `Mock provider received ${text.length} chars; cannot answer generically. Use a real provider.`;
}

export const mockAdapter: ProviderAdapter = {
  kind: "mock",
  capabilities: CAPS,
  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const text = respond(req.messages);
    return {
      text,
      model: req.model,
      finishReason: "stop",
      usage: { inputTokens: req.messages.reduce((n, m) => n + m.content.length, 0), outputTokens: text.length },
    };
  },
  async embed(input: string[]): Promise<Float32Array[]> {
    return input.map((s) => {
      // Deterministic hashed-bag of 32 features: count of character classes.
      const v = new Float32Array(32);
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        v[c % 32] += 1;
      }
      let norm = 0;
      for (let i = 0; i < 32; i++) norm += v[i] * v[i];
      norm = Math.sqrt(norm) || 1;
      for (let i = 0; i < 32; i++) v[i] /= norm;
      return v;
    });
  },
};

// Re-exports for ergonomic imports from the mock adapter surface.
export { defaultRouter, ProviderRouter } from "./router.js";
export { ProviderError, buildContext, extractJson } from "./types.js";
