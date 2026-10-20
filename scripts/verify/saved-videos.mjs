// Browser check for saving YouTube videos and playlists, behind a scripted YouTube: a video saved from the Files page
// keeps its transcript as a file; a playlist saved in a subject gets a folder of its own; a video with no captions is
// kept and marked so; the viewer plays it beside its transcript; and a chat about a saved video sends the transcript to
// the model through the ordinary file sources. Screenshots go to artifacts/saved-videos-*.png.
// YouTube itself is not reachable from the check, so thumbnails and the player are drawn stand-ins.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { openFixture } from "./local-power-fixture.mjs";

await mkdir("artifacts", { recursive: true });
const youtubeScript = () => {
  const lines = (topic) => Array.from({ length: 14 }, (_, i) => `<text start="${i * 21}" dur="20">${topic[i % topic.length]}</text>`).join("");
  const videos = {
    "osMo5isTon1": { title: "Osmosis and tonicity, explained", channel: "Cell Lab", durationSec: 612, topic: ["Osmosis is the movement of water across a selectively permeable membrane.", "Water moves toward the side with more dissolved solute.", "In a hypotonic solution a plant cell swells until the wall pushes back.", "That pressure is called turgor, and it keeps the plant upright.", "An animal cell has no wall, so in pure water it can burst."] },
    "kReBsCyc1e2": { title: "The Krebs cycle in ten minutes", channel: "Cell Lab", durationSec: 655, topic: ["The Krebs cycle runs in the mitochondrial matrix.", "Each turn starts when acetyl-CoA joins oxaloacetate to make citrate.", "Carbon leaves the cycle as carbon dioxide.", "The cycle's main products are NADH and FADH2, which feed the electron transport chain."] },
    "mEmBr4neX03": { title: "Membrane transport: channels and pumps", channel: "Cell Lab", durationSec: 498, topic: ["Small non-polar molecules slip straight through the bilayer.", "Ions need channel proteins to cross.", "The sodium-potassium pump spends ATP to move ions against their gradient."] },
    "nOcApT1onz4": { title: "Lab safety walkthrough", channel: "Cell Lab", durationSec: 241, none: true },
  };
  window.youtubeCalls = [];
  let real;
  Object.defineProperty(window, "clemDesktop", { configurable: true, get: () => real, set: (bridge) => {
    const invoke = bridge.invoke;
    real = { ...bridge, invoke: async (r) => {
      if (r.action === "youtubePlaylist") {
        window.youtubeCalls.push(r);
        await new Promise((ok) => setTimeout(ok, 600));
        return { id: r.id, title: "Cell biology, unit 2", videos: ["kReBsCyc1e2", "mEmBr4neX03", "nOcApT1onz4"].map((id) => ({ id, title: videos[id].title, channel: videos[id].channel, durationSec: videos[id].durationSec })) };
      }
      if (r.action === "videoCaptions" && r.source === "youtube") {
        window.youtubeCalls.push(r);
        await new Promise((ok) => setTimeout(ok, 900));
        const v = videos[r.id];
        if (!v) return { source: "youtube", id: r.id, transcript: "", error: "YouTube didn't return this video. It may have been removed." };
        if (v.none) return { source: "youtube", id: r.id, title: v.title, channel: v.channel, durationSec: v.durationSec, transcript: "", error: "This video has no captions, and its owner hasn't turned on automatic ones." };
        const { stamp } = await import("/core/captions.ts");
        const cues = [...lines(v.topic).matchAll(/start="(\d+)"[^>]*>([^<]+)</g)].map((m) => ({ start: Number(m[1]), text: m[2] }));
        const paragraphs = []; let from = -Infinity, words = [];
        for (const c of cues) { if (c.start - from >= 30) { if (words.length) paragraphs.push(`[${stamp(from)}] ${words.join(" ")}`); from = c.start; words = []; } words.push(c.text); }
        if (words.length) paragraphs.push(`[${stamp(from)}] ${words.join(" ")}`);
        return { source: "youtube", id: r.id, title: v.title, channel: v.channel, durationSec: v.durationSec, transcript: paragraphs.join("\n"), language: "English", auto: r.id === "mEmBr4neX03" };
      }
      return invoke(r);
    } };
  } });
};

// Drawn stand-ins for YouTube's pictures and player, which the check cannot reach.
const palette = { osMo5isTon1: ["#2f6f73", "#9fd3c7"], kReBsCyc1e2: ["#7a4b2a", "#f2b880"], mEmBr4neX03: ["#3d4f8a", "#a9b8f0"], nOcApT1onz4: ["#5b5b5b", "#cfcfcf"] };
const thumb = (id) => { const [a, b] = palette[id] || ["#444", "#999"]; return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><circle cx="235" cy="70" r="52" fill="#ffffff22"/><circle cx="90" cy="130" r="34" fill="#00000022"/><rect x="24" y="24" width="120" height="10" rx="5" fill="#ffffffaa"/><rect x="24" y="42" width="80" height="8" rx="4" fill="#ffffff77"/></svg>`; };

const browser = await chromium.launch();
const { page, errors, close } = await openFixture(browser, { port: 5201, initScripts: [youtubeScript], viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
await page.route("https://i.ytimg.com/**", (r) => { const id = new URL(r.request().url()).pathname.split("/")[2]; return r.fulfill({ contentType: "image/svg+xml", body: thumb(id) }); });
await page.route("https://www.youtube-nocookie.com/**", (r) => r.fulfill({ contentType: "text/html", body: `<body style="margin:0;background:#000;display:grid;place-items:center;height:100vh;font:14px system-ui;color:#bbb"><div style="text-align:center"><svg width="68" height="48" viewBox="0 0 68 48"><path d="M66.5 7.7A8.5 8.5 0 0 0 60.5 1.7C55.2.3 34 .3 34 .3S12.8.3 7.5 1.7A8.5 8.5 0 0 0 1.5 7.7C0 13 0 24 0 24s0 11 1.5 16.3a8.5 8.5 0 0 0 6 6C12.8 47.7 34 47.7 34 47.7s21.2 0 26.5-1.4a8.5 8.5 0 0 0 6-6C68 35 68 24 68 24s0-11-1.5-16.3Z" fill="#f00"/><path d="M45 24 27 14v20z" fill="#fff"/></svg><p>YouTube player (stand-in)</p></div></body>` }));
const shot = (name) => page.screenshot({ path: `artifacts/saved-videos-${name}.png` });
try {
  // Files page: save one video, with a preview of what the link is.
  await page.evaluate(() => { location.hash = "/app/files"; });
  await page.getByRole("button", { name: "Save from YouTube" }).first().click();
  const dialog = page.locator("dialog.yt-save");
  await dialog.getByRole("textbox").fill("https://youtu.be/osMo5isTon1?t=42");
  await dialog.locator(".yt-save-preview img").waitFor();
  await dialog.locator("select").selectOption({ label: "Biology 101" });
  await shot("1-save-dialog");
  await dialog.getByRole("button", { name: "Save video" }).click();
  await dialog.locator(".yt-save-progress").waitFor();
  await shot("2-saving");
  await dialog.waitFor({ state: "detached" });
  await page.getByText("Saved “Osmosis and tonicity, explained” with its transcript.").waitFor();

  // The saved video is an ordinary Markdown file holding the transcript, in Biology 101, used as a source there.
  // The workspace is written a moment after a change (SAVE_MS in src/App.tsx).
  await page.evaluate(async () => { const store = await import("/src/store.ts"); for (let i = 0; i < 50 && !(await store.loadState()).files.some((x) => x.video?.id === "osMo5isTon1"); i++) await new Promise((ok) => setTimeout(ok, 100)); });
  const kept = await page.evaluate(async () => {
    const store = await import("/src/store.ts");
    const state = await store.loadState();
    const f = state.files.find((x) => x.video?.id === "osMo5isTon1");
    return { file: f, text: await (await store.getBlob(f.id)).text(), source: state.spaces[0].sources.includes(f.id) };
  });
  assert.equal(kept.file.type, "text/markdown");
  assert.equal(kept.file.name, "Osmosis and tonicity, explained.md");
  assert.equal(kept.file.spaceId, "bio");
  assert.equal(kept.file.video.captions, "own");
  assert.ok(kept.source, "a saved video is a source of its subject, like an upload");
  assert.match(kept.text, /^# Osmosis and tonicity, explained\n/);
  assert.match(kept.text, /Link: https:\/\/www\.youtube\.com\/watch\?v=osMo5isTon1/);
  assert.match(kept.text, /## Transcript\n\n\[00:00\] Osmosis is the movement of water/);

  // The same video again is not stored twice.
  await page.getByRole("button", { name: "Save from YouTube" }).first().click();
  await dialog.getByRole("textbox").fill("https://www.youtube.com/watch?v=osMo5isTon1");
  await dialog.locator("select").selectOption({ label: "Biology 101" });
  await dialog.getByRole("button", { name: "Save video" }).click();
  await page.getByText("That video is already saved here.").waitFor();

  // A subject: save a playlist into a folder of its own; the video without captions is kept and marked.
  await page.evaluate(() => { location.hash = "/app/space/bio"; });
  await page.getByRole("tab", { name: /^Files/ }).click();
  await page.locator(".sp-files-bar").getByRole("button", { name: "Add" }).click(); await page.getByRole("menuitem", { name: "YouTube video" }).click();
  await dialog.getByRole("textbox").fill("https://www.youtube.com/watch?v=kReBsCyc1e2&list=PLcellbio2unit");
  await dialog.getByRole("button", { name: "Whole playlist" }).waitFor();
  assert.equal(await dialog.locator("select").count(), 0, "a subject saves into itself");
  await dialog.getByRole("button", { name: "Save playlist" }).click();
  await dialog.locator(".yt-save-progress", { hasText: /of 3/ }).waitFor();
  await dialog.waitFor({ state: "detached" });
  await page.getByText(/Saved 3 videos from “Cell biology, unit 2”; 1 had no captions to read\./).waitFor();
  await page.locator(".sp-folder", { hasText: "Cell biology, unit 2" }).waitFor();
  await shot("3-subject-files");
  await page.locator(".sp-folder", { hasText: "Cell biology, unit 2" }).click();
  await page.locator(".sp-file", { hasText: "Lab safety walkthrough" }).getByText(/No transcript/).waitFor();
  await shot("4-subject-playlist-folder");
  await page.locator(".sp-path").getByRole("button", { name: "Files" }).click();
  await page.locator(".sp-kinds").getByRole("button", { name: /Videos/ }).click();
  assert.equal(await page.locator(".sp-found .sp-file").count(), 4, "Videos shows every video here, from every folder");
  await shot("5-subject-videos-filter");
  await page.locator(".sp-kinds").getByRole("button", { name: /^All/ }).click();

  // The viewer: the player beside the transcript; a time moves the player there.
  await page.locator(".sp-file-open", { hasText: "Osmosis and tonicity" }).click();
  const viewer = page.locator("dialog.yt-viewer");
  await viewer.locator(".yt-lines li").first().waitFor();
  await viewer.locator(".yt-lines button", { hasText: "00:42" }).click();
  assert.match(await viewer.locator("iframe").getAttribute("src"), /start=42&/);
  await shot("6-video-viewer");

  // Asking about it sends the transcript to the model through the subject's ordinary file sources.
  await viewer.getByRole("button", { name: "Ask about it" }).click();
  await page.locator(".composer textarea, textarea").first().fill("Why does a plant cell not burst in pure water?");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.requests.some((r) => r.action === "chat"));
  const sent = await page.evaluate(() => JSON.stringify(window.requests.filter((r) => r.action === "chat").at(-1)));
  assert.match(sent, /turgor, and it keeps the plant upright/, "the transcript reaches the model");
  assert.doesNotMatch(sent, /VIDEO TRANSCRIPTS:/, "it comes as a file, not through the separate link-captions path");

  // The Files page: grouped by when, list and cards, with a Videos filter.
  await page.evaluate(() => { location.hash = "/app/files"; });
  await page.locator(".fx-row").first().waitFor();
  await page.waitForTimeout(700);
  await shot("7-files-list");
  await page.getByRole("button", { name: "Cards" }).click();
  await page.locator(".fx-card").first().waitFor();
  await page.waitForTimeout(700);
  await shot("8-files-cards");
  await page.getByRole("button", { name: "List" }).click();

  // Narrow window: nothing spills sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no sideways scroll on a phone-sized window");
  await shot("9-files-narrow");
  assert.deepEqual(errors, []);
  console.log("saved videos: ok");
} finally {
  await close();
  await browser.close();
}
