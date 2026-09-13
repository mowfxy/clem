/**
 * Provider router.
 *
 * Holds a registry of provider adapters by kind. Picks the active adapter
 * based on configuration and exposes a uniform generate() entry point.
 * Falls back to the mock adapter when no real provider is configured so
 * the system remains usable offline.
 */

import { mockAdapter } from "./mock.js";
import type {
  GenerateRequest,
  GenerateResponse,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderKind,
} from "./types.js";
import { ProviderError } from "./types.js";

export interface RouterConfig {
  /** Preferred provider kind. If the adapter is not registered, the router falls back. */
  preferred: ProviderKind;
  /** Default model id for the preferred provider. */
  defaultModel?: string;
}

export class ProviderRouter {
  private registry = new Map<ProviderKind, ProviderAdapter>();
  private cfg: RouterConfig;
  private activeOverride: ProviderKind | null = null;

  constructor(cfg: RouterConfig) {
    this.cfg = cfg;
    this.register(mockAdapter); // always available
  }

  register(adapter: ProviderAdapter): void {
    this.registry.set(adapter.kind, adapter);
  }

  setPreferred(kind: ProviderKind): void {
    if (!this.registry.has(kind)) {
      throw new ProviderError(`Provider not registered: ${kind}`, { kind });
    }
    this.cfg = { ...this.cfg, preferred: kind };
    this.activeOverride = null;
  }

  overrideActive(kind: ProviderKind | null): void {
    if (kind !== null && !this.registry.has(kind)) {
      throw new ProviderError(`Provider not registered: ${kind}`, { kind });
    }
    this.activeOverride = kind;
  }

  active(): ProviderAdapter {
    const kind = this.activeOverride ?? this.cfg.preferred;
    const adapter = this.registry.get(kind) ?? this.registry.get("mock");
    if (!adapter) {
      throw new ProviderError("No provider available", { preferred: kind });
    }
    return adapter;
  }

  activeKind(): ProviderKind {
    return this.active().kind;
  }

  capabilities(): ProviderCapabilities {
    return this.active().capabilities;
  }

  has(kind: ProviderKind): boolean {
    return this.registry.has(kind);
  }

  kinds(): ProviderKind[] {
    return [...this.registry.keys()];
  }

  async generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResponse> {
    const a = this.active();
    return a.generate(req, signal);
  }

  async embed(input: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    const a = this.active();
    if (!a.embed) {
      throw new ProviderError(`Provider ${a.kind} has no embed() method`, { kind: a.kind });
    }
    return a.embed(input, signal);
  }
}

export function defaultRouter(): ProviderRouter {
  return new ProviderRouter({ preferred: "mock" });
}
