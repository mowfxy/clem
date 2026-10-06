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
    window.activeAccount="default";
    window.recovery=false;
    window.mowrDesktop = {
      onAuth: () => () => {},
      onAttachment: () => () => {},
      onChat: (fn) => {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      invoke: async (r) => {
        window.requests.push(r);
        if(r.action==='providerAccountRetry')return {id:r.id,url:'https://auth.openai.com/codex/device',code:'RETRY-CODE'};
        if(r.action==='providerAccounts'&&window.recovery)return {active:'default',accounts:[{id:'22222222-2222-4222-8222-222222222222',connected:false,loginError:'Sign-in expired. Start again to get a new code.'}]};
        if(r.action==='providerAccounts')return {active:window.activeAccount,accounts:[{id:'default',connected:true,email:'personal@example.com',plan:'plus',checkedAt:Date.now(),usage:{rateLimitsByLimitId:{codex:{primary:{usedPercent:42,windowDurationMins:300,resetsAt:Date.now()/1000+9000},secondary:{usedPercent:18,windowDurationMins:10080,resetsAt:Date.now()/1000+86400}}}}},{id:'11111111-1111-4111-8111-111111111111',connected:true,email:'work@example.com',plan:'pro',usageError:'Usage is unavailable from the provider.'}]};
        if(r.action==='providerAccountSelect'){window.activeAccount=r.id;return {ok:true};}
        if(r.action==='claudeStatus')return {installed:true,connected:true,email:'me@example.com',plan:'max'};
        if(r.action==='grokStatus')return {installed:true,connected:true,models:['grok-4.7']};
        if(r.action==='cliAccounts'&&r.kind==='claude')return {active:window.claudeActive||'default',autoSwitch:true,accounts:[{id:'default',connected:true,email:'me@example.com',plan:'max',checkedAt:Date.now(),usage:{rateLimits:{primary:{usedPercent:64,windowDurationMins:300,resetsAt:Date.now()/1000+5000},secondary:{usedPercent:93,windowDurationMins:10080,resetsAt:Date.now()/1000+300000}}}},{id:'33333333-3333-4333-8333-333333333333',connected:true,email:'team@example.com',plan:'pro'}].concat(window.claudeAdded?[{id:'44444444-4444-4444-8444-444444444444',connected:false,pending:true}]:[])};
        if(r.action==='cliAccounts'&&r.kind==='grok')return {active:'default',autoSwitch:true,accounts:[{id:'default',connected:true,plan:'X Premium',checkedAt:Date.now(),usage:{rateLimits:{primary:{usedPercent:1,windowDurationMins:10080,resetsAt:Date.now()/1000+290000}}}}]};
        if(r.action==='cliAccountSelect'){window.claudeActive=r.id;return {ok:true};}
        if(r.action==='cliAccountAdd'){window.claudeAdded=true;return {id:'44444444-4444-4444-8444-444444444444',pending:true};}
        if(r.action==='providerAccountAdd')return {id:'22222222-2222-4222-8222-222222222222',url:'https://auth.openai.com/codex/device',code:'TEST-TEST'};
        if(r.action==='providerAccountStatus')return {connected:false};
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
            password: true,
          };
        if (r.action === "chat") {
          setTimeout(() => {
            for (const fn of listeners) {
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
      body: '<!doctype html><div class="desktop-titlebar"></div><div class="desktop-content"><div id="root"></div></div><link rel="stylesheet" href="/src/type.css"><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/revamp.css"><link rel="stylesheet" href="/src/production.css"><link rel="stylesheet" href="/src/desktop/desktop.css">',
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
                  id: "openai",
                  name: "Codex",
                  provider: "OpenAI",
                  connected: true,
                  context: 32000,
                  specialties: [],
                  tools: [],
                },
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
  await page.locator(".greeting-row").waitFor();
  assert.equal(
    await page.getByText("Download Mowr", { exact: true }).count(),
    0,
  );
  const bounds = await page.locator(".greeting-row").evaluate((el) =>
    Array.from(el.children).map((c) => {
      const r = c.getBoundingClientRect();
      return r.y + r.height / 2;
    }),
  );
  assert.ok(Math.abs(bounds[0] - bounds[1]) < 2, "Greeting aligns with logo");
  assert.equal(await page.locator(".sidebar .desktop-folder-panel").count(), 0);
  await page.evaluate(() => (location.hash = "/app/settings"));
  // Settings opens as a window over the page; General has no text fields.
  await page.locator("dialog.st-dialog[open]").waitFor();
  assert.equal(await page.locator(".st-body input:not([type=checkbox])").count(), 0);
  await page.locator(".st-nav").getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByRole("radiogroup", { name: "Choose your picture" }).waitFor();
  await page.getByRole("radio", { name: "Tide", exact: true }).click();
  assert.equal(await page.getByRole("radio", { name: "Tide", exact: true }).getAttribute("aria-checked"), "true");
  await page.locator(".st-input input").fill("Sam Rivera");
  await page.locator(".st-id-greeting").filter({ hasText: "Sam Rivera." }).waitFor();
  await page.locator(".st-input input").fill("Sam");
  await page.screenshot({
    path: "artifacts/settings-profile.png",
    fullPage: true,
  });
  for (const [name, button] of [
    ["Linked folders", "Manage folders"],
    ["Memory", "Open memory"],
  ]) {
    await page
      .locator(".st-nav")
      .getByRole("button", { name, exact: true })
      .click();
    assert.equal(await page.getByLabel("Space", { exact: true }).count(), 0);
    await page
      .locator(".st-body")
      .getByRole("button", { name: button, exact: true })
      .click();
    await page.locator(name==="Memory"?".settings-dialog .memory-panel":".settings-dialog .desktop-folder-panel").waitFor();
    await page.keyboard.press("Escape");
  }
  await page
    .locator(".st-nav")
    .getByRole("button", { name: "Security", exact: true })
    .click();
  assert.equal(await page.locator(".st-body input").count(), 0);
  await page
    .locator(".settings-action")
    .filter({
      has: page.getByRole("heading", { name: "Password", exact: true }),
    })
    .getByRole("button")
    .click();
  await page.locator("dialog input[name=current]").fill("fixture-old-password");
  await page.locator("dialog input[name=password]").fill("fixture-only-password");
  await page.locator("dialog input[name=confirm]").fill("fixture-only-password-typo");
  await page.getByRole("button", { name: "Change password" }).click();
  await page.getByRole("status").filter({ hasText: "do not match" }).first().waitFor();
  assert.equal(await page.evaluate(() => window.requests.filter((r) => r.action === "passwordChange").length), 0);
  await page.locator("dialog input[name=confirm]").fill("fixture-only-password");
  await page.getByRole("button", { name: "Change password" }).click();
  await page.getByRole("status").filter({ hasText: "Password changed" }).first().waitFor();
  const change = await page.evaluate(() => window.requests.find((r) => r.action === "passwordChange"));
  assert.equal(change.currentPassword, "fixture-old-password");
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "artifacts/settings-security.png",
    fullPage: true,
  });
  // The section scrolls inside the window; the rail and headline stay put.
  await page.locator(".st-body").evaluate((el) => {
    const spacer = document.createElement("div");
    spacer.id = "scroll-fixture";
    spacer.style.height = "1200px";
    el.appendChild(spacer);
    el.scrollTop = 400;
  });
  await page.waitForTimeout(100);
  const rail = await page.locator(".st-nav").boundingBox(), head = await page.locator(".st-head h1").boundingBox();
  assert.ok(rail.y > 0 && rail.y < 300 && head.y > 0 && head.y < 200, "Settings navigation stays visible while scrolling");
  await page.evaluate(() => document.getElementById("scroll-fixture").remove());
  await page.getByRole("button", { name: "Close settings" }).click();
  assert.equal(await page.locator("dialog.st-dialog").count(), 0);
  const brand = await page.locator(".sidebar>.brand").boundingBox();
  assert.ok(brand.y >= 0 && brand.y < 40, "Brand blends into window top");
  for (const width of [800, 1000, 1140, 1440, 1700]) {
    await page.setViewportSize({ width, height: 960 });
    const sidebar = await page.locator(".sidebar").boundingBox();
    const titlebar = await page.locator(".desktop-titlebar").boundingBox();
    assert.ok(Math.abs(titlebar.x - sidebar.x - sidebar.width) < 1, `Titlebar meets sidebar at ${width}px`);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => (location.hash = "/app"));
  await page.locator(".greeting-row").waitFor();
  assert.ok(
    await page
      .locator(".workspace")
      .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    "New chat fits viewport",
  );
  await page.screenshot({ path: "artifacts/new-chat-fit.png", fullPage: true });
  await page.evaluate(() => (location.hash = "/app/connectors"));
  await page.locator(".st-row", { hasText: "Google Drive" }).getByRole("button", { name: "Manage" }).click();
  await page.locator(".gd-picker").waitFor();
  await page.screenshot({ path: "artifacts/drive-dialog.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page.evaluate(() => (location.hash = "/app/settings"));
  await page
    .locator(".st-nav")
    .getByRole("button", { name: "Help & support", exact: true })
    .click();
  // Three kinds of request, each in its own popup; nothing is sent inline.
  const options = page.locator(".contact-options").getByRole("listitem");
  assert.equal(await options.count(), 3);
  await options.filter({ hasText: "Report a bug" }).click();
  await page.locator("dialog.contact-dialog").getByRole("heading", { name: "Report a bug" }).waitFor();
  await page.screenshot({
    path: "artifacts/contact-dialog.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await page.locator('.st-nav').getByRole('button',{name:'Models',exact:true}).click();
  await page.getByRole('tab',{name:/ChatGPT/}).click();
  await page.getByText('58% left',{exact:true}).waitFor();
  assert.equal(await page.getByRole('meter').count(),2);
  assert.equal(await page.locator('.st-nav button.active').innerText(),'Models');
  await page.waitForTimeout(450);
  await page.screenshot({path:'artifacts/settings-models.png'});
  await page.getByRole('button',{name:'Use',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.activeAccount),'11111111-1111-4111-8111-111111111111');
  // Claude and Grok have the same accounts, usage and switching as ChatGPT.
  await page.getByRole('tab',{name:/Claude/}).click();
  await page.getByText('7% left',{exact:true}).waitFor();
  assert.equal(await page.locator('.account-row').count(),2);
  await page.waitForTimeout(450);
  await page.screenshot({path:'artifacts/settings-models-claude.png'});
  await page.getByRole('button',{name:'Use',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.claudeActive),'33333333-3333-4333-8333-333333333333');
  await page.getByRole('button',{name:'Add account',exact:true}).click();
  await page.getByText('Waiting for browser sign-in',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>window.requests.some(r=>r.action==='cliAccountAdd'&&r.kind==='claude')));
  await page.getByRole('tab',{name:/Grok/}).click();
  await page.getByText('99% left',{exact:true}).waitFor();
  await page.waitForTimeout(450);
  await page.screenshot({path:'artifacts/settings-models-grok.png'});
  await page.getByRole('tab',{name:/ChatGPT/}).click();
  await page.getByRole('button',{name:'Add account',exact:true}).click();
  await page.getByRole('button',{name:'Continue with ChatGPT',exact:true}).waitFor();
  await page.screenshot({path:'artifacts/connect-account.png'});
  await page.getByRole('button',{name:'Continue with ChatGPT',exact:true}).click();
  await page.getByText('TEST-TEST',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(()=>window.recovery=true);
  await page.getByRole('button',{name:'Refresh connections'}).click();
  await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
  await page.screenshot({path:'artifacts/account-recovery.png'});
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByText('RETRY-CODE',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  // Every section has its drawing; still ones hold their pose (their lines keep boiling).
  {
   await page.locator('.st-nav').getByRole('button',{name:'Memory',exact:true}).click();
   await page.locator('.st-art svg').waitFor();
  }
  for(const tab of ['General','Security']){
   await page.locator('.st-nav').getByRole('button',{name:tab,exact:true}).click();
   const art=page.locator('.st-art svg');await art.waitFor();
   const before=await art.innerHTML();await page.waitForTimeout(600);assert.notEqual(await art.innerHTML(),before);
   await page.screenshot({path:'artifacts/settings-'+tab.toLowerCase()+'.png'});
   await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(400);const still=await art.innerHTML();await page.waitForTimeout(200);assert.equal(await art.innerHTML(),still);await page.emulateMedia({reducedMotion:'no-preference'});
  }
  await page.getByRole('button',{name:'Close settings'}).click();
  await page.evaluate(()=>location.hash='/app/visuals');
  assert.equal(await page.locator('.kinetra-grid').count(),0);
  await page.evaluate(()=>location.hash='/app/subjects');
  const importer=page.locator('.lib-actions').getByRole('button',{name:/^Import a (subject ZIP or )?study pack$/});
  await importer.waitFor();
  assert.equal(await page.locator('.lib-actions').getByRole('button').count(),2);
  const chooser=page.waitForEvent('filechooser');await importer.click();await chooser;
  await page.mouse.move(800,300);
  assert.ok(await importer.locator('svg path').count()>=2,'Import icon is drawn');
  await page.screenshot({path:'artifacts/subjects-import.png'});
  await page.setViewportSize({ width: 600, height: 900 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "No narrow screen overflow",
  );
  await page.evaluate(() => (location.hash = "/"));
  await page.locator(".greeting-row").waitFor();
  console.log(
    "PASS desktop default and hash routing, greeting alignment, settings scope panels, original profile selection and narrow layout",
  );
} finally {
  await browser.close();
  await server.close();
}
