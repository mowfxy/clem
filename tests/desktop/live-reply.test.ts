import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveScreen, liveText, NOTE_HOLD } from "../../desktop/live-reply.ts";

/** A screen and everything it showed, piece by piece. */
const screen = () => {
  const pieces: string[] = [];
  return { pieces, screen: new LiveScreen((text) => pieces.push(text)), shown: () => pieces.join("") };
};
/** Streams `text` in small pieces, the first one opening a new message unless it continues one. */
const stream = (s: LiveScreen, text: string, continues = false, size = 7) => {
  for (let at = 0; at < text.length; at += size) s.partial(text.slice(at, at + size), at === 0 && !continues);
};

test("a long reply streams while it is written and is never shown twice", () => {
  const { screen: s, pieces, shown } = screen();
  const reply = "The derivative of x² is 2x. ".repeat(30).trim();
  s.step();
  stream(s, reply.slice(0, 400));
  assert.ok(pieces.length > 1, "text arrives before the reply is finished");
  assert.ok(reply.startsWith(shown()));
  stream(s, reply.slice(400), true);
  s.reply(reply);
  s.answer(reply);
  assert.equal(shown(), reply);
});

test("a short reply shows at the end of its step, and a reply that did not stream shows whole", () => {
  const { screen: s, pieces, shown } = screen();
  s.step();
  stream(s, "Hello there.");
  assert.equal(pieces.length, 0, "held: it could still be a note before a tool");
  s.reply("Hello there.");
  s.answer("Hello there.");
  assert.equal(shown(), "Hello there.");
  const other = screen();
  other.screen.step();
  other.screen.reply("No partial events came.");
  other.screen.answer("No partial events came.");
  assert.equal(other.shown(), "No partial events came.");
});

test("an agent's short note before a web search never shows; only the reply does", () => {
  const { screen: s, shown } = screen();
  const reply = "Here are three current videos on Fourier series. ".repeat(8).trim();
  s.step();
  stream(s, "I'll search for that.");
  stream(s, reply);
  s.reply(reply);
  s.answer(reply);
  assert.equal(shown(), reply);
});

test("tool requests never show; the lead-in shows once and the next step is its own paragraph", () => {
  const { screen: s, shown } = screen();
  const request = 'Let me calculate that.\n{"kinetra":{"action":"call","module":"clem","fn":"integrateExpression","args":["' + "x".repeat(NOTE_HOLD * 2) + '"]}}';
  s.step();
  stream(s, request);
  assert.equal(shown(), "Let me calculate that.");
  s.reply(request);
  assert.equal(shown(), "Let me calculate that.");
  s.step();
  stream(s, "The integral is x³/3.");
  s.reply("The integral is x³/3.");
  s.answer("The integral is x³/3.");
  assert.equal(shown(), "Let me calculate that.\n\nThe integral is x³/3.");
  // A bare request shows nothing at all.
  const bare = screen();
  bare.screen.step();
  stream(bare.screen, '{"kinetra":{"action":"help"}}' + " ".repeat(NOTE_HOLD));
  bare.screen.reply('{"kinetra":{"action":"help"}}');
  assert.equal(bare.shown(), "");
});

test("a lead-in kept as the answer (no calls left, or broken requests) is not shown again", () => {
  const { screen: s, shown } = screen();
  const broken = 'Here is the summary of the circuit.\n{"kinetra":{"action":"pdf","sections":[{"heading":"Q1"';
  s.step();
  s.reply(broken);
  s.answer("Here is the summary of the circuit.");
  assert.equal(shown(), "Here is the summary of the circuit.");
});

test("Messages stream events give the reply text, a mark for each new message, and nothing from inside a tool", () => {
  const got: [string, boolean][] = [];
  const read = liveText((text, fresh) => got.push([text, fresh]));
  const delta = (text: string, parent: string | null = null) => ({ type: "stream_event", parent_tool_use_id: parent, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
  read({ type: "stream_event", event: { type: "message_start", message: {} } });
  read(delta("I'll "));
  read(delta("search."));
  read({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{}" } } });
  read(delta("nested search text", "toolu_1"));
  read({ type: "assistant", message: { content: [{ type: "text", text: "I'll search." }] } });
  read({ type: "stream_event", event: { type: "message_start", message: {} } });
  read(delta("Found it."));
  assert.deepEqual(got, [["I'll ", true], ["search.", false], ["Found it.", true]]);
});

test("an answer taken back is shown again in full when it comes back as the answer", () => {
  const { screen: s, shown, pieces } = screen();
  s.step();
  s.reply("The answer is 4.");
  s.retract();
  pieces.length = 0;
  s.answer("The answer is 4.");
  assert.equal(shown(), "The answer is 4.", "no paragraph break and not skipped as already shown");
});
