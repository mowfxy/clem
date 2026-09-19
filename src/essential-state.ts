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
  };
}
export function applyEssentials(
  state: State,
  result: { skills: Skill[]; notes: { id: string; text: string }[] },
): State {
  return {
    ...state,
    skills: result.skills,
    essentialNotes: result.notes,
    memory: result.notes.find((n) => n.id === "personal")?.text || "",
    spaces: state.spaces.map((s) => ({
      ...s,
      memory: result.notes.find((n) => n.id === s.id)?.text || "",
    })),
  };
}
