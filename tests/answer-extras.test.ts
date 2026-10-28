import test from 'node:test';
import assert from 'node:assert/strict';
import { answerExtras, answerInstructions, coreAnswerInstructions, visualLanguage, videoLanguage } from '../core/answer-format.ts';

test('a desktop message carries the visual schema and the video rule only when it may want them', () => {
  assert.ok(!coreAnswerInstructions.includes(visualLanguage) && !coreAnswerInstructions.includes(videoLanguage));
  assert.ok(answerInstructions.includes(visualLanguage) && answerInstructions.includes(videoLanguage), 'the web keeps them');
  assert.ok(coreAnswerInstructions.length < answerInstructions.length - 6000);
  for (const plain of ['hi', 'thanks!', "Explain Ohm's law", 'Summarise lecture 3 in bullet points', 'Solve question 2 of the homework'])
    assert.equal(answerExtras([plain]), '', plain);
  for (const visual of ['/visual a pendulum', 'Make an interactive graph of sin x', 'simulate projectile motion', 'Animate the Krebs cycle', 'show the molecule of caffeine in 3D', 'visualise the electric field', 'a concept map of the French revolution'])
    assert.ok(answerExtras([visual]).includes(visualLanguage), visual);
  for (const video of ['find me videos on the Krebs cycle', 'any youtube lectures on this?', 'what should I watch for revision?'])
    assert.ok(answerExtras([video]).includes(videoLanguage) && !answerExtras([video]).includes(visualLanguage), video);
  // A follow-up on a visual already in the chat ("make it slower") still has the schema.
  assert.ok(answerExtras(['make it slower', 'Here it is:\n```visual\n{"kind":"wave"}\n```']).includes(visualLanguage));
});
