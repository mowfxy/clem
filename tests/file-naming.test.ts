import { test } from 'node:test';
import assert from 'node:assert/strict';
import { betterFileName, cleanAiName, namingPrompt, saysEnough } from '../core/file-naming.ts';

const slide = (...lines: [string, number][]) => ({ lines: lines.map(([text, size]) => ({ text, size })) });
const lecture = slide(['ELCT 301 – Electric Circuits', 20], ['Lecture 3: Nodal Analysis', 28], ['Dr. Ahmed Din', 14], ['Fall 2026', 12]);

test('inside a subject, a lecture is named by what it covers and its number', () => {
  assert.equal(betterFileName('Lec03.pdf', lecture, 'Electric Circuits'), 'Nodal Analysis – Lecture 3.pdf');
  assert.equal(betterFileName('Electric Circuits - Lecture_03.pdf', lecture, 'Electric Circuits'), 'Nodal Analysis – Lecture 3.pdf');
  assert.equal(betterFileName('GUC_45_64_46266_2024-09-07T10_43_25.pdf', lecture, 'Electric Circuits'), 'Nodal Analysis – Lecture 3.pdf');
});

test('outside a subject too, a lecture is named by what it covers, not its course', () => {
  assert.equal(betterFileName('Lec03.pdf', lecture), 'Nodal Analysis – Lecture 3.pdf');
  assert.equal(betterFileName('Electric Circuits Lec 3.pdf', lecture), 'Nodal Analysis – Lecture 3.pdf');
  // The course printed larger than the lecture title is still the course.
  assert.equal(betterFileName('download.pdf', slide(['ELECTRIC CIRCUITS', 34], ['Lecture 5', 26], ['Superposition and Source Transformation', 22])), 'Superposition and Source Transformation – Lecture 5.pdf');
  // With no topic of its own, the course stands in.
  assert.equal(betterFileName('Lec04.pdf', slide(['ELCT 301 – Electric Circuits', 26], ['Lecture 4', 22])), 'Electric Circuits – Lecture 4.pdf');
  assert.equal(betterFileName('L3.pptx', slide(['Lecture 3', 30], ['Thevenin Equivalents', 22])), 'Thevenin Equivalents – Lecture 3.pptx');
});

test('a subject named a little differently from the course is still left out', () => {
  assert.equal(betterFileName('Lec03.pdf', slide(['Electric Circuits I', 34], ['Lecture 3', 24], ['Nodal Analysis', 24]), 'Circuits'), 'Nodal Analysis – Lecture 3.pdf');
  assert.equal(betterFileName('Circuits lecture 7.pdf', slide(['Electric Circuits', 30], ['Lecture 7 – Op Amps', 26]), 'Electric Circuits'), 'Op Amps – Lecture 7.pdf');
});

test('other kinds of material are named the same way', () => {
  const sheet = slide(['ELECTRIC CIRCUITS (ELCT 301)', 18], ['Assignment 1', 18], ['Dr. Din', 12], ['1. Find the voltage across the 4 Ω resistor in the circuit below and show your steps.', 11]);
  assert.equal(betterFileName('Assignment 1 ELCT301 - Dr. Din.pdf', sheet, 'Electric Circuits'), 'Assignment 1.pdf');
  assert.equal(betterFileName('tut 2.pdf', slide(['Tutorial 2 – Mesh Analysis', 24]), 'Electric Circuits'), 'Mesh Analysis – Tutorial 2.pdf');
  assert.equal(betterFileName('scan0001.pdf', slide(['Chapter IV', 30], ['Operational Amplifiers', 26]), 'Electric Circuits'), 'Operational Amplifiers – Chapter IV.pdf');
});

test('names that already say something are kept, minus the subject they sit in', () => {
  assert.equal(betterFileName('Thevenin practice problems.pdf', lecture, 'Electric Circuits'), 'Thevenin practice problems.pdf');
  assert.equal(betterFileName('Electric Circuits Thevenin practice.pdf', lecture, 'Electric Circuits'), 'Thevenin practice.pdf');
  assert.equal(betterFileName('My notes.png', undefined, 'Electric Circuits'), 'My notes.png');
  assert.equal(betterFileName('IMG_2041.jpg', undefined), 'IMG_2041.jpg');
});

test('the AI is asked only about names that do not already say what the file is', () => {
  assert.equal(saysEnough('Thevenin practice problems.pdf', 'Electric Circuits'), true);
  assert.equal(saysEnough('Worksheet 4.pdf', 'Electric Circuits'), false);
  assert.equal(saysEnough('Electric Circuits Sheet 4.pdf', 'Electric Circuits'), false);
  assert.equal(saysEnough('GUC_45_64_46266.pdf'), false);
  const prompt = namingPrompt({ original: 'sheet4.pdf', lines: ['Worksheet 4', 'Thevenin and Norton'], place: 'Electric Circuits', suggestion: 'Thevenin and Norton – Sheet 4' });
  assert.match(prompt, /Electric Circuits/);
  assert.match(prompt, /Worksheet 4/);
});

test("the AI's name is cleaned, keeps the extension and never just repeats the subject", () => {
  assert.equal(cleanAiName('"Thevenin and Norton - Worksheet 4.pdf"\n', '.pdf'), 'Thevenin and Norton – Worksheet 4.pdf');
  assert.equal(cleanAiName('Name: Site Survey Report – March 2026', '.docx'), 'Site Survey Report – March 2026.docx');
  assert.equal(cleanAiName('Electric Circuits', '.pdf', 'Electric Circuits'), undefined);
  assert.equal(cleanAiName('', '.pdf'), undefined);
  assert.equal(cleanAiName('x'.repeat(120), '.pdf'), undefined);
});
