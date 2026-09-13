/**
 * Common type aliases used across the core library.
 *
 * Kept in a dedicated file so that downstream consumers can import these
 * primitives without dragging in any concrete module.
 */

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [k: string]: Json };

export interface SourceRef {
  /** Stable identifier of the originating document, e.g. content hash. */
  sourceId: string;
  /** Optional document title as known to the library. */
  title?: string;
  /** 1-based page number when applicable. */
  page?: number;
  /** 0-based section index inside the document. */
  section?: number;
  /** Heading / section title if known. */
  sectionTitle?: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Color {
  /** CSS color string, e.g. "#1f6feb" or "currentColor". */
  value: string;
}

export const BLACK: Color = { value: "#000000" };
export const WHITE: Color = { value: "#ffffff" };
export const GRAY: Color = { value: "#666666" };
export const RED: Color = { value: "#d32f2f" };
export const BLUE: Color = { value: "#1565c0" };
export const GREEN: Color = { value: "#2e7d32" };
export const ORANGE: Color = { value: "#ef6c00" };
export const PURPLE: Color = { value: "#6a1b9a" };

export type Brand<K, T> = K & { readonly __brand: T };
