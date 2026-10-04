import { test, before } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";

// markdown-deck reads the deck themes from pptx-deck, which opens Chromium only when a deck is drawn: bundle with electron left out.
let lib: { markdownDeck: (md: string, title?: string) => any; pickTheme: (text: string) => string; deckProblems: (spec: any) => string[] };
before(async () => {
  await build({
    stdin: { contents: `export {markdownDeck,pickTheme} from "./desktop/markdown-deck.ts";export {deckProblems} from "./desktop/pptx-deck.ts";`, resolveDir: process.cwd(), loader: "ts" },
    outfile: "desktop-dist/markdown-deck-test.cjs", bundle: true, platform: "node", format: "cjs", external: ["electron"], logLevel: "error",
  });
  lib = createRequire(import.meta.url)("../../desktop-dist/markdown-deck-test.cjs");
});

const chart = { kind: "chart", title: "Sales by quarter", chart: { type: "bar", labels: ["Q1", "Q2"], series: [{ name: "2026", values: [3, 5] }] } };
const answer = `# Quarterly review

Where revenue grew and where it did not.

## Highlights

- **42%** growth in new customers
- **3.1M** revenue this quarter
- **12** markets reached

## Plan

1. Hire two account managers
2. Launch the partner programme
3. Review pricing in Q3

## Channels

- **Direct**: our own sales team, highest margin
- **Partners**: resellers who bring volume
- **Online**: self-service sign-ups

## Numbers

| Region | Revenue | Growth |
|---|---:|---:|
| EMEA | 1.2M | 12% |
| APAC | 0.9M | 31% |

## Trend

\`\`\`visual
${JSON.stringify(chart)}
\`\`\`

## The model

Revenue follows

$$R = N \\cdot p$$

- N is customers
- p is the price per customer

## Overview of the year

${"The company expanded into new regions and rebuilt its pricing. ".repeat(12)}Customers noticed.
`;

test("an answer becomes a deck whose layouts follow its content, and the deck is valid", () => {
  const deck = lib.markdownDeck(answer, "Fallback");
  assert.equal(deck.title, "Quarterly review");
  assert.equal(deck.slides[0].layout, "title");
  assert.equal(deck.slides[0].subtitle, "Where revenue grew and where it did not.");
  const by = (title: string) => deck.slides.filter((s: any) => s.title === title);
  assert.equal(by("Highlights")[0].layout, "stats");
  assert.deepEqual(by("Highlights")[0].stats.map((s: any) => s.value), ["42%", "3.1M", "12"]);
  assert.equal(by("Plan")[0].layout, "process");
  assert.equal(by("Channels")[0].layout, "cards");
  assert.deepEqual(by("Channels")[0].items[0], { title: "Direct", text: "our own sales team, highest margin" });
  assert.equal(by("Numbers")[0].layout, "table");
  assert.deepEqual(by("Numbers")[0].table.header, ["Region", "Revenue", "Growth"]);
  const figure = deck.slides.find((s: any) => s.layout === "figure");
  assert.deepEqual([figure.figure.module, figure.figure.fn, figure.figure.args[0].title], ["mowr", "visual", "Sales by quarter"]);
  // An equation with its points is one slide; long prose goes to the speaker notes, not onto the slide.
  assert.equal(by("The model").length, 1);
  assert.deepEqual([by("The model")[0].layout, by("The model")[0].math, by("The model")[0].bullets.length], ["equation", "R = N \\cdot p", 2]);
  const prose = by("Overview of the year")[0];
  assert.equal(prose.layout, "bullets");
  assert.match(prose.notes, /Customers noticed/);
  assert.ok(deck.slides.some((s: any) => s.layout === "agenda"));
  assert.deepEqual(lib.deckProblems(deck), []);
});

test("the design follows the subject, and a neutral answer gets a calm one", () => {
  assert.equal(lib.pickTheme("Quarterly strategy review: revenue, market share, investors and the board"), "boardroom");
  assert.equal(lib.pickTheme("Newton's laws: force, energy, an equation $F = ma$ and a physics experiment"), "lab");
  assert.equal(lib.pickTheme("A lesson for children at school with an activity for students"), "classroom");
  assert.equal(lib.pickTheme("Hello there, a few thoughts."), "minimal");
  assert.equal(lib.markdownDeck("# Plan for the garden\n\nSustainability, climate and community food growing.\n\n## Beds\n\n- Plant herbs\n- Water daily").theme.preset, "earth");
});

test("odd answers still make a valid deck: no headings, a long table, notes blocks and links", () => {
  const plain = lib.markdownDeck("Just a short answer with a [link](https://example.com) and `code`.", "Quick note");
  assert.deepEqual(lib.deckProblems(plain), []);
  assert.equal(plain.slides[0].title, "Quick note");
  const rows = Array.from({ length: 30 }, (_, i) => `| item ${i} | ${i} |`).join("\n");
  const long = lib.markdownDeck(`# Big table\n\n## Data\n\n| Name | Value |\n|---|---|\n${rows}\n\n\`\`\`edit\n{"x":1}\n\`\`\`\n`);
  assert.deepEqual(lib.deckProblems(long), []);
  assert.equal(long.slides.filter((s: any) => s.layout === "table").length, 3);
  assert.ok(long.slides.every((s: any) => !JSON.stringify(s).includes('"x":1')));
  assert.ok(!JSON.stringify(plain).includes("](http"));
});
