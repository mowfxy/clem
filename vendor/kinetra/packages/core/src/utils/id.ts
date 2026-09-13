import { randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function newPrefixedId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
