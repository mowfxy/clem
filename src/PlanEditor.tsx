import { useState, useRef, useEffect } from "react";
import type { Model, Plan, Subtask } from "../core/types";
import { validatePlan } from "../core/orchestration";
import { Icon } from "./Icons";
import { ModelSelector } from "./ModelSelector";

/** A Long Task as one quiet card: steps tick off in place, details open on demand. */
export function PlanEditor({
  plan,
  models,
  onChange,
  onRun,
  running,
  onStop,
}: {
  plan: Plan;
  models: Model[];
  onChange: (p: Plan) => void;
  onRun: () => void;
  running: boolean;
  onStop: () => void;
}) {
  const [error, setError] = useState(""),
    [open, setOpen] = useState<string | null>(null),
    [editing, setEditing] = useState<{ index: number; task: Subtask } | null>(null),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (editing) dialog.current?.showModal();
  }, [editing?.index]);
  const edit = (i: number, changes: Partial<Subtask>) =>
    onChange({
      ...plan,
      approved: false,
      revision: plan.revision + 1,
      tasks: plan.tasks.map((t, j) =>
        j >= i ? { ...t, ...(j === i ? changes : {}), status: "pending", result: undefined } : t,
      ),
    });
  const done = plan.tasks.filter((t) => t.status === "complete").length;
  const active = running && plan.approved;
  const reviewing = !plan.approved && !plan.tasks.some((t) => t.status === "complete");
  const finished = done === plan.tasks.length;
  const progress = plan.tasks.length ? (done + (plan.tasks.some((t) => t.status === "running") ? 0.5 : 0)) / plan.tasks.length : 0;
  const modelName = (id: string) => models.find((m) => m.id === id)?.name || id.replace(/^claude:/, "Claude ").replace(/^antigravity:/, "");
  return (
    <section className={`plan-card ${reviewing ? "reviewing" : ""} ${active ? "active" : ""} ${finished ? "finished" : ""}`} aria-label="Long task">
      <header className="plan-card-head">
        <Icon name="long" size={17} />
        <strong>Task</strong>
        <span className="plan-count">{reviewing ? `${plan.tasks.length} steps` : `${done} of ${plan.tasks.length}`}</span>
        <span className="plan-progress" role="progressbar" aria-label="Task progress" aria-valuemin={0} aria-valuemax={plan.tasks.length} aria-valuenow={done}>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </span>
      </header>
      <ol className="plan-steps">
        {plan.tasks.map((t, i) => {
          const expanded = open === t.id;
          return (
            <li key={t.id} className={`plan-step ${t.status} ${expanded ? "open" : ""}`}>
              <div className="plan-step-row" onClick={(e) => { if (!(e.target as HTMLElement).closest(".model-selector,button")) setOpen(expanded ? null : t.id); }}>
                <span className="plan-check" aria-label={t.status === "complete" ? "Done" : t.status === "running" ? "Working" : t.status === "failed" ? "Stopped" : "Waiting"} />
                <h3>{t.title}</h3>
                {reviewing ? (
                  <ModelSelector
                    models={models}
                    value={t.model}
                    effort={t.reasoning}
                    disabled={running}
                    onChange={(model) => edit(i, { model, reasoning: models.find((m) => m.id === model)?.defaultReasoningEffort })}
                    onEffort={(reasoning) => edit(i, { reasoning })}
                    onConnect={() => (location.hash = "/app/settings")}
                  />
                ) : (
                  <small className="plan-step-model">{t.status === "running" ? "Working…" : modelName(t.model)}</small>
                )}
                <button type="button" className="plan-expand" aria-label={`${expanded ? "Hide" : "Show"} details for step ${i + 1}`} aria-expanded={expanded} onClick={() => setOpen(expanded ? null : t.id)}>
                  <Icon name="down" size={13} />
                </button>
              </div>
              {expanded && (
                <div className="plan-step-detail">
                  <p>{t.instructions}</p>
                  <p className="plan-step-output">Produces · {t.output}</p>
                  <small>{t.dependsOn.length ? `Builds on ${t.dependsOn.map((d) => "step " + d.replace("step-", "")).join(", ")}` : "Uses your request and selected context"}</small>
                  {t.result && (
                    <details>
                      <summary>View output</summary>
                      <p className="preserve">{t.result}</p>
                    </details>
                  )}
                </div>
              )}
              {reviewing && (
                <button type="button" className="plan-edit" aria-label={`Edit step ${i + 1}`} disabled={running} onClick={() => setEditing({ index: i, task: { ...t } })}>
                  <Icon name="new" size={15} />
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {error && <p className="plan-error" role="alert">{error}</p>}
      {(reviewing || active || !finished || !plan.approved) && (
        <footer className="plan-card-foot">
          <span>{active ? "Completed steps are saved as they finish." : reviewing ? "Nothing runs until you approve." : finished ? "All steps are done." : "Pick up where it stopped."}</span>
          {active ? (
            <button onClick={onStop}>Stop</button>
          ) : (
            <button
              className="primary"
              onClick={() => {
                try {
                  validatePlan(plan, models);
                  setError("");
                  onRun();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {finished ? "Show saved result" : done ? "Resume" : "Approve & run"}
              <Icon name="arrow" size={16} />
            </button>
          )}
        </footer>
      )}
      {editing && (
        <dialog ref={dialog} className="settings-dialog" aria-label="Edit task step" onCancel={() => setEditing(null)}>
          <header>
            <h2>Edit step {editing.index + 1}</h2>
            <button type="button" aria-label="Close step editor" onClick={() => setEditing(null)}>×</button>
          </header>
          <form
            className="settings-dialog-body"
            onSubmit={(e) => {
              e.preventDefault();
              edit(editing.index, editing.task);
              setEditing(null);
            }}
          >
            <label>
              Title
              <input required maxLength={150} value={editing.task.title} onChange={(e) => setEditing({ ...editing, task: { ...editing.task, title: e.target.value } })} />
            </label>
            <label>
              Instructions
              <textarea required aria-label="Instructions" rows={6} maxLength={8000} value={editing.task.instructions} onChange={(e) => setEditing({ ...editing, task: { ...editing.task, instructions: e.target.value } })} />
            </label>
            <label>
              Expected output
              <textarea required aria-label="Expected output" rows={3} maxLength={2000} value={editing.task.output} onChange={(e) => setEditing({ ...editing, task: { ...editing.task, output: e.target.value } })} />
            </label>
            <button type="button" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" className="primary">Save changes</button>
          </form>
        </dialog>
      )}
    </section>
  );
}
