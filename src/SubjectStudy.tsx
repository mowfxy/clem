import { useEffect, useMemo, useState } from "react";
import { confirmDialog } from "./dialogs";
import type { CardState, StudySet } from "../core/types";
import { review, previews, isDue, isWeak, type Grade } from "../core/srs";
import { Icon } from "./Icons";
import { Illustration } from "./Illustrations";
import { EmptyState } from "./ui/Calm";

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
    .filter((c) => c.state && isWeak(c.state))
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
  sets, onGenerate, onUpdate, onDelete, onImport, kind, autoStart = 0,
}: {
  /** Import cards from Anki or Quizlet (flashcards only). */
  onImport?: () => void;
  /** Shows one kind of set only (the subject page's Flashcards and Quizzes tabs). */
  kind?: "quiz" | "flashcards";
  /** Changing this number starts a review session, e.g. from the subject overview. */
  autoStart?: number;
  sets: StudySet[];
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
  const weak = weakConcepts(sets);
  const current = sets.find((s) => s.id === selected);
  const card = session?.[0];

  // Cards fall due as time passes (missed ones come back within minutes), so the count keeps up while the page is open.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { if (session && !card) setNow(Date.now()); }, [session, card]);
  function start() {
    const at = Date.now();
    setNow(at);
    const due = all.filter((c) => c.state?.reps && isDue(c.state, at));
    const queue = [...due.sort((a, b) => a.state!.due - b.state!.due), ...fresh.slice(0, NEW_PER_SESSION)];
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
      if ((e.target as HTMLElement).closest("input,textarea") || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) { e.preventDefault(); setRevealed(true); }
      else if (revealed && ["1", "2", "3", "4"].includes(e.key)) grade(Number(e.key) as Grade);
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [card, revealed]);

  useEffect(() => { if (autoStart && (due.length || fresh.length)) start(); }, [autoStart]);
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
            <p>{reviewed} {reviewed === 1 ? "card" : "cards"} reviewed. Each comes back just before you’d forget it.</p>
          </div>
        )}
      </section>
    );
  }

  const toReview = Math.min(due.length + fresh.length, due.length + NEW_PER_SESSION);
  const make = kind === "quiz" ? "quiz" : "flashcards";
  return (
    <section className={`subject-study ${kind ? "is-" + kind : ""}`}>
      {/* Flashcards lead with one thing to do: review what is due. */}
      {kind !== "quiz" && all.length > 0 && !current && (
        <div className="study-hero">
          <Illustration scene="cards" viewBox="110 60 260 260" className="study-hero-art" />
          <b>{toReview ? `${toReview} to review` : "All caught up"}</b>
          <button type="button" className="primary" disabled={!toReview} onClick={start}>Review<Icon name="arrow" size={15} /></button>
        </div>
      )}
      {current ? (
        <div className="quiz-run">
          <button type="button" className="study-back" onClick={() => { setSelected(null); setAnswers({}); setChecked(false); }}><Icon name="arrow" size={15} />Back</button>
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
        sets.length ? (
          <div className="study-sets">
            {sets.map((s) => {
              const last = s.attempts.at(-1);
              const open = s.kind === "quiz" ? () => setSelected(s.id) : undefined;
              return (
                <article className="study-item" key={s.id}>
                  <button type="button" className="study-item-open" onClick={open} disabled={!open}>
                    <strong>{s.title}</strong>
                    <small>{s.items.length} {s.kind === "quiz" ? (s.items.length === 1 ? "question" : "questions") : (s.items.length === 1 ? "card" : "cards")}{last ? ` · ${last.correct}/${last.total}` : ""}</small>
                  </button>
                  <button type="button" className="icon-button" aria-label={`Delete ${s.title}`} onClick={async () => { if (await confirmDialog({ title: `Delete ${s.title}?`, message: "This study set and its review history are removed.", confirm: "Delete", danger: true })) onDelete(s.id); }}><Icon name="trash" size={15} /></button>
                </article>
              );
            })}
            <button type="button" className="study-new" onClick={() => onGenerate(make)}><Icon name="plus" size={16} />New</button>
            {onImport && <button type="button" className="study-new" onClick={onImport}><Icon name="import" size={16} />Import</button>}
          </div>
        ) : (
          <EmptyState scene={kind === "quiz" ? "checklist" : "cards"} line={kind === "quiz" ? "No quizzes yet." : "No cards yet."}>
            <button type="button" className="primary" onClick={() => onGenerate(make)}>{kind === "quiz" ? "Make a quiz" : "Make flashcards"}</button>
            {onImport && <button type="button" className="secondary" onClick={onImport}>Import from Anki or Quizlet</button>}
          </EmptyState>
        )
      )}
    </section>
  );
}
