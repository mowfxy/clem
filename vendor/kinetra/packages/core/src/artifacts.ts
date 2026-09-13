/**
 * Artifact framework.
 *
 * Every deterministic output in Kinetra is an Artifact: a JSON-serialisable
 * object with a stable schema, a content hash, and a list of derived
 * renderings. Artifacts are the canonical representation shared by the
 * engine, the CLI, the desktop app, and the Codex plugin.
 */

import { sha256 } from "./utils/hash.js";
import { newPrefixedId } from "./utils/id.js";
import { KinetraError } from "./errors.js";

export type ArtifactKind =
  | "kmap"
  | "truth-table"
  | "circuit"
  | "schematic"
  | "logic-schematic"
  | "timing-diagram"
  | "graph"
  | "plot"
  | "scene-2d"
  | "scene-3d"
  | "free-body"
  | "electrostatics"
  | "projectile"
  | "pulley"
  | "optics"
  | "field"
  | "vector-field"
  | "document"
  | "pdf"
  | "exam"
  | "worksheet"
  | "quiz"
  | "flashcards"
  | "lesson"
  | "report";

export interface ArtifactBase<TKind extends ArtifactKind, TModel> {
  id: string;
  kind: TKind;
  title: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  source?: Record<string, unknown>;
  model: TModel;
  renderings: Record<string, ArtifactRendering>;
  tags?: string[];
}

export interface ArtifactRendering {
  format: "svg" | "png" | "pdf" | "json" | "txt" | "md";
  content: string;
  contentType: string;
}

export function createArtifact<TKind extends ArtifactKind, TModel>(
  params: {
    kind: TKind;
    title: string;
    description?: string;
    model: TModel;
    source?: Record<string, unknown>;
    tags?: string[];
  },
): ArtifactBase<TKind, TModel> {
  const now = new Date().toISOString();
  return {
    id: newPrefixedId(params.kind),
    kind: params.kind,
    title: params.title,
    description: params.description,
    createdAt: now,
    updatedAt: now,
    source: params.source,
    model: params.model,
    renderings: {},
    tags: params.tags,
  };
}

export function withRendering<T extends ArtifactBase<ArtifactKind, unknown>>(
  a: T,
  key: string,
  rendering: ArtifactRendering,
): T {
  return { ...a, updatedAt: new Date().toISOString(), renderings: { ...a.renderings, [key]: rendering } };
}

export function hashArtifact(a: ArtifactBase<ArtifactKind, unknown>): string {
  return sha256(JSON.stringify({ kind: a.kind, model: a.model }));
}

export function validateArtifact(a: ArtifactBase<ArtifactKind, unknown>): void {
  if (!a.id) throw new KinetraError("validation", "Artifact missing id", { kind: a.kind });
  if (!a.kind) throw new KinetraError("validation", "Artifact missing kind", { id: a.id });
  if (!a.title) throw new KinetraError("validation", "Artifact missing title", { id: a.id });
  if (a.model == null) throw new KinetraError("validation", "Artifact missing model", { id: a.id });
}

export function serializeArtifact(a: ArtifactBase<ArtifactKind, unknown>): string {
  return JSON.stringify(a, null, 2);
}

export function deserializeArtifact<T extends ArtifactBase<ArtifactKind, unknown>>(raw: string): T {
  const obj = JSON.parse(raw);
  validateArtifact(obj);
  return obj as T;
}
