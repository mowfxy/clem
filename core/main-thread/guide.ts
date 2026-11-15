// What the main thread's AI is told (docs/MAIN-THREAD.md), from one place: the app's main thread (src/App.tsx) and the
// Telegram main thread (core/telegram/thread.ts, on the laptop and on the VPS worker) build their guides from these
// parts, so the organizer's rules read the same everywhere. Byte-stable, so prompt caching keeps them.
import { AI_FIRST } from "./context.ts";
import { HANDOFF_GUIDE } from "./handoff.ts";
import { WATCH_GUIDE } from "../proactivity/watches.ts";
import { CALENDAR_GUIDE } from "../proactivity/calendar.ts";
import { ROUTINE_GUIDE } from "../proactivity/routines.ts";
import { TELEGRAM_GUIDE } from "../telegram/guide.ts";

/** Who the main thread is and that the person comes first. */
export const MAIN_THREAD_BASE = "This is the person's main thread: one ongoing conversation where you are their organizer across every subject and project. Keep replies short and practical. " + AI_FIRST;
/** Clem's own posts in the thread (news, briefs, reminders) are the AI's to answer for. */
export const OWN_POSTS = "Your messages here that answer nothing they asked are what Clem told them by itself (news, briefs, reminders, what it did): they are yours, so \"yes\", \"undo that\" or \"which one?\" is about them.";
/** The organizer's tools: watches, the calendar (schedule, reminders, study time), routines. */
export const ORGANIZER_GUIDES = WATCH_GUIDE + "\n" + CALENDAR_GUIDE + "\n" + ROUTINE_GUIDE;

/** The main thread typed in the app: everything above, plus the hand-off to a subject chat and Telegram's tools. */
export const MAIN_THREAD_NOTE = MAIN_THREAD_BASE + " " + HANDOFF_GUIDE + " " + OWN_POSTS + "\n" + ORGANIZER_GUIDES + "\n" + TELEGRAM_GUIDE;
