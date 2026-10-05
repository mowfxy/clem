// Checks that a streamed answer does not rewrite the workspace on every token: the App coalesces saves, so a long
// scripted reply (hundreds of deltas) causes only a handful of workspace writes, and the last write holds the whole reply.
import { chromium } from "playwright";
import { openFixture } from "./local-power-fixture.mjs";

const reply = "Osmosis moves water across a membrane toward the side with more solute. ".repeat(80).trim();
const browser = await chromium.launch();
const fixture = await openFixture(browser, { replies: [reply] });
const { page, errors } = fixture;
let failed = false;
const check = (ok, what) => { console.log((ok ? "ok   " : "FAIL ") + what); if (!ok) failed = true; };
try {
  let writes = 0, last = null;
  page.on("request", (r) => { if (r.method() === "PUT" && r.url().endsWith("/api/local/state")) { writes++; last = r.postDataJSON(); } });
  await page.getByLabel("Your message").fill("Explain osmosis at length.");
  await page.getByLabel("Your message").press("Enter");
  const deltas = Math.ceil(reply.length / 24);
  await page.locator(".message.assistant .message-text", { hasText: reply.slice(-40) }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  console.log(`     ${deltas} streamed deltas, ${writes} workspace writes`);
  check(writes > 0, "the conversation was saved");
  check(writes < deltas / 4, "saves are coalesced while the answer streams");
  const saved = last?.chats?.flatMap((c) => c.messages).find((m) => m.role === "assistant" && m.content.includes(reply.slice(-40)));
  check(!!saved, "the last write holds the full reply");
  check(!errors.length, "no page errors" + (errors.length ? ": " + errors.join("; ") : ""));
} catch (error) {
  console.log("FAIL " + error.message);
  failed = true;
} finally {
  await fixture.close();
  await browser.close();
}
process.exit(failed ? 1 : 0);
