import { useEffect, useMemo, useState } from "react";
import type { CardState, StudySet } from "../core/types";
import { review, previews, isDue, examPace, type Grade } from "../core/srs";
import { Icon } from "./Icons";

type Card = { set: StudySet; index: number; question: string; answer: string; state?: CardState };
const NEW_PER_SESSION = 20;

const cardsOf = (sets: StudySet[]): Card[] =>
  sets.flatMap((set) => set.items.map((item, index) => ({
    set, index, question: item.question,
    answer: set.kind === "quiz" && item.choices && item.correct !== undefined ? `${item.choices[item.correct]}. ${item.answer}` : item.answer,
    state: set.cards?.[index] || undefined,
  })));

/** Questions the learner keeps getting wrong, used to steer explanations in subject chats. */
export function weakConcepts(sets: StudySet[]) {
  return cardsOf(sets)
    .filter((c) => c.state && (c.state.lapses >= 2 || (c.state.lapses >= 1 && c.state.difficulty > 7)))
    .sort((a, b) => b.state!.lapses - a.state!.lapses || b.state!.difficulty - a.state!.difficulty)
    .slice(0, 6)
    .map((c) => c.question.slice(0, 160));
}

function withCard(set: StudySet, index: number, state: CardState): StudySet {
  const cards = Array.from({ length: set.items.length }, (_, i) => set.cards?.[i] ?? null);
  cards[index] = state;
  return { ...set, cards };
}

export function SubjectStudy({
  sets, examDate, onExamDate, onGenerate, onUpdate, onDelete,
}: {
  sets: StudySet[];
  examDate?: string;
  onExamDate: (date: string | undefined) => void;
  onGenerate: (kind: "quiz" | "flashcards") => void;
  onUpdate: (set: StudySet) => void;
  onDelete: (id: string) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [session, setSession] = useState<Card[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [checked, setChecked] = useState(false);
  const all = useMemo(() => cardsOf(sets), [sets]);
  const due = all.filter((c) => c.state?.reps && isDue(c.state, now));
  const fresh = all.filter((c) => !c.state?.reps);
  const pace = examPace(all.map((c) => c.state), examDate, now);
  const weak = weakConcepts(sets);
  const current = sets.find((s) => s.id === selected);
  const card = session?.[0];

  function start() {
    setNow(Date.now());
    const queue = [...due.sort((a, b) => a.state!.due - b.state!.due), ...fresh.slice(0, Math.max(NEW_PER_SESSION, pace.perDay ?? 0))];
    setSession(queue); setRevealed(false); setReviewed(0);
  }
  function grade(g: Grade) {
    if (!card) return;
    const set = sets.find((s) => s.id === card.set.id)!;
    const next = review(card.state, g);
    onUpdate(withCard(set, card.index, next));
    setReviewed((n) => n + 1);
    setRevealed(false);
    // Missed cards come back at the end of this session.
    setSession((q) => (q ? [...q.slice(1), ...(g === 1 ? [{ ...card, state: next }] : [])] : q));
  }
  useEffect(() => {
    if (!card) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input,textarea")) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) { e.preventDefault(); setRevealed(true); }
      else if (revealed && ["1", "2", "3", "4"].includes(e.key)) grade(Number(e.key) as Grade);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [card, revealed]);

  if (session) {
    const labels = previews(card?.state);
    return (
      <section className="subject-study review-mode" aria-label="Review">
        <header className="study-review-head">
          <button type="button" className="study-back" onClick={() => setSession(null)}><Icon name="arrow" size={15} />Done</button>
          <span>{card ? `${session.length} left` : "Session complete"}</span>
          <span className="study-bar"><i style={{ width: `${Math.round((reviewed / Math.max(1, reviewed + session.length)) * 100)}%` }} /></span>
        </header>
        {card ? (
          <article className={`review-card ${revealed ? "revealed" : ""}`} key={card.set.id + card.index + reviewed}>
            <small>{card.set.title}{!card.state?.reps ? " · new" : ""}</small>
            <h4>{card.question}</h4>
            {revealed ? <p className="review-answer">{card.answer}</p> : <button type="button" className="review-reveal" onClick={() => setRevealed(true)}>Show answer <kbd>Space</kbd></button>}
            {revealed && (
              <div className="review-grades" role="group" aria-label="How well did you remember?">
                {(["Again", "Hard", "Good", "Easy"] as const).map((label, i) => (
                  <button type="button" key={label} className={`grade-${label.toLowerCase()}`} onClick={() => grade((i + 1) as Grade)}>
                    <span>{label}</span><small>{labels[i]}</small>
                  </button>
                ))}
              </div>
            )}
          </article>
        ) : (
          <div className="review-done">
            <Icon name="check" size={28} />
            <h4>All caught up.</h4>
            <p>{reviewed} {reviewed === 1 ? "card" : "cards"} reviewed. Mowr will bring each one back just before you are likely to forget it.</p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="subject-study">
      <div className="study-overview">
        <div className="study-numbers">
          <div><strong>{due.length}</strong><span>due</span></div>
          <div><strong>{fresh.length}</strong><span>new</span></div>
          <div><strong>{all.length}</strong><span>cards</span></div>
        </div>
        <button type="button" className="primary" disabled={!due.length && !fresh.length} onClick={start}>
          {due.length || fresh.length ? `Review ${Math.min(due.length + fresh.length, due.length + Math.max(NEW_PER_SESSION, pace.perDay ?? 0))}` : "Nothing due"}
          <Icon name="arrow" size={16} />
        </button>
      </div>
      <div className="study-exam">
        <label>
          Exam date
          <input type="date" value={examDate || ""} min={new Date().toISOString().slice(0, 10)} onChange={(e) => onExamDate(e.target.value || undefined)} />
        </label>
        <p>
          {examDate && pace.days !== null
            ? pace.days === 0 ? "Exam day. Review what is due and rest." : `${pace.days} ${pace.days === 1 ? "day" : "days"} to go · about ${pace.perDay} ${pace.perDay === 1 ? "card" : "cards"} a day`
            : "Add a date and Mowr paces new cards so everything is seen in time."}
        </p>
      </div>
      {weak.length > 0 && (
        <div className="study-weak">
          <h4>Keeps slipping</h4>
          <ul>{weak.slice(0, 3).map((q) => <li key={q}>{q}</li>)}</ul>
          <p className="fine">Answers in this subject will connect back to these.</p>
        </div>
      )}
      <div className="study-sets-head">
        <h4>Sets</h4>
        <div>
          <button type="button" onClick={() => onGenerate("flashcards")}>New flashcards</button>
          <button type="button" onClick={() => onGenerate("quiz")}>New quiz</button>
        </div>
      </div>
      {current ? (
        <div className="quiz-run">
          <button type="button" className="study-back" onClick={() => { setSelected(null); setAnswers({}); setChecked(false); }}><Icon name="arrow" size={15} />Back to sets</button>
          <h4>{current.title}</h4>
          {current.items.map((item, i) => (
            <article className="study-card" key={i}>
              <small>{i + 1} / {current.items.length}</small>
              <h5>{item.question}</h5>
              {item.choices?.map((choice, n) => (
                <label key={n} className={checked ? (n === item.correct ? "right" : answers[i] === n ? "wrong" : "") : ""}>
                  <input type="radio" name={"answer-" + i} checked={answers[i] === n} disabled={checked} onChange={() => setAnswers({ ...answers, [i]: n })} />
                  {choice}
                </label>
              ))}
              {checked && <p className="fine">{item.answer}</p>}
            </article>
          ))}
          <div className="quiz-actions">
            {checked ? (
              <button type="button" onClick={() => { setAnswers({}); setChecked(false); }}>Try again</button>
            ) : (
              <button type="button" className="primary" disabled={Object.keys(answers).length !== current.items.length} onClick={() => {
                setChecked(true);
                // A quiz answer counts as a review: right is “Good”, wrong is “Again”.
                let next = current;
                current.items.forEach((item, i) => { next = withCard(next, i, review(next.cards?.[i] || undefined, answers[i] === item.correct ? 3 : 1)); });
                onUpdate({ ...next, attempts: [...current.attempts, { at: Date.now(), correct: current.items.filter((x, i) => x.correct === answers[i]).length, total: current.items.length }] });
              }}>Check answers</button>
            )}
          </div>
        </div>
      ) : (
        <div className="study-sets">
          {sets.map((s) => {
            const last = s.attempts.at(-1), mastered = s.cards?.filter((c) => c && c.stability >= 21).length || 0;
            return (
              <article className="study-item" key={s.id}>
                <Icon name={s.kind === "quiz" ? "check" : "subjects"} size={18} />
                <div>
                  {s.kind === "quiz" ? <button type="button" onClick={() => setSelected(s.id)}>{s.title}</button> : <strong>{s.title}</strong>}
                  <small>{s.items.length} {s.kind === "quiz" ? "questions" : "cards"}{last ? ` · last ${last.correct}/${last.total}` : ""}{mastered ? ` · ${mastered} solid` : ""}</small>
                </div>
                <button type="button" className="icon-button" aria-label={`Delete ${s.title}`} onClick={() => { if (confirm("Delete this study set and its review history?")) onDelete(s.id); }}><Icon name="trash" size={16} /></button>
              </article>
            );
          })}
          {!sets.length && <p className="fine">Ask for flashcards or a quiz in a subject chat, or create one here. Every card joins your review schedule.</p>}
        </div>
      )}
    </section>
  );
}
