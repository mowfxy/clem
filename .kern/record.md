# Clem website — Kern record

## Brief (user, 2026-10-24)
Asked: feel, how loud, how much M4 Labs, never.
The picture in their head: Clem's own feel, not M4 Labs'. Paper & ink, by the clock: the app's warm paper and navy ink, Mowafy Serif; the page follows the visitor's hour like the app's greeting (paper by day, ink at night). Light and dark both designed.
How loud: **Expressive** (user changed it from spectacular mid-build: "forget about the scroll based"), plus a video-like animation in the ink style.
Later (user): film a bit faster, no pause/skip controls on the film or the demo, hero's second link is "View source", fix overlapping text and the chat history in the demo window.
M4 Labs: a quiet credit only (footer and About). No terminal prompts, no `m4labs:~$`.
Never: nothing specific.
Assets: the app itself (paper/ink themes, Mowafy Serif/Sans, drawn icon set, ink "vector film" scenes, ASCII mountain sky, thinking cursors, the visual engine), the mark (core/mark.ts), Outfit wordmark.
Also user: "animations and way more", "perfection".

## Locate
Surface: public product site (landing + features, support, about, download pages) at clem.m4labs.xyz.
Platform: React 19 + Vite, hash routes, same bundle as the app.
Device and posture: laptop at a desk, phone from a link; a student or researcher deciding whether to install a desktop app.
Frequency and stakes: seen once or twice; the action is a Windows download.

## Ground
Specimen: "why does my op-amp oscillate with a long cable?"; "Late night, thinker."; Documents\Clem; flashcards; "Exam · 12 Nov"; citation that opens the page; "Recomputed ✓".
People: students before exams, researchers, engineers writing reports; they fear wrong answers and losing their files; they already pay for ChatGPT/Claude/Grok/Gemini.
Material culture: the app's new-chat screen (greeting + composer + chips over an ASCII mountain sky that keeps the hour); the subject page (Calculus, tabs: Overview, Chats, Plan, Flashcards, Quizzes, Files, Visuals, Memory); ink drawings in an ivory/navy pen line with one colour spot, drawn on twos; three hopping block cursors; navy ink buttons; paper #faf8f3, ink #20253a.
Most specific facts:
1. The app greets by hour: Late night (<5), Morning (<12), Afternoon (<18), Evening; "thinker" when unnamed.
2. The new-chat sky moves the sun or moon by the real time, with birds by day and shooting stars at night.
3. Clem's illustrations boil on twos (12 fps), pose to pose with a small overshoot, colour on one small element.
4. Thinking = three block cursors hopping, 1.35 s loop, 0.45 s apart, beside what Clem is doing.
5. Citations open the file at the right page; calculations end with a recomputed check.
6. /visual returns a live, playable figure from a description (sliders, 3D).
7. Subjects hold notes, flashcards, a plan to an exam date and memory.
8. Everything is plain files in Documents\Clem.
9. Free, MIT, Windows 10 & 11; uses the plan you already pay for.

## Tension
Serious enough for an exam, a lab report or a literature review — and still a calm, personal place that feels like yours.

## Thesis
The site should feel like an open notebook at the visitor's own hour — navy ink on warm paper, a pen that draws by itself, the sky outside the window — because Clem's promise is serious work held in a calm, personal space.
Swap test: "ChatGPT/Notion should feel like an open notebook at your own hour, with Clem's pen drawings and greeting" fails — the hour-keeping sky, the ink films and the cursors are Clem's.

## Median
An average model would ship: a dark hero with a gradient glow, Inter, a pill eyebrow, a tilted app screenshot, three icon feature cards, a bento grid, a logo strip, fade-up on every block, FAQ accordion, gradient CTA band. For "calm AI" it would ship cream + terracotta serif.
Kept: the FAQ as disclosure rows (people scan questions; done as ruled notebook lines). Paper + serif is inherited from the app, not chosen for "calm".

## Register
Expressive (user). The signature is the ink film (src/site/film-script.ts): ~48 s of Clem's own pen (vectorFilm's exported pen), the mark's block cursor as its character, captions in Mowafy Serif, brush wipes between places, played at 1.35x, looping, no controls.
Materials:
- Recreated live UI: the Clem window rebuilt in HTML with real strings; six chapters play by time while in view (src/site/Story.tsx Demo), pickable, no pause button.
- ASCII sky (the app's AsciiField) behind the hero, at the visitor's hour. Own material; it is the new-chat backdrop.
- Ink films (vectorFilm) as plates for features and section turns. Own material; already Clem's illustration system.
- Live visual: the real SpecVisual engine running a step-response plot with a cable-length slider. Play.
- Kinetic type: headlines written line by line from a mask; a pen underline draws under "think".
- Photography, 3D blobs, sound: no. Not Clem's material.

## System
Colour source: the app's paper theme (paper #faf8f3, ink #20253a) by day; by night the page becomes the ink pot (#0e1017 blue-black, paper-white type). Accent: the ink films' palette, one spot per drawing (blue #6a9bcc for the pen underline, sand for citation highlights).
Type: Mowafy Serif 400 display (hero 10.5vw), Mowafy Sans body 18px, JetBrains Mono only for paths; Outfit only for the wordmark.
Space: 8px base; section rhythm 120–180px; outer margin clamp(20px,4vw,56px).
Shape: app radii — window 16, composer 18, buttons 12, chips 10. 1px rules.
Depth: one light from above; the window has a long soft shadow by day, a rule and glow by night.
Controls: the app's own drawn icon set (Icon) at stroke 2.1; ink-filled primary button like "Open browser again"; links underline from the left like a pen stroke.
Motion: quick 160ms, moderate 280ms, slow 640ms; ease-out cubic-bezier(.2,.8,.2,1); pose cubic-bezier(.34,1.36,.64,1) on content only. Signature: the ink film. Second: the hour (greeting, sky, theme).
Chrome: theme-color follows the clock theme; header transparent over the sky, paper with a rule after scroll.
Themes: both, chosen by the clock, with a manual sun/moon override remembered per visitor.
Defended risk: the site's theme and greeting are decided by the visitor's clock, not a toggle default — at 1 a.m. Clem's site is ink-dark and says "Late night, thinker."
