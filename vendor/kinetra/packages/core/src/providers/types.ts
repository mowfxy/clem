/**
 * AI provider abstraction.
 *
 * Kinetra does not depend on any specific AI vendor. The provider layer
 * defines a small capability surface (text, vision, tool calling, structured
 * output, context size) and a minimal generate contract. Concrete adapters
 * live in their own packages.
 */

import type { SourceRef } from "../types.js";
import { KinetraError } from "../errors.js";

export type ProviderKind =
  | "mock"
  | "openai"
  | "anthropic"
  | "gemini"
  | "ollama"
  | "lmstudio"
  | "openai-compatible";

export interface ProviderCapabilities {
  text: boolean;
  vision: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  contextTokens: number;
  supportsJson: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface GenerateRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  jsonSchema?: Record<string, unknown>;
  tools?: ToolSpec[];
}

export interface GenerateResponse {
  text: string;
  toolCalls?: ToolCall[];
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  model: string;
  finishReason?: "stop" | "length" | "tool" | "error";
  raw?: unknown;
}

export interface ProviderAdapter {
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;
  generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResponse>;
  embed?(input: string[], signal?: AbortSignal): Promise<Float32Array[]>;
}

export class ProviderError extends KinetraError {
  constructor(message: string, detail: Record<string, unknown> = {}) {
    super("provider", message, detail);
    this.name = "ProviderError";
  }
}

export function supportsFeature(
  cap: ProviderCapabilities,
  feature: "vision" | "toolCalling" | "structuredOutput",
): boolean {
  return cap[feature] === true;
}

/**
 * Build a prompt fragment that grounds the model in retrieved source material
 * with explicit, machine-readable citations.
 */
export function buildContext(
  sources: SourceRef[],
  excerpt: string,
): string {
  if (sources.length === 0) return excerpt;
  const citations = sources
    .map((s, i) => `[${i + 1}] ${s.title ?? s.sourceId}${typeof s.page === "number" ? ` (p. ${s.page})` : ""}`)
    .join("; ");
  return `Sources: ${citations}\n\n${excerpt}`;
}

/**
 * Lightweight deterministic JSON-mode coercion. Providers that cannot truly
 * enforce JSON-mode can use this helper to massage the model output. The
 * result is never trusted blindly: callers must validate against a schema.
 */
export function extractJson<T>(text: string): T {
  // Match first balanced JSON object or array. Tolerates markdown fences.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const startObj = candidate.indexOf("{");
  const startArr = candidate.indexOf("[");
  let start = -1;
  let end = -1;
  if (startObj === -1) {
    start = startArr;
  } else if (startArr === -1) {
    start = startObj;
  } else {
    start = Math.min(startObj, startArr);
  }
  if (start === -1) {
    throw new ProviderError("Could not locate JSON in provider response", { len: text.length });
  }
  const open = candidate[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) {
    throw new ProviderError("Unbalanced JSON in provider response", { start });
  }
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice) as T;
  } catch (e) {
    throw new ProviderError("JSON parse failed", { error: (e as Error).message });
  }
}
