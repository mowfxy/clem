import type { State } from "./store";
import type { Skill } from "../core/types";
export function essentials(state: State) {
  const notes = new Map((state.essentialNotes || []).map((n) => [n.id, n]));
  notes.set("personal", { id: "personal", text: state.memory });
  for (const space of state.spaces)
    notes.set(space.id, { id: space.id, text: space.memory });
  return {
    skills: state.skills
      .filter((s) => !s.builtin)
      .map((s) => ({ ...s, builtin: false as const })),
    notes: [...notes.values()].filter((n) => n.text.trim()),
    ...(state.essentialsUnsynced ? { noBaseline: true } : {}),
  };
}
export function applyEssentials(
  state: State,
  result: { skills: Skill[]; notes: { id: string; text: string }[]; error?: string },
): State {
  // A failed sync hands back what it was given: the workspace still has not met the cloud's copy.
  const { essentialsUnsynced, ...settled } = state;
  return {
    ...(result.error ? state : settled),
    skills: result.skills,
    essentialNotes: result.notes,
    memory: result.notes.find((n) => n.id === "personal")?.text || "",
    spaces: state.spaces.map((s) => ({
      ...s,
      memory: result.notes.find((n) => n.id === s.id)?.text || "",
    })),
  };
}
