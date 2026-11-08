# Clem website — Kern record

> Superseded: the website sections from "Brief (user, 2026-10-24)" to "System" describe a retired site. The current website is "2026-11-08 Website: the descent" at the end. The app sections still apply.

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

## Profile pictures (user, 2026-11-05)
Asked for: animated pictures in the app's ink style, fitting the grey background, of "living real things". Rejected on the way: thick-line characters with faces ("too childish"), invented forms ("arent nearly like the ink like animations in app"), the real films reused as they are ("not same exact ones ofc"), and new films of plain shapes.
Now: eight living things, each its own film (src/avatarFilms.ts, ids unchanged): Finch, Moth, Snail, Koi, Jellyfish, Bee, Whale, Sprig.
Same ink, drawn from life: vectorFilm's pen on its 480×390 stage, thin line in empty space, one hatched colour spot, a small ink eye and no cartoon face, hold then snap with a small overshoot, and each moves as the creature does.
Rule kept: nothing redraws an SVG in the sidebar. Each film is drawn once and played on its own canvas at 12 drawings a second.

## Sidebar and settings (user, 2026-11-05)
Wider column and larger buttons, after the user's Claude app screenshot: --side is clamp(260px,21vw,300px), nav rows 42px, type 16px, icons 22px, in src/roomy.css, with settings' rail matching.
All Sans text in the sidebar and settings is Medium (the user: "slightly thicker ... but not bold"). The wordmark stays as the logo and the serif headings stay Regular.

## 2026-11-06 Type: Mowafy Sans 6.3 and Serif 3.2
Both families now have Text and Display cuts; Display (--serif-display, --sans-display) is for headings of about 28px and up. In the sidebar and settings Medium is the floor, SemiBold carries labels and titles, and Bold is not used (src/roomy.css). This replaces the earlier "Medium everywhere" rule at the owner's request.

## 2026-11-07 App redesign: the horizon in glass (user)
Reference: a dark coding-agent home with a dithered orbital sunrise behind glass panels; and a NASA photo of Earth's limb, shuttle removed by request. "Liquid glass feel, not grey." "Use Mowafy Serif and Sans, nothing else." "Text is so large compared to button sizes", in the sidebar and in settings.
Thesis: the app should feel like looking out at the sunrise from orbit through a pane of glass, because study is long, quiet, solitary work that still needs one thing worth looking up at.
Backdrop: src/glass/HorizonField.tsx, the photo (rotated flatter, regraded, 900 px) set in Mowafy Sans characters over a dimmed copy of itself, covering the whole window, with a slow twinkle only on home. Replaces the mountain sky in the app; the website keeps AsciiField.
Glass: scripts/glass-theme.mjs converts the old greys at build time (surfaces to sheets of light, ink to a cool tint, paper twins to white glass). src/glass/glass.css sets the materials. A chat or page frosts the window with .glass-pane, a separate layer because a filter on .workspace would capture fixed children. Colour source: the photo's sky blue and ember orange.
Proportions (replaces the 2026-11-05 and 2026-11-06 sidebar rules; roomy.css is gone): row 38, text 14, icon 18; small row 34, text 13.5; label 12. Sidebar and settings share them. Medium is the floor, SemiBold only marks where you are and group labels.
Home: greeting, composer, chips, then src/glass/StudyHome.tsx: study activity, recent chats, next exam, up next, this month. All counted from the person's own data.
Type: the app's wordmark is Mowafy Serif Display, not Outfit. A fixed-width face stays only in code. The website is unchanged.
Defended risk: the whole window, not a hero, is a photograph in type; a study app that puts a sunrise behind its sidebar.

Later the same day (user): the home chips stay small pills, centred under the textbox ("you expanded the button, before it was great just misplaced"). ASCII dimmed. Notices are glass slips: a small mark on a bead of glass instead of an ink drawing, one-line title, two lines of detail that open on hover, shorter wording. Memory is a row list in solid glass; every pop-up window shares that glass (src/popups.css forces dialogs with !important, so glass.css answers with !important).

Memory has no Keep or Forget (user, 2026-11-07): one Delete button on every memory and on the notice, the add field stays at the bottom. Learned memories stay unconfirmed in the data.

Rollout (2026-11-07): the top bar has no surface. Text scrolling under it goes soft beneath a veil (.workspace::before) that fades out with no edge, and Windows' caption buttons sit on a transparent overlay. glass-base.css holds the materials plus sign-in and setup, because those screens show before the workspace's stylesheets load; glass.css stays last. Sign-in and first-run setup are one glass sheet over the horizon. Do not set z-index on .workspace or .desktop-titlebar: a stacking context there puts the title bar over the top bar's buttons.

## 2026-11-08 Website: the descent (user)
A new clem.m4labs.xyz, built from the desktop app alone. The old site (src/site) was deleted unread; no earlier site or draft was used as a reference.
Brief, asked: the look (inside the window / quiet night page / follows day and night), loudness, the ten-second goal, the never-list. Answers (user): **quiet night page** (mostly the app's #05080f, serif headlines, the horizon and glass once at the top, then real windows do the talking); **spectacular**; after ten seconds a visitor should **see what it does**; never **stock icons**. Already decided by the user: whole-window screenshots only and HTML for anything smaller; every page and URL rebuilt; Mowafy Serif and Sans only (no Outfit, no mono); no influence from earlier sites.
Ground: Clem is a free, open-source Windows app (preview 0.3.21) that runs on the ChatGPT, Claude, Grok or Google AI plan you already pay for, through Codex, Claude Code, the Grok CLI and Antigravity; work lives in Documents\Clem; subjects with FSRS flashcards and exam-paced plans; citations that open the PDF at the page; source check and second opinion; /visual plots with sliders; real Office files edited in place. The demo workspace (scripts/site/capture.mjs): Sam, Biology 101, the osmosis lab, the op-amp cable that rings. The line under every message box: "Make room for doubt. Check the things that matter."
Tension: a spectacle that has to hand over, within a scroll, to quiet proof.
Thesis: the site should feel like the moment Clem opens: you fall from the sunrise toward the window, and then it is the app's night with the work in view, because study is long quiet work that still needs one thing worth looking up at.
Median for this brief: centred hero with a pill, tilted laptop mock, three icon cards, bento, testimonials, gradient CTA, glyph-rain or aurora behind it. Departed from all of it; the only thing kept is a download button at the top, because downloading is the action.
Register (user): spectacular, spent once. Materials: the app's horizon field (live canvas, the photo read cell by cell into Mowafy Sans characters, same reading as src/glass/HorizonField.tsx, twinkling only at the top); whole-window captures of the real desktop build; HTML rebuilds of app pieces (source check, checked numbers, plan, flashcard, Windows notification, models, folder tree, document revision, the /visual command); one live instrument (the "Why a long cable rings" plot with its cable-length slider, same model as the demo). Left out: glass after the top (user: quiet night), illustration, sound, 3D.
System: colour from the app's materials (night #05080f, ink #eef3fa, soft #c6d0df, muted #93a0b5, sky #7fb2ff for links, ember #ff9a5c only for feature names). Type follows the app's rule: Serif Display for headlines, Serif for everything you read, Sans for names, labels and controls. Controls keep the app's proportions (row 38/34, text 14/13.5, icon 18, label 12); primary is the app's white glass setup button; icons are the app's own drawn set (Icons.tsx). Details use the app's pop-up glass (#0d1524 with rim and sheen), solid, so nothing needs a backdrop. Motion: the app's ease cubic-bezier(.2,.8,.2,1), 160/280/640 ms; the descent is the signature (canvas zooms toward the limb, dusk closes in, the home window rises and settles); arrivals once; the plot draws itself. Reduced motion: no descent, the sky is a still first screen and the window sits below it. Chrome: theme-color #05080f, the top bar is the app's veil (text goes soft under it, no edge). Night only.
Pages: #/ (descent, research, play, study, plans, files, open source, download); #/features (nine rows, old ids kept) and #/features/<id> (one whole window, prose, the matching HTML pieces, three more facts, previous/next); #/about; #/support (#/pricing lands here; price answered); #/privacy and #/terms hand off to m4labs.xyz; every other route is the download page (?start begins the download, #/desktop-return says welcome back, #/app adds account security for a signed-in web user, at the top). public/404.html is self-contained in the same night. og:image public/og.png and the README banner are the first screen.
Defended risk: the first screen is a photograph turned into live characters that you fall through, and the page's main proof is an instrument that works.
Captures: npm run desktop:build && node scripts/site/capture.mjs, then ffmpeg to webp at 2878 and 1440 in public/shots (dark windows; the welcome window is the light one).

Later the same day (user): only whole screenshots of the app. Every HTML rebuild of app pieces is gone (source check, answer tools, flashcard, plan, notification, models list, folder tree, document revision, the /visual command), and so is the live HTML plot. The visual example is now methane: scripts/site/capture.mjs adds a Chemistry 102 chat "/visual why is methane shaped like a tetrahedron?" whose 3D molecule is captured as the window "visual"; the cable plot stays as the window "ringing" on the physics-diagrams page. Windows are centred at full width. The page's richness is now the descent plus the real windows; there is no live element below the top.

