// A subject or project chat sends what only the main thread can do up to it (core/main-thread/handoff.ts mainOnly).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mainOnly } from "../core/main-thread/handoff.ts";

test("the main thread's own business asked in a subject chat goes up to it", () => {
  for (const t of ["remind me tomorrow at 9 to submit the lab", "remove the presentation from coming up", "stop telling me about new files in Math",
    "what's my schedule tomorrow", "when is quiz 2", "what's quiz 2 about", "did my grades come out", "undo that", "mute announcements from this course"])
    assert.equal(mainOnly(t), true, t);
});

test("work on the material stays in the subject chat", () => {
  for (const t of ["explain line integrals", "make flashcards for chapter 16", "solve problem 3 from the sheet", "summarize lecture 10",
    "/quiz chapter 16", "what is a vector field", "help me with this proof", ""])
    assert.equal(mainOnly(t), false, t);
});
