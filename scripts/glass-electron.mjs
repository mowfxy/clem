// Opens the real desktop build in a throwaway copy, with its own user data folder, and photographs the whole window with
// the operating system's capture so Windows' caption buttons are in the picture. It never touches an installed Clem or
// its sign-in. Past the welcome screen it answers the window's requests with scripted data, so no account is needed.
//   node scripts/glass-electron.mjs [out]
import { _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { workspace } from "./verify/local-power-fixture.mjs";

const out = process.argv[2] || "test-results/glass-electron";
await mkdir(out, { recursive: true });
const userData = await mkdtemp(join(tmpdir(), "clem-glass-"));
const app = await electron.launch({ args: [resolve("desktop-dist/main.cjs"), "--user-data-dir=" + userData], timeout: 30000 });
const log = [];
// A chat long enough to scroll under the top bar, with a file to open beside it.
const paragraph = "Osmosis moves water across a selectively permeable membrane toward the side with more solute, so a potato in pure water gains mass until the pressure balances. ".repeat(4);
const long = { id: "c-long", title: "Long chat under the top bar", spaceId: null, updated: Date.now(), messages: [
  { id: "l0", role: "user", content: "Explain osmosis in detail.", at: Date.now() },
  ...Array.from({ length: 10 }, (_, i) => ({ id: "l" + (i + 1), role: "assistant", content: paragraph, at: Date.now(), attachments: i === 9 ? ["syllabus"] : undefined })),
] };
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => log.push("page error: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") log.push("console: " + m.text().slice(0, 200)); });
  const capture = async (name) => {
    await page.waitForTimeout(1600);
    const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.isVisible()) || BrowserWindow.getAllWindows()[0];
      win.focus();
      const [w, h] = win.getSize(), sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize: { width: w, height: h } });
      const me = sources.find((s) => s.id === win.getMediaSourceId());
      return me ? me.thumbnail.toPNG().toString("base64") : null;
    });
    if (png) await writeFile(`${out}/${name}.png`, Buffer.from(png, "base64"));
    else { log.push("window capture unavailable for " + name); await page.screenshot({ path: `${out}/${name}.png` }); }
  };
  await page.getByRole("heading", { name: "Welcome to Clem." }).waitFor();
  await capture("welcome");

  // Scripted answers from here on, so the real window can show the workspace: the same page, served by a stand-in for
  // the app's protocol handler, with a workspace held in memory.
  await app.evaluate(async ({ app: electronApp, ipcMain, net, protocol, BrowserWindow }, workspace) => {
    const { join } = process.getBuiltinModule("path"), { pathToFileURL } = process.getBuiltinModule("url");
    const root = join(electronApp.getAppPath(), "..", "dist"), user = { id: "tour", email: "sam@example.com", name: "Sam" };
    const status = { configured: true, user, setup: { step: 4, username: "sam", displayName: "Sam", memory: true }, entitlement: { active: true, reason: "" } };
    let state = workspace;
    ipcMain.removeHandler("clem:request");
    ipcMain.handle("clem:request", (_event, r) => {
      if (r.action === "status") return status;
      if (r.action === "essentialSync") return { skills: r.skills, notes: r.notes };
      if (r.action === "providerAccounts") return { accounts: [], active: null, autoSwitch: false };
      if (r.action === "memoryAll") return { enabled: true, records: [] };
      if (r.action === "folders" || r.action === "foldersAll" || r.action === "folderChanges") return [];
      return {};
    });
    protocol.unhandle("clem");
    protocol.handle("clem", async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/api/auth/session") return Response.json({ user, database: false, auth: true, storage: false, drive: true, scheduler: false });
      if (url.pathname === "/api/local/state") { if (request.method === "PUT") { state = await request.json(); return Response.json({ ok: true }); } return Response.json(state); }
      if (url.pathname.startsWith("/api/local/files/")) return new Response("Biology 101 covers cells, membranes, osmosis and genetics.");
      if (url.pathname.startsWith("/api/")) return Response.json({});
      return net.fetch(pathToFileURL(join(root, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname))).toString());
    });
    BrowserWindow.getAllWindows()[0].webContents.reload();
  }, { ...workspace, skills: [], visuals: [], automations: [], memory: "", quiet: false, plans: [], chats: [long, ...workspace.chats] });
  await page.locator(".greeting-row").waitFor({ timeout: 20000 }).catch((e) => log.push("workspace did not open: " + String(e.message).split("\n")[0]));
  await capture("home");
  for (const [name, label] of [["subjects", "Subjects"], ["files", "Files"]]) {
    await page.locator(".sidebar .nav-item", { hasText: label }).click({ timeout: 4000 }).catch((e) => log.push(String(e.message).split("\n")[0]));
    await capture(name);
  }
  await page.locator(".profile-settings").click({ timeout: 4000 }).catch(() => {});
  await capture("settings");
  await page.keyboard.press("Escape");
  const topBar = async (suffix) => {
    await page.locator(".history-title", { hasText: "Long chat" }).click({ timeout: 4000 }).catch((e) => log.push(String(e.message).split("\n")[0]));
    await page.waitForTimeout(600);
    await page.evaluate(() => { const w = document.querySelector(".workspace"); w.scrollTop = w.scrollHeight * 0.4; });
    await capture("top-chat" + suffix);
    const reachable = await page.evaluate(() => { const b = document.querySelector(".workspace-top button"); if (!b) return "no button"; const r = b.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(".workspace-top") ? "ok" : "covered"; });
    log.push("top bar button" + suffix + ": " + reachable);
    await page.locator(".sidebar .nav-item", { hasText: "Subjects" }).click({ timeout: 4000 }).catch(() => {});
    await page.locator("main").getByText("Biology 101", { exact: true }).first().click({ timeout: 4000 }).catch((e) => log.push(String(e.message).split("\n")[0]));
    await page.waitForTimeout(500);
    await page.evaluate(() => { const w = document.querySelector(".workspace"); w.scrollTop = 200; });
    await capture("top-subject" + suffix);
    await page.locator(".history-title", { hasText: "Long chat" }).click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.evaluate(() => { const w = document.querySelector(".workspace"); w.scrollTop = w.scrollHeight; });
    await page.getByText("Biology 101 syllabus.txt").last().click({ timeout: 4000 }).catch((e) => log.push("file card: " + String(e.message).split("\n")[0]));
    await page.waitForTimeout(700);
    await page.evaluate(() => { const w = document.querySelector(".workspace"); w.scrollTop = w.scrollHeight * 0.5; });
    await capture("top-file-panel" + suffix);
    await page.keyboard.press("Escape");
  };
  await topBar("");
  await page.evaluate(() => { localStorage.setItem("clem-theme", "dark"); location.reload(); });
  await page.waitForTimeout(800);
  await page.locator(".sidebar .nav-item").first().click({ timeout: 8000 }).catch((e) => log.push("dark workspace: " + String(e.message).split("\n")[0]));
  await capture("home-dark");
  await page.locator(".profile-settings").click({ timeout: 4000 }).catch(() => {});
  await capture("settings-dark");
  await page.keyboard.press("Escape");
  await topBar("-dark");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 760));
  await page.keyboard.press("Escape");
  await capture("narrow");
} finally {
  console.log(log.length ? log.slice(0, 20).join("\n") : "no problems logged");
  await app.close().catch(() => {});
  await rm(userData, { recursive: true, force: true }).catch(() => {});
}
