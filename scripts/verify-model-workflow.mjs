import {mockLocalStorage} from './fixture-local-storage.mjs';
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import assert from "node:assert/strict";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5198, strictPort: true },
});
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
    }),
    requests = [];
  await page.addInitScript(() => {
    const listeners = new Set();
    window.requests = [];
    window.mowrDesktop = {
      onAuth: () => () => {},
      onAttachment: () => () => {},
      onChat: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      invoke: async (r) => {
        window.requests.push(r);
        if (r.action === "essentialSync")
          return { skills: r.skills, notes: r.notes };
        if (r.action === "memoryList") return { enabled: true, records: [] };
        if (r.action === "folders") return [];
        if (r.action === "securityInfo")
          return {
            email: "test@example.com",
            verified: true,
            factors: [],
            google: true,
          };
        if (r.action === "telegramStatus") return { connected: false };
        if (r.action === "chat") {
          setTimeout(() => {
            for (const fn of listeners) {
              fn({id:r.id,type:'artifact',scope:r.scope,file:{id:'generated-pdf',name:'Charged rods.pdf',type:'application/pdf',size:24000,created:Date.now()}});
              fn({
                id: r.id,
                type: "delta",
                text: "Based on your local source.",
              });
              fn({ id: r.id, type: "done" });
            }
          }, 20);
          return { started: true };
        }
        return {};
      },
    };
  });
  await page.route("**/fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<!doctype html><div class="desktop-titlebar"></div><div class="desktop-content"><div id="root"></div></div><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/revamp.css"><link rel="stylesheet" href="/src/production.css"><link rel="stylesheet" href="/src/desktop/desktop.css">',
    }),
  );
  await page.route("**/api/**", (r) => {
    requests.push({ url: r.request().url(), method: r.request().method() });
    const path = new URL(r.request().url()).pathname;
    return r.fulfill({
      json: path.endsWith("drive/files")
        ? { files: [] }
        : path.endsWith("auth/session")
          ? {
              user: { id: "fixture-owner", name: "Test" },
              database: false,
              storage: false,
              auth: true,
              drive: true,
            }
          : path.endsWith("models")
            ? [
                {
                  id: "gpt-6-astra",
                  reasoningEfforts: ["low","medium","high","xhigh","max","ultra"].map(reasoningEffort=>({reasoningEffort,description:reasoningEffort})),
                  defaultReasoningEffort: "low",
                  name: "Astra",
                  provider: "OpenAI",
                  connected: true,
                  context: 32000,
                  specialties: [],
                  tools: [],
                },
                ...["Sol", "Luna", "Terra", "GPT-5.5"].map(name=>({id:name,name,connected:true,provider:"OpenAI",context:32000,specialties:[],tools:[]})),
              ]
            : {},
    });
  });
  await mockLocalStorage(page);
  await page.goto("http://127.0.0.1:5198/fixture");
  await page.evaluate(async () => {
    const { default: RefreshRuntime } = await import("/@react-refresh");
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const store = await import("/src/store.ts");
    store.setStorageNamespace("fixture-owner");
    await store.saveState({
      ...store.emptyState,
      chats: [
        {
          id: "chat-fixture",
          title: "Research plan",
          spaceId: null,
          updated: 1,
          messages: [{id:"user-message",role:"user",content:"Help me understand the experiment."},
            {
              id: "message-fixture",
              role: "assistant",
              content: "Review the steps.",
              plan: {
                id: "plan-fixture",
                goal: "Research",
                lead: "gpt-6-astra",
                approved: false,
                revision: 1,
                tasks: Array.from({ length: 4 }, (_, i) => ({
                  id: `step-${i + 1}`,
                  title: `Step title ${i + 1}`,
                  instructions: "Read the source evidence.",
                  output: "A sourced summary",
                  model: "gpt-6-astra",
                  dependsOn: [],
                  status: "pending",
                })),
              },
            },
          ],
        },
      ],
      spaces: [
        {
          id: "space-test",
          kind: "project",
          name: "Local research",
          description: "",
          memory: "",
          sources: [],
        },
      ],
    });
    location.hash = "/";
    const { default: React } = await import(
      "/node_modules/.vite/deps/react.js"
    );
    const { default: ReactDOM } = await import(
      "/node_modules/.vite/deps/react-dom_client.js"
    );
    const { default: App } = await import("/src/App.tsx");
    ReactDOM.createRoot(document.getElementById("root")).render(
      React.createElement(App),
    );
  });
  await page
    .getByRole("button", { name: "Research plan", exact: true })
    .click();
  assert.equal(
    await page
      .locator(".plan-steps input,.plan-steps textarea,.plan-steps select")
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Edit step 1", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Review the experiment");
  await page
    .getByLabel("Instructions", { exact: true })
    .fill("Check all measurements.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page
    .getByRole("heading", { name: "Review the experiment", exact: true })
    .waitFor();
  await page
    .locator(".plan-steps .model-selector")
    .first()
    .getByRole("button", { name: "Reasoning effort", exact: true })
    .click();
  await page.getByRole("slider").press("ArrowRight");
  await page.getByRole("slider").press("ArrowRight");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  assert.ok(
    (await page.locator(".plan-steps .model-selector").first().innerText())
      .toLowerCase()
      .includes("high"),
  );
  await page.screenshot({ path: "artifacts/plan-editor.png", fullPage: true });
  assert.equal(await page.locator('.message-author,.artifact-actions,.chat-actions').count(),0);
  await page.getByRole('button',{name:'Chat options for Research plan',exact:true}).click();
  await page.getByRole('button',{name:'Pin chat',exact:true}).click();
  await page.getByRole('button',{name:'Chat options for Research plan',exact:true}).click();
  await page.getByRole('button',{name:'Unpin chat',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.chat-options:popover-open').count(),0);
  const bubble=await page.locator('.message.user .message-text').boundingBox();
  const messages=await page.locator('.messages').boundingBox();
  assert.ok(bubble.width<messages.width*.8);
  assert.ok(Math.abs(bubble.x+bubble.width-messages.x-messages.width)<2);
  await page.screenshot({path:'artifacts/conversation-layout.png',fullPage:true});
  await page.getByRole('button',{name:'Chat options for Research plan',exact:true}).click();
  await page.getByRole('button',{name:'Delete chat',exact:true}).click();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await page.getByRole("button",{name:"Research plan",exact:true}).waitFor({state:"detached"});
  assert.equal(
    await page
      .getByRole("button", { name: "Research plan", exact: true })
      .count(),
    0,
  );
  await page.locator(".greeting-row").waitFor();
  await page.getByRole("button", { name: "Choose model", exact: true }).click();
  await page.screenshot({ path: "artifacts/model-picker.png", fullPage: true });
  await page.getByRole('button',{name:'Astra',exact:true}).click();
  assert.equal(await page.getByRole('dialog',{name:'Select model'}).count(),0);
  await page.getByRole('button',{name:'Reasoning effort',exact:true}).click();
  await page.getByRole('slider').press('End');
  assert.equal(await page.getByRole('slider').getAttribute('aria-valuetext'),'Ultra');

  await page.waitForTimeout(280);
  assert.ok(parseFloat(await page.locator('.effort-fill').evaluate(el=>getComputedStyle(el).width))>100);
  assert.equal(await page.locator('.reasoning-ink path').count(),4);
  assert.equal(await page.locator('.effort-fill').evaluate(el=>getComputedStyle(el).overflow),'hidden');
  assert.equal(await page.locator('.effort-fill').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(233, 232, 226)');
  const ink=page.locator('.reasoning-ink path').first();
  const before=await ink.getAttribute('d');
  await page.waitForTimeout(750);
  assert.notEqual(await ink.getAttribute('d'),before);
  await page.screenshot({path:'artifacts/reasoning-picker.png'});
  const frames=[];
  for (const phase of ['gathering','resolved','unfolding']) {
    await page.waitForFunction(phase=>document.querySelector('.reasoning-ink')?.dataset.phase===phase,phase);
    await page.waitForTimeout(550);
    frames.push(await page.locator('.reasoning-ink').evaluate(el=>el.outerHTML));
    await page.locator('.effort-panel').screenshot({path:`artifacts/reasoning-${phase}.png`});
  }
  const strip=await browser.newPage({viewport:{width:700,height:240}});
  await strip.setContent(`<body style="background:#292927;color:#ddd;font:13px sans-serif;padding:20px;display:flex;gap:20px">${frames.map((svg,i)=>`<div><p>${['Gather','Resolve','Unfold'][i]}</p><div style="width:200px;height:24px;background:#e9e8e2;border-radius:12px;overflow:hidden">${svg}</div></div>`).join('')}<style>svg{width:200px;height:24px;fill:#72726b;opacity:.65}</style>`);
  await strip.screenshot({path:'artifacts/reasoning-sequence.png'});
  await strip.close();
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.waitForFunction(()=>document.querySelector('.reasoning-ink')?.dataset.motion==='still');
  const poster=await ink.getAttribute('d');
  await page.waitForTimeout(180);
  assert.equal(await ink.getAttribute('d'),poster);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'Reset reasoning to model default'}).click();
  assert.equal(await page.getByRole('slider').getAttribute('aria-valuetext'),'Light');
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:860,height:600});
  await page.getByRole('button',{name:'Choose model',exact:true}).click();
  const bounds=await page.getByRole('dialog',{name:'Select model'}).boundingBox();
  assert.ok(bounds.width<=264 && bounds.y>=0 && bounds.y+bounds.height<=600);
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:960});
  await page.locator('.composer textarea').fill('Make a PDF about charged rods');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.locator('.message.assistant .document-card').getByText('Charged rods.pdf',{exact:true}).waitFor();
  assert.equal(await page.locator('.message.assistant .document-card').count(),1);
  await page.getByText('Based on your local source.',{exact:true}).waitFor();
  console.log(
    "PASS popup task edits, per-step reasoning selection, deletion and synced-model picker",
  );
} finally {
  await browser.close();
  await server.close();
}
