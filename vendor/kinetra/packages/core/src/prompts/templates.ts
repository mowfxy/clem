/**
 * Prompt templates.
 *
 * The orchestrator and skills compose prompts from small, named fragments.
 * Keeping them in one place makes the system auditable and lets us
 * regression-test for accidental prompt drift.
 */

import { KinetraError } from "../errors.js";

export type PromptName =
  | "tutor.ask"
  | "tutor.explain"
  | "tutor.hint"
  | "research.search"
  | "research.summarize"
  | "exam.generate"
  | "exam.grade"
  | "flashcards.generate"
  | "study-plan.build";

export interface PromptContext {
  topic: string;
  course?: string;
  sources?: string;
  history?: string;
  studentLevel?: "intro" | "undergrad" | "grad";
}

export interface PromptTemplate {
  name: PromptName;
  system: string;
  build: (ctx: PromptContext) => string;
}

const SYSTEM_TUTOR = `You are Kinetra, a careful technical tutor. You always
ground answers in the supplied sources. You cite them inline using [n]
notation. You do not invent equations or numeric results. If you are
unsure, say so explicitly.`;

const SYSTEM_RESEARCH = `You are Kinetra, a technical research assistant.
Summarize from the supplied sources only. Do not introduce external facts.
Always preserve citations.`;

const SYSTEM_EXAM_GEN = `You are an exam author. Produce questions that are
clear, unambiguous, and unambiguously answerable from the source material.
Use only standard notation.`;

const SYSTEM_GRADER = `You are a strict but fair grader. Compare the
student answer to the model solution and the source excerpts. Award
partial credit explicitly. Output a JSON object with keys: score, feedback,
citation.`;

export const TEMPLATES: Record<PromptName, PromptTemplate> = {
  "tutor.ask": {
    name: "tutor.ask",
    system: SYSTEM_TUTOR,
    build: (c) =>
      `Topic: ${c.topic}\nCourse: ${c.course ?? "(unspecified)"}\n` +
      (c.history ? `Recent history:\n${c.history}\n` : "") +
      (c.sources ? `Sources:\n${c.sources}\n` : "") +
      `\nAnswer the student's question. Cite sources as [n].`,
  },
  "tutor.explain": {
    name: "tutor.explain",
    system: SYSTEM_TUTOR,
    build: (c) =>
      `Explain "${c.topic}" at a ${c.studentLevel ?? "undergrad"} level.\n` +
      (c.sources ? `Ground the explanation in:\n${c.sources}\n` : ""),
  },
  "tutor.hint": {
    name: "tutor.hint",
    system: SYSTEM_TUTOR,
    build: (c) =>
      `Provide a single short hint for "${c.topic}" without revealing the answer. ` +
      `If the student has already had ${"${0}"} hints, give a stronger nudge.`,
  },
  "research.search": {
    name: "research.search",
    system: SYSTEM_RESEARCH,
    build: (c) =>
      `Find the most relevant passages on: ${c.topic}\n` +
      (c.sources ? `Restrict to:\n${c.sources}` : "Use any available source."),
  },
  "research.summarize": {
    name: "research.summarize",
    system: SYSTEM_RESEARCH,
    build: (c) =>
      `Summarize the supplied excerpts on ${c.topic}. Keep every citation.`,
  },
  "exam.generate": {
    name: "exam.generate",
    system: SYSTEM_EXAM_GEN,
    build: (c) =>
      `Generate 5 questions of mixed difficulty on ${c.topic}.\n` +
      `Include a model answer and a citation for each.\n` +
      (c.sources ? `Source corpus:\n${c.sources}` : ""),
  },
  "exam.grade": {
    name: "exam.grade",
    system: SYSTEM_GRADER,
    build: (c) =>
      `Topic: ${c.topic}\nModel solution:\n${c.sources ?? "(none provided)"}\n` +
      `Student answer:\n${c.history ?? "(empty)"}\nGrade it.`,
  },
  "flashcards.generate": {
    name: "flashcards.generate",
    system: SYSTEM_TUTOR,
    build: (c) =>
      `Generate 10 flashcards on ${c.topic}. Each card: front (a question) and back (a precise answer).`,
  },
  "study-plan.build": {
    name: "study-plan.build",
    system: SYSTEM_TUTOR,
    build: (c) =>
      `Build a 2-week study plan covering ${c.topic}. Weight topics by the student's weakest areas.`,
  },
};

export function getTemplate(name: PromptName): PromptTemplate {
  const t = TEMPLATES[name];
  if (!t) throw new KinetraError("validation", `Unknown prompt template: ${name}`, { name });
  return t;
}

export function render(name: PromptName, ctx: PromptContext): { system: string; user: string } {
  const t = getTemplate(name);
  return { system: t.system, user: t.build(ctx) };
}
