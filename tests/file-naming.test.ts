import { test } from 'node:test';
import assert from 'node:assert/strict';
import { betterFileName } from '../core/file-naming.ts';

const slide = (...lines: [string, number][]) => ({ lines: lines.map(([text, size]) => ({ text, size })) });
const lecture = slide(['ELCT 301 – Electric Circuits', 20], ['Lecture 3: Nodal Analysis', 28], ['Dr. Ahmed Din', 14], ['Fall 2026', 12]);

test('inside a subject, a lecture is named by what it covers and its number', () => {
  assert.equal(betterFileName('Lec03.pdf', lecture, 'Electric Circuits'), 'Nodal Analysis – Lecture 3.pdf');
  assert.equal(betterFileName('Electric Circuits - Lecture_03.pdf', lecture, 'Electric Circuits'), 'Nodal Analysis – Lecture 3.pdf');
  assert.equal(betterFileName('GUC_45_64_46266_2024-09-07T10_43_25.pdf', lecture, 'Electric Circuits'), 'Nodal Analysis – Lecture 3.pdf');
});

test('outside a subject, a lecture is named by its course and number', () => {
  assert.equal(betterFileName('Lec03.pdf', lecture), 'Electric Circuits – Lecture 3.pdf');
  assert.equal(betterFileName('L3.pptx', slide(['Lecture 3', 30], ['Thevenin Equivalents', 22])), 'Thevenin Equivalents – Lecture 3.pptx');
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
