import { get, set } from "idb-keyval";
import type { Plan } from "../core/types";
import {
  resumeWorkflow,
  workflowSignature,
  type WorkflowCheckpoint,
} from "../core/workflow-checkpoint";
export async function openWorkflow(owner: string, plan: Plan, context: string) {
  const key = `mowr-workflow:${owner}:${plan.id}`;
  const signature = await workflowSignature(plan, context);
  const restored = resumeWorkflow(
    plan,
    signature,
    await get<WorkflowCheckpoint>(key),
  );
  return {
    plan: restored,
    save: (current: Plan) =>
      set(key, {
        signature,
        tasks: current.tasks,
        updatedAt: Date.now(),
      } satisfies WorkflowCheckpoint),
  };
}
