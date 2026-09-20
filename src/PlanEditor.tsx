import { useState, useRef, useEffect } from "react";
import type { Model, Plan, Subtask } from "../core/types";
import { validatePlan } from "../core/orchestration";
import { Icon } from "./Icons";
import { ModelSelector } from "./ModelSelector";
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
    [editing, setEditing] = useState<{ index: number; task: Subtask } | null>(
      null,
    ),
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
        j >= i
          ? {
              ...t,
              ...(j === i ? changes : {}),
              status: "pending",
              result: undefined,
            }
          : t,
      ),
    });
  return (
    <section className="plan-editor">
      <div className="plan-title">
        <Icon name="long" size={28} />
        <div>
          <h2>A plan for your task.</h2>
          <p>Review each step, then choose a model.</p>
        </div>
      </div>
      <div className="plan-meta">
        <span>{plan.tasks.length} steps · Review before running</span>
      </div>
      <ol className="plan-steps">
        {plan.tasks.map((t, i) => (
          <li key={t.id}>
            <div className={`step-number ${t.status}`}>
              {t.status === "complete" ? (
                <Icon name="check" size={17} />
              ) : (
                i + 1
              )}
            </div>
            <div className="step-body">
              <div className="step-head">
                <h3>{t.title}</h3>
                <ModelSelector
                  models={models}
                  value={t.model}
                  effort={t.reasoning}
                  disabled={running}
                  onChange={(model) =>
                    edit(i, {
                      model,
                      reasoning: models.find((m) => m.id === model)
                        ?.defaultReasoningEffort,
                    })
                  }
                  onEffort={(reasoning) => edit(i, { reasoning })}
                  onConnect={() => (location.hash = "/app/settings")}
                />
              </div>
              <div className="step-instructions">
                <p>{t.instructions}</p>
                <button
                  type="button"
                  aria-label={`Edit step ${i + 1}`}
                  disabled={running}
                  onClick={() => setEditing({ index: i, task: { ...t } })}
                >
                  <Icon name="new" size={17} />
                </button>
              </div>
              <p className="step-output">Output · {t.output}</p>
              <small>
                {t.dependsOn.length
                  ? `Uses ${t.dependsOn.join(", ")}`
                  : "Uses your request and selected context"}{" "}
                · {t.status}
              </small>
              {t.result && (
                <details>
                  <summary>View output</summary>
                  <p className="preserve">{t.result}</p>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
      {error && <p role="alert">{error}</p>}
      <div className="plan-bottom">
        <span>Nothing runs until you approve.</span>
        {running ? (
          <button onClick={onStop}>Stop execution</button>
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
            {plan.tasks.every((t) => t.status === "complete")
              ? "Show saved result"
              : plan.tasks.some((t) => t.status === "complete")
                ? "Resume workflow"
                : "Approve & run"}
            <Icon name="arrow" size={18} />
          </button>
        )}
      </div>
      {editing && (
        <dialog
          ref={dialog}
          className="settings-dialog"
          aria-label="Edit task step"
          onCancel={() => setEditing(null)}
        >
          <header>
            <h2>Edit step {editing.index + 1}</h2>
            <button
              type="button"
              aria-label="Close step editor"
              onClick={() => setEditing(null)}
            >
              ×
            </button>
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
              <input
                required
                maxLength={150}
                value={editing.task.title}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    task: { ...editing.task, title: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Instructions
              <textarea
                required
                aria-label="Instructions"
                rows={6}
                maxLength={8000}
                value={editing.task.instructions}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    task: { ...editing.task, instructions: e.target.value },
                  })
                }
              />
            </label>
            <label>
              Expected output
              <textarea
                required
                aria-label="Expected output"
                rows={3}
                maxLength={2000}
                value={editing.task.output}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    task: { ...editing.task, output: e.target.value },
                  })
                }
              />
            </label>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button type="submit" className="primary">
              Save changes
            </button>
          </form>
        </dialog>
      )}
    </section>
  );
}
