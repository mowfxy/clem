// The short ads: each one's edit (blocks of captured footage between marks, and title cards) and copy.
// In card lines, *word* is the underlined accent and _word_ the green accent.
export const ADS = {
  visuals: {
    scripted: false,
    plan: [
      { kind: "title", id: "intro", dur: 3.6 },
      { kind: "app", id: "ask", pace: 1.15, float: "in", lead: -0.3 },
      { kind: "app", id: "play", pace: 1.15 },
      { kind: "title", id: "any", dur: 2.4 },
      { kind: "app", id: "orbit", pace: 1.15, float: "out" },
      { kind: "title", id: "end" },
    ],
    cards: {
      intro: { lines: ["Some ideas", "you have to *see.*"], sub: "Ask Mowr. Get a model you can play with." },
      any: { lines: ["Pull a slider.", "Watch it _move._"] },
    },
    end: { lines: ["You ask.", "Mowr shows you."], tags: ["You", "Mowr"] },
  },
  pdf: {
    scripted: true,
    plan: [
      { kind: "title", id: "intro", dur: 3.8 },
      { kind: "app", id: "open", pace: 1.25, float: "in", lead: -0.3 },
      { kind: "app", id: "ask", pace: 1.3 },
      { kind: "title", id: "marked", dur: 2.6 },
      { kind: "app", id: "result", pace: 1.1, float: "out" },
      { kind: "title", id: "end" },
    ],
    cards: {
      intro: { lines: ["Edit the *actual* PDF."], big: true, sub: "Not a copy. Not a note on top. The file itself." },
      marked: { lines: ["Every change, _highlighted._"], sub: "Compare before and after. Undo anytime." },
    },
    end: { lines: ["You say it.", "Mowr edits it."], tags: ["You", "Mowr"] },
  },
  study: {
    scripted: true,
    plan: [
      { kind: "title", id: "intro", dur: 3.4 },
      { kind: "app", id: "subject", pace: 1.15, float: "in", lead: -0.3 },
      { kind: "app", id: "worksheet", pace: 1.4 },
      { kind: "title", id: "stick", dur: 2.4 },
      { kind: "app", id: "review", pace: 1.5 },
      { kind: "app", id: "share", pace: 1.2, float: "out" },
      { kind: "title", id: "end" },
    ],
    cards: {
      intro: { lines: ["Everything for the exam.", "*One* place."] },
      stick: { lines: ["Then make it _stick._"], big: true, sub: "Every card comes back right before you'd forget it." },
    },
    end: { lines: ["Mowr makes it.", "You master it."], tags: ["Mowr", "You"] },
  },
};
