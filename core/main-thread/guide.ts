// What the main thread's AI is told (docs/MAIN-THREAD.md), from one place: the app's main thread (src/App.tsx) and the
// Telegram main thread (core/telegram/thread.ts, on the laptop and on the VPS worker) build their guides from these
// parts, so the organizer's rules read the same everywhere. Byte-stable, so prompt caching keeps them.
import { AI_FIRST } from "./context.ts";
import { HANDOFF_GUIDE } from "./handoff.ts";
import { WATCH_GUIDE } from "../proactivity/watches.ts";
import { CALENDAR_GUIDE } from "../proactivity/calendar.ts";
import { ROUTINE_GUIDE } from "../proactivity/routines.ts";
import { TELEGRAM_GUIDE } from "../telegram/guide.ts";
import { EDIT_GUIDE } from "../workspace-edit.ts";

/** Who the main thread is and that the person comes first. */
export const MAIN_THREAD_BASE = "This is the person's main thread: one ongoing conversation where you are their organizer across every subject and project. Keep replies short and practical. " + AI_FIRST;
/** Clem's own posts in the thread (news, briefs, reminders) are the AI's to answer for. */
export const OWN_POSTS = "Your messages here that answer nothing they asked are what Clem told them by itself (news, briefs, reminders, what it did): they are yours, so \"yes\", \"undo that\" or \"which one?\" is about them.";
/** The organizer's tools: watches, the calendar (schedule, reminders, study time), routines. */
export const ORGANIZER_GUIDES = WATCH_GUIDE + "\n" + CALENDAR_GUIDE + "\n" + ROUTINE_GUIDE;

/** Plans asked for here are saved at once (owner, 2026-11-16: "main thread can make plans, from inside the app"): the
 *  person asked in words, so there is no draft to open and save (src/App.tsx applyPlanUpdates). Replacing or deleting
 *  a plan they have still waits for them. */
export const MAIN_PLANS = "Plans: when the person asks for a plan (\"plan my week\", \"make me a revision plan for Physics\", \"plan my project\"), make it yourself with ```plan blocks, one per subject or project, with the space ids under PLANS. In this thread (whatever the plans workflow says about drafts) a new plan is saved at once into that subject's or project's Plan tab, not a draft: say in one line what you made and where (\"I made a 2-week revision plan in Physics III: 9 tasks up to the midterm.\"), and that they can ask for changes here or in the Plan tab. Replacing a plan they already have, or deleting one, still waits for them to confirm on its card.";

/** The main thread typed in the app: everything above, plus the hand-off to a subject chat and Telegram's tools. */
export const MAIN_THREAD_NOTE = MAIN_THREAD_BASE + " " + HANDOFF_GUIDE + " " + OWN_POSTS + " " + MAIN_PLANS + "\n" + ORGANIZER_GUIDES + "\n" + TELEGRAM_GUIDE + "\n" + EDIT_GUIDE;
