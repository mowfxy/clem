import type { Space, StoredFile, StudySet } from "../core/types";

/**
 * The sample subject offered at the end of setup, so the first screen isn't empty: a few notes, a set of flashcards and
 * one question to start a chat with. It holds no chats: the first answer anyone sees here comes from their own AI.
 * It is marked `sample`, so its page offers to delete it.
 */
export const SAMPLE_STARTER = "Quiz me on these cell biology notes: one question at a time, and tell me what I got wrong.";
const notes: [string, string][] = [
  ["Cell organelles.md", `# Cell organelles

- **Nucleus**: holds the cell's DNA and controls which proteins are made.
- **Mitochondria**: make most of the cell's ATP through aerobic respiration.
- **Ribosomes**: build proteins from amino acids, reading messenger RNA.
- **Rough endoplasmic reticulum**: ribosomes on its surface make proteins for export and for membranes.
- **Golgi apparatus**: modifies, packages and ships proteins in vesicles.
- **Lysosomes**: break down worn-out parts and food particles with enzymes.
- **Chloroplasts** (plants): carry out photosynthesis.
- **Cell wall** (plants): cellulose; keeps the cell from bursting in water.
`],
  ["Membranes and transport.md", `# Membranes and transport

The cell membrane is a phospholipid bilayer with proteins in it. It is **selectively permeable**: small non-polar
molecules (oxygen, carbon dioxide) cross it freely; ions and large polar molecules need channel or carrier proteins.

- **Diffusion**: particles spread from high to low concentration. No energy needed.
- **Osmosis**: water diffuses across a selectively permeable membrane, towards the side with more dissolved solute.
- **Active transport**: carrier proteins move substances against their concentration gradient, using ATP.

A plant cell in pure water takes water in and becomes turgid; its wall stops it bursting. An animal cell has no wall
and can burst (lysis). In a concentrated solution both lose water.
`],
  ["Osmosis lab results.md", `# Osmosis lab: potato cylinders

Potato cylinders were left in sucrose solutions for 24 hours and weighed before and after.

| Sucrose (M) | Mass change (%) |
|---|---|
| 0.0 | +18 |
| 0.2 | +6 |
| 0.4 | -4 |
| 0.6 | -13 |

The mass doesn't change where the line crosses zero, near 0.33 M: the potato cells' solute concentration.
`],
];
const cards: [string, string][] = [
  ["Which organelle makes most of the cell's ATP?", "The mitochondria, through aerobic respiration."],
  ["What do ribosomes do?", "Build proteins from amino acids, reading messenger RNA."],
  ["What does the Golgi apparatus do?", "Modifies, packages and ships proteins in vesicles."],
  ["What does selectively permeable mean?", "Some molecules cross the membrane freely; others need channel or carrier proteins."],
  ["What is osmosis?", "Diffusion of water across a selectively permeable membrane, towards the side with more solute."],
  ["How is active transport different from diffusion?", "It moves substances against their concentration gradient and needs energy (ATP)."],
  ["Why doesn't a plant cell burst in pure water?", "Its cellulose cell wall resists the pressure; the cell becomes turgid."],
  ["In the potato lab, what does the point of no mass change tell you?", "The sucrose concentration equal to the cells' own solute concentration (about 0.33 M)."],
];

/** A new copy of the sample subject: the space, its files with their text, and its flashcards. */
export function sampleSubject(now = Date.now()) {
  const spaceId = crypto.randomUUID(), folderId = crypto.randomUUID();
  const files = notes.map(([name, text], i) => ({
    file: { id: crypto.randomUUID(), name, size: new TextEncoder().encode(text).length, type: "text/markdown", created: now - i * 1000, spaceId, folderId } satisfies StoredFile,
    text,
  }));
  const space: Space = {
    id: spaceId, name: "Sample: Cell biology", kind: "subject", sample: true,
    description: "A sample subject to look around. Delete it whenever you like.",
    memory: "", sources: files.map((f) => f.file.id),
    folders: [{ id: folderId, name: "Notes", parentId: null, created: now }],
  };
  const studySet: StudySet = { id: crypto.randomUUID(), spaceId, kind: "flashcards", title: "Cells and membranes", created: now, attempts: [], items: cards.map(([question, answer]) => ({ question, answer })) };
  return { space, files, studySet };
}
