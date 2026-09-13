/**
 * Artifact repository helpers.
 *
 * Bridges the Artifact data model with the persistent SQLite store and the
 * in-memory workspace. The store API is defined in `store/artifacts.ts`;
 * this module exists so plugin and CLI code can call a single ergonomic
 * surface.
 */

import { KinetraError } from "../errors.js";
import type { ArtifactBase, ArtifactKind } from "../artifacts.js";
import { validateArtifact, hashArtifact } from "../artifacts.js";
import { Workspace } from "./workspace.js";

export interface ArtifactSaveResult {
  artifactId: string;
  contentHash: string;
  duplicate: boolean;
}

export interface ArtifactStoreLike {
  upsert(a: ArtifactBase<ArtifactKind, unknown>): { duplicate: boolean };
  remove(id: string): boolean;
  byKind(kind: ArtifactKind, courseId?: string): ArtifactBase<ArtifactKind, unknown>[];
}

export class ArtifactRepository {
  private _store: ArtifactStoreLike;
  constructor(store: ArtifactStoreLike) { this._store = store; }

  save(
    a: ArtifactBase<ArtifactKind, unknown>,
    courseId: string,
    topicId?: string,
    workspace?: Workspace,
  ): ArtifactSaveResult {
    validateArtifact(a);
    const result = this._store.upsert(a);
    const hash = hashArtifact(a);
    if (workspace) {
      workspace.addArtifact(a, { courseId, topicId });
    }
    return { artifactId: a.id, contentHash: hash, duplicate: result.duplicate };
  }

  remove(id: string, workspace?: Workspace): boolean {
    const removed = this._store.remove(id);
    if (workspace) {
      const entries = workspace.list().filter((e) => e.artifactId === id);
      for (const e of entries) workspace.remove(e.entryId);
    }
    return removed;
  }

  byKind(kind: ArtifactKind, courseId?: string): ArtifactBase<ArtifactKind, unknown>[] {
    return this._store.byKind(kind, courseId);
  }

  byCourse(courseId: string): ArtifactBase<ArtifactKind, unknown>[] {
    return this._store.byKind("document", courseId);
  }
}

export function findArtifact<T extends ArtifactBase<ArtifactKind, unknown>>(
  artifacts: ArtifactBase<ArtifactKind, unknown>[],
  id: string,
): T {
  const a = artifacts.find((x) => x.id === id);
  if (!a) throw new KinetraError("missing", `Artifact not found: ${id}`);
  return a as T;
}
