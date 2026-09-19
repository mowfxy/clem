import type { Plan } from "./types";
export type WorkflowCheckpoint = {
  signature: string;
  tasks: Plan["tasks"];
  updatedAt: number;
};
export async function workflowSignature(plan: Plan, context: string) {
  const definitions = plan.tasks.map(
    ({ id, title, instructions, output, model, dependsOn }) => ({
      id,
      title,
      instructions,
      output,
      model,
      dependsOn,
    }),
  );
  const bytes = new TextEncoder().encode(
    JSON.stringify({ goal: plan.goal, definitions, context }),
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export function resumeWorkflow(
  plan: Plan,
  signature: string,
  checkpoint?: WorkflowCheckpoint,
): Plan {
  const reusable = checkpoint?.signature === signature;
  const completed = new Set<string>();
  return {
    ...plan,
    tasks: plan.tasks.map((task) => {
      const saved = reusable
        ? checkpoint.tasks.find((t) => t.id === task.id)
        : undefined;
      if (
        saved?.status === "complete" &&
        saved.result &&
        task.dependsOn.every((id) => completed.has(id))
      ) {
        completed.add(task.id);
        return { ...task, status: "complete", result: saved.result };
      }
      return { ...task, status: "pending", result: undefined };
    }),
  };
}
