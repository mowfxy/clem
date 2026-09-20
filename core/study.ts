import { z } from "zod";

const item = z.object({
  question: z.string().trim().min(1).max(2000),
  answer: z.string().trim().min(1).max(4000),
  choices: z.array(z.string().min(1).max(1000)).min(2).max(6).optional(),
  correct: z.number().int().min(0).max(5).optional(),
});

export const studySchema = z.object({
  title: z.string().trim().min(1).max(150),
  items: z.array(item).min(1).max(30),
});

export function parseStudy(raw: string, kind: "quiz" | "flashcards") {
  const result = studySchema.parse(
    JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    ),
  );

  if (
    kind === "quiz" &&
    result.items.some(
      (x) =>
        !x.choices || x.correct === undefined || x.correct >= x.choices.length,
    )
  )
    throw Error(
      "The model returned an incomplete quiz. Try generating it again.",
    );

  return result;
}

export { studyRequest, studyInstructions } from "./study-request.ts";
