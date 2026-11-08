import type { Shot } from './shell';

/** The nine feature pages. Their ids are the old public URLs (#/features/<id>) and must not change.
 *  Every sentence is something the app does today (docs/FEATURES.md); nothing here is a plan. */
export type Feature = {
  id: string; name: string; title: string; line: string; body: string[]; points: [string, string][];
  shot: Shot; alt: string; more?: [Shot, string][];
};

export const FEATURES: Feature[] = [
  {
    id: 'learning', name: 'Learning', title: 'A subject that knows when the exam is.',
    line: 'Subjects hold your notes and slides, and turn them into flashcards, quizzes and a plan paced to the exam.',
    body: [
      'Make a subject for each course and drop in the syllabus, the slides and your notes. Clem answers from them, and makes flashcards, quizzes, worksheets and summary sheets from them in one click.',
      'Every card is scheduled with FSRS spaced repetition and paced to the exam date, so the cards due today are the ones worth your time. A plan lays out the weeks before the exam and moves when you tell it what changed.',
    ],
    points: [['Import from Anki and Quizlet', 'Anki decks in both layouts, Quizlet exports pasted or opened as a file.'], ['Study reminders', 'One Windows notification a day at most, and never when nothing is due.'], ['Share a subject', 'A .clempack with flashcards, quizzes and chosen folders, never your chats or history.']],
    shot: 'flashcards', alt: 'Clem showing the Biology 101 subject on its Flashcards tab: six cards to review and the Cell organelles set.', more: [['plan', 'The Biology 101 midterm plan: ready for the midterm on the 19th, on track, with the osmosis write-up due today.']],
  },
  {
    id: 'research', name: 'Research', title: 'Answers that open your file at the page.',
    line: 'Citations open the PDF at the page they came from, and a source check says which claims your files support.',
    body: [
      'Ask about your own reading and Clem answers from it, with a citation after each claim. Click one and the file opens beside the chat at that page.',
      'Under every answer, Check sources lists each claim and whether your files support it, partly support it or say nothing about it. Second opinion asks another connected model, from another provider first, to review the answer.',
    ],
    points: [['Web search on your plan', 'Codex models search live, Claude uses its own search, and the chat shows what it is looking up.'], ['Long PDFs', 'Every document is read page by page, scanned pages included.'], ['Search everything', 'Ctrl Shift F searches chats, files, linked folders and flashcards on this PC.']],
    shot: 'cited', alt: 'Clem answering why a potato gains mass in water, with citations to the lab handout and the handout open beside the chat at page 1.', more: [['chat', 'The same answer with its source check open: two of two claims supported, and two numbers recomputed and confirmed.']],
  },
  {
    id: 'physics-diagrams', name: 'Physics diagrams', title: 'Turn the idea over in your hands.',
    line: 'Type /visual and a topic for a 3D model you can turn, a plot with sliders, a step-through diagram or a chart.',
    body: [
      'Eight built-in physics models answer instantly. Anything else is described by your connected model in a small language that Clem checks, works out with a safe evaluator and draws itself, so a visual never runs code it was handed.',
      'Molecules come out in real 3D, from real bond lengths and angles, and turn under your mouse. Plots get sliders and readouts, diagrams step through, and every visual exports as PNG, SVG or PDF.',
    ],
    points: [['3D you can turn', 'Molecules, surfaces, solids and fields, drawn with depth.'], ['Plots with sliders', 'Change a parameter and the curve and its readouts follow.'], ['Export', 'PNG, SVG or PDF, sharp at any size.']],
    shot: 'visual', alt: 'Clem showing a 3D model of methane: a carbon atom with four hydrogens at the corners of a tetrahedron, in the chat that asked why methane has that shape.',
    more: [['ringing', 'Another visual in Clem: why a long cable rings, a plot with a cable length slider, phase margin and overshoot.']],
  },
  {
    id: 'technical-reports', name: 'Technical reports', title: 'A report with every number worked out twice.',
    line: 'Typeset PDF reports from your measurements, with each calculation recomputed before you see it.',
    body: [
      'Ask for a lab report or a write-up and Clem writes it once, then typesets it as a PDF with its figures and tables. Your bench data comes from the files in the project.',
      'Answers with calculations end with a check: Clem recomputes each stated formula and flags any value that differs. It confirms the arithmetic, not the choice of formula, and it says so.',
    ],
    points: [['Revise the same file', '“Make it longer” or “the diagram is wrong” changes that document, not a new one.'], ['Figures and calculations', 'Drawn and worked out by the same engine every time.'], ['Before, After and Undo', 'Changed lines are highlighted, and every earlier version stays.']],
    shot: 'chat', alt: 'A Clem chat about an osmosis lab, with citations, two numbers recomputed and confirmed, and Second opinion, Check sources and Export under the answer.',
  },
  {
    id: 'financial-analysis', name: 'Financial analysis', title: 'Real spreadsheets, and sums you can trust.',
    line: 'Real Excel files from your figures, with every stated calculation recomputed and flagged if it differs.',
    body: [
      'Give Clem the numbers, or the spreadsheet they live in, and ask for the analysis. It answers with the working shown and a check block that recomputes each formula it used.',
      'When the result should be a file, it is a real Excel workbook you can open and keep editing, saved with the rest of the project on your PC.',
    ],
    points: [['Checked numbers', 'Each formula is worked out again; a value that differs is flagged.'], ['Charts', 'Drawn from the data, exported as a picture or inside a document.'], ['Your folders', 'Link the folder your spreadsheets live in and Clem reads them in place.']],
    shot: 'files', alt: 'Clem’s Files page: a Word draft, a PowerPoint deck, an Excel workbook, a PDF and a text file, all kept on this PC.',
  },
  {
    id: 'presentations', name: 'Presentations', title: 'Slides that open in PowerPoint.',
    line: 'Real PowerPoint files from a subject or a project, made from your own material.',
    body: [
      'Ask for a deck on a topic you have notes for and Clem makes a real .pptx from them, saved with the subject or project. Open it in PowerPoint and keep going.',
      'Tell Clem what to change and the same file changes. Slides you dropped in yourself are read too, so a lecture deck becomes flashcards or a summary sheet.',
    ],
    points: [['Real files', 'PowerPoint, Word, Excel and PDF, not pictures of them.'], ['From your material', 'Built from the files in the subject or project.'], ['Kept on this PC', 'Saved in Documents\\Clem with everything else.']],
    shot: 'subject', alt: 'The Biology 101 subject in Clem: six cards to review, the midterm plan on track, recent chats and recent files including Week 6 membranes.pptx.',
  },
  {
    id: 'professional-documents', name: 'Professional documents', title: 'Documents you change by asking.',
    line: 'Typeset PDFs and real Word files, revised in place with Before, After and Undo.',
    body: [
      'Ask for a report, a letter, a worksheet or a summary and get a typeset PDF or a real Word file. Tell it what to change and that same file changes.',
      'PDFs Clem made are set again from their kept source. Any other PDF has the changed lines reset in place, in a matching font, size and colour. Changed lines are highlighted, Before and After compare them, and Undo goes back.',
    ],
    points: [['Edits in place', 'The file you have is the file that changes.'], ['Compare', 'Before and After, with the changed lines marked.'], ['Undo', 'Every earlier version is kept.']],
    shot: 'files', alt: 'Clem’s Files page listing a Word report draft, a PowerPoint deck, an Excel workbook, a PDF handout and a syllabus.',
  },
  {
    id: 'connected-work', name: 'Connected work', title: 'Your folders, read where they are.',
    line: 'Link folders on your PC or in Google Drive. Clem reads them in place and proposes changes you approve.',
    body: [
      'Everything Clem keeps is in Documents\\Clem as plain files. Link any other folder on your PC, or one in Google Drive, and Clem reads it where it is. Nothing from Drive is copied to your PC.',
      'When Clem wants to change a file in a linked folder, it shows the change first. Nothing is written until you apply it, and every change can be undone. A file changed outside Clem raises a notice that can update your flashcards.',
    ],
    points: [['Google Drive, live', 'Any folder or subfolder, Shared with me, and videos that stream.'], ['Encrypted backups', 'One .clembackup file, daily or weekly, to any folder or to Drive.'], ['Offline reading', 'When the account service is out of reach, your files still open.']],
    shot: 'files', alt: 'Clem’s Files page: five files, 9.1 MB, private to the device.',
  },
  {
    id: 'multi-model-work', name: 'Multi-model work', title: 'Every AI you pay for, in one window.',
    line: 'Connect ChatGPT, Claude, Grok or Google AI. Pick per chat, get a second opinion, keep working when one runs low.',
    body: [
      'Each AI works through its own official tool on your PC: Codex for ChatGPT, Claude Code, the Grok CLI and Antigravity for Google AI. Clem signs in to each one separately and never touches their own settings.',
      'Pick a model for each chat, and ask a different provider for a second opinion on any answer. With several accounts connected, Clem can switch to another before a request when the one in use runs low.',
    ],
    points: [['Your plan, no new subscription', 'Clem adds nothing to pay for.'], ['Chats side by side', 'Each answers on its own; stopping one never stops another.'], ['Confined to your files', 'Each AI works in a folder of your files, with its tools kept inside it.']],
    shot: 'models', alt: 'Clem’s Settings on the Models page: ChatGPT, Claude, Grok and Gemini tabs, one ChatGPT account connected, and Switch accounts automatically turned on.',
  },
];

export const featureById = (id: string) => FEATURES.find((f) => f.id === id);
