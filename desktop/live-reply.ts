import { toolRequests, brokenToolRequest, requestLead, shownLength } from "./kinetra-turn.ts";
import { mayBeTool } from "./codex.ts";

/**
 * Claude Code and Grok both print the Messages API stream (`stream_event` lines, with --include-partial-messages).
 * Returns a reader for those lines that passes on each piece of reply text as it is written, with `fresh` on the
 * first piece of every model message: one run can hold several (a note, a web search, then the reply). Text written
 * inside a tool (parent_tool_use_id) is never the reply. The authoritative reply is still the run's `result`.
 */
export function liveText(onText: (text: string, fresh: boolean) => void) {
  let fresh = true;
  return (event: any) => {
    if (event?.type !== "stream_event" || event.parent_tool_use_id) return;
    const inner = event.event;
    if (inner?.type === "message_start") fresh = true;
    else if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta" && typeof inner.delta.text === "string" && inner.delta.text) {
      onText(inner.delta.text, fresh);
      fresh = false;
    }
  };
}

/**
 * How much of a message is held before it streams. The screen only ever adds text, and an agent's note before a
 * tool ("I'll search for that.") is not part of its reply, so a message shows once it is clearly longer than such a
 * note; a note that is followed by another message before then never shows, as before streaming.
 */
export const NOTE_HOLD = 240;

/**
 * What of a Claude or Grok answer reaches the screen, as codex.ts does for ChatGPT: prose streams as it is written,
 * tool requests (and anything that may still become one) never show, a lead-in before a request shows once as its
 * own paragraph, and the text a step already showed is never sent again.
 */
export class LiveScreen {
  /** Whether anything is on screen yet: each later part of the answer starts its own paragraph. */
  private shown = false;
  /** The model message being written in this step, and how much of it is on screen. */
  private text = "";
  private delivered = 0;
  /** What the last finished step showed of its reply. */
  private last = "";
  private put: (text: string) => void;
  constructor(put: (text: string) => void) { this.put = put; }
  private show(end: number) {
    // Trailing blank space waits for the text after it; a message's leading blank lines never show.
    end = this.text.slice(0, end).trimEnd().length;
    const from = this.delivered || Math.max(0, this.text.search(/\S/));
    if (end <= from) return;
    this.put((this.shown && !this.delivered ? "\n\n" : "") + this.text.slice(from, end));
    this.delivered = end;
    this.shown = true;
  }
  /** A new step, or a retry of one: none of it is on screen yet. */
  step() {
    this.text = "";
    this.delivered = 0;
  }
  /** A piece of the model's message as it is written; `fresh` when it opens a new message. */
  partial(piece: string, fresh = false) {
    if (fresh) this.step();
    this.text += piece;
    if (this.text.length >= NOTE_HOLD && !mayBeTool(this.text)) this.show(shownLength(this.text));
  }
  /** The step's reply as the CLI reported it: the rest of it shows, or only its lead-in when it is a tool request. */
  reply(reply: string) {
    // Text shown from an earlier message of this step (a long note before a web search) stays as its own paragraph.
    if (!reply.startsWith(this.text.slice(0, this.delivered))) this.step();
    this.text = reply;
    const lead = toolRequests(reply) || brokenToolRequest(reply) ? requestLead(reply) : reply;
    this.show(lead ? reply.indexOf(lead) + lead.length : 0);
    this.last = reply.slice(0, this.delivered);
    this.step();
  }
  /** The loop's answer: shown unless the last step already showed it (its reply, or the lead-in kept as the answer). */
  answer(answer: string) {
    const text = answer.trim(), last = this.last.trim();
    if (!text || last.startsWith(text)) return;
    this.text = text;
    this.delivered = last && text.startsWith(last) ? last.length : 0;
    this.show(text.length);
  }
}
