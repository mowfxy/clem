/**
 * Flashcards.
 *
 * Simple spaced-repetition deck model with a deterministic SM-2-style
 * scheduler. Each card carries a front (prompt) and back (answer) and a
 * per-card state (ease, interval, due date).
 */

import { KinetraError } from "../errors.js";
import { newPrefixedId } from "../utils/id.js";
import type { SourceRef } from "../types.js";

export interface FlashCard {
  id: string;
  front: string;
  back: string;
  topicId?: string;
  source?: SourceRef;
  /** SM-2 ease factor; starts at 2.5 and is clamped >= 1.3. */
  ease: number;
  /** Days until next review after the most recent rating. */
  intervalDays: number;
  /** ISO date when this card is next due. */
  dueAt: string;
  /** Number of consecutive successful reviews. */
  reps: number;
  /** Total reviews. */
  reviews: number;
}

export interface Deck {
  id: string;
  title: string;
  courseId: string;
  topicId?: string;
  createdAt: string;
  cards: FlashCard[];
}

export type ReviewGrade = 0 | 1 | 2 | 3 | 4 | 5;

export function createDeck(seed: {
  title: string;
  courseId: string;
  topicId?: string;
  cards: Array<{ front: string; back: string; topicId?: string; source?: SourceRef }>;
}): Deck {
  if (!seed.title) throw new KinetraError("validation", "Deck title is required");
  if (!seed.courseId) throw new KinetraError("validation", "Deck courseId is required");
  const now = new Date();
  return {
    id: newPrefixedId("deck"),
    title: seed.title,
    courseId: seed.courseId,
    topicId: seed.topicId,
    createdAt: now.toISOString(),
    cards: seed.cards.map((c) => ({
      id: newPrefixedId("card"),
      front: c.front,
      back: c.back,
      topicId: c.topicId ?? seed.topicId,
      source: c.source,
      ease: 2.5,
      intervalDays: 0,
      dueAt: now.toISOString(),
      reps: 0,
      reviews: 0,
    })),
  };
}

/**
 * SM-2 update. grade is 0..5 (0 = total blackout, 5 = perfect).
 * Grades < 3 reset reps and bring the card due today.
 */
export function review(card: FlashCard, grade: ReviewGrade, now: Date = new Date()): FlashCard {
  if (!Number.isInteger(grade) || grade < 0 || grade > 5) {
    throw new KinetraError("validation", "grade must be 0..5", { grade });
  }
  let { ease, intervalDays, reps } = card;
  if (grade < 3) {
    reps = 0;
    intervalDays = 1;
  } else {
    if (reps === 0) intervalDays = 1;
    else if (reps === 1) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * ease);
    reps += 1;
    const q = gradeToQuality(grade);
    ease = Math.max(1.3, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  }
  const due = new Date(now.getTime() + intervalDays * 86400000);
  return { ...card, ease, intervalDays, reps, reviews: card.reviews + 1, dueAt: due.toISOString() };
}

function gradeToQuality(g: ReviewGrade): number {
  if (g <= 1) return 1;
  if (g === 2) return 2;
  if (g === 3) return 3;
  if (g === 4) return 4;
  return 5;
}

export function dueCards(deck: Deck, now: Date = new Date()): FlashCard[] {
  return deck.cards.filter((c) => new Date(c.dueAt).getTime() <= now.getTime());
}

export function applyReviews(deck: Deck, updates: Array<{ cardId: string; grade: ReviewGrade }>, now: Date = new Date()): Deck {
  const idx = new Map(deck.cards.map((c) => [c.id, c]));
  for (const u of updates) {
    const card = idx.get(u.cardId);
    if (!card) throw new KinetraError("missing", `Card not found: ${u.cardId}`);
    idx.set(card.id, review(card, u.grade, now));
  }
  return { ...deck, cards: [...idx.values()] };
}
