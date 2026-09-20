import { useState } from "react";
import type { StudySet } from "../core/types";
export function SubjectStudy({
  sets,
  onGenerate,
  onUpdate,
  onDelete,
}: {
  sets: StudySet[];
  onGenerate: (kind: "quiz" | "flashcards") => void;
  onUpdate: (set: StudySet) => void;
  onDelete: (id: string) => void;
}) {
  const [tab, setTab] = useState<"quiz" | "flashcards">("quiz"),
    [selected, setSelected] = useState<string | null>(null),
    [answers, setAnswers] = useState<Record<number, number>>({}),
    [revealed, setRevealed] = useState<Record<number, boolean>>({}),
    [checked, setChecked] = useState(false);
  const current = sets.find((s) => s.id === selected);
  const reset = () => {
    setSelected(null);
    setAnswers({});
    setRevealed({});
    setChecked(false);
  };
  return (
    <section className="subject-study">
      <h3>Study collection</h3>
      <div
        className="study-tabs"
        role="group"
        aria-label="Study collection type"
      >
        {(["quiz", "flashcards"] as const).map((t) => (
          <button
            key={t}
            aria-pressed={tab === t}
            onClick={() => {
              setTab(t);
              reset();
            }}
          >
            {t === "quiz" ? "Quizzes" : "Flashcards"}
          </button>
        ))}
        <button onClick={() => onGenerate(tab)}>
          Create {tab === "quiz" ? "quiz" : "flashcards"}
        </button>
      </div>
      {current ? (
        <>
          <button onClick={reset}>Back to collection</button>
          <h3>{current.title}</h3>
          {current.items.map((item, i) => (
            <article className="study-card" key={i}>
              <p>
                <span className="fine">
                  {i + 1} / {current.items.length}
                </span>
              </p>
              <h4>{item.question}</h4>
              {current.kind === "quiz" ? (
                <>
                  {item.choices?.map((choice, n) => (
                    <label key={n}>
                      <input
                        type="radio"
                        name={"answer-" + i}
                        checked={answers[i] === n}
                        disabled={checked}
                        onChange={() => setAnswers({ ...answers, [i]: n })}
                      />
                      {choice}
                    </label>
                  ))}
                  {checked && (
                    <p>
                      {answers[i] === item.correct
                        ? "Correct."
                        : "Correct answer: " +
                          item.choices?.[item.correct!] +
                          "."}{" "}
                      {item.answer}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <button
                    aria-expanded={!!revealed[i]}
                    onClick={() =>
                      setRevealed({ ...revealed, [i]: !revealed[i] })
                    }
                  >
                    {revealed[i] ? "Hide answer" : "Reveal answer"}
                  </button>
                  {revealed[i] && <p>{item.answer}</p>}
                </>
              )}
            </article>
          ))}
          {current.kind === "quiz" && (
            <button
              disabled={
                checked || Object.keys(answers).length !== current.items.length
              }
              onClick={() => {
                setChecked(true);
                onUpdate({
                  ...current,
                  attempts: [
                    ...current.attempts,
                    {
                      at: Date.now(),
                      correct: current.items.filter(
                        (x, i) => x.correct === answers[i],
                      ).length,
                      total: current.items.length,
                    },
                  ],
                });
              }}
            >
              {checked ? "Attempt saved" : "Check answers"}
            </button>
          )}
          {checked && (
            <button
              onClick={() => {
                setAnswers({});
                setChecked(false);
              }}
            >
              Try again
            </button>
          )}
        </>
      ) : (
        <>
          {sets
            .filter((s) => s.kind === tab)
            .map((s) => (
              <article className="study-item" key={s.id}>
                <button onClick={() => setSelected(s.id)}>{s.title}</button>
                <p>
                  {s.items.length} {tab === "quiz" ? "questions" : "cards"} ·{" "}
                  {new Date(s.created).toLocaleDateString()}
                  {s.attempts.length
                    ? " · Last score " +
                      s.attempts.at(-1)!.correct +
                      "/" +
                      s.attempts.at(-1)!.total
                    : ""}
                </p>
                <button
                  onClick={() => {
                    if (confirm("Delete this study set?")) onDelete(s.id);
                  }}
                >
                  Delete
                </button>
              </article>
            ))}
          {!sets.some((s) => s.kind === tab) && (
            <p className="fine">
              Create a set here, or ask for{" "}
              {tab === "quiz" ? "a quiz" : "flashcards"} in a subject chat. It
              will be saved here.
            </p>
          )}
        </>
      )}
    </section>
  );
}
