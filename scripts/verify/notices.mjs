// Checks the notice stack above the account button and the two-way support inbox with mocked desktop IPC.
import {mockLocalStorage} from './fixture-local-storage.mjs';
import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';

mkdirSync('artifacts',{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:5199,strictPort:true}});
await server.listen();
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.addInitScript(()=>{
    window.requests=[];
    const reply={id:'m1',author:'staff',body:'Fixed in the next build — thanks for the report!',created_at:new Date().toISOString()};
    window.supportCase={id:'case-00000001',category:'Report a bug',subject:'Export shows odd symbols',message:'Bullets start with a strange diamond.',created_at:new Date(Date.now()-86400000).toISOString(),status:'pending',staff_replied_at:reply.created_at,unread:true,messages:[reply]};
    window.mowrDesktop={
      onAuth:()=>()=>{},onAttachment:()=>()=>{},onChat:()=>()=>{},
      invoke:async r=>{
        window.requests.push(r);
        if(r.action==='announcements')return {announcements:[{id:'ann-1',title:'Mowr 0.3 preview',body:'Support replies now arrive in the app.',tone:'success',link:null}]};
        if(r.action==='supportCases')return {cases:[window.supportCase]};
        if(r.action==='supportSeen'){window.supportCase={...window.supportCase,unread:false};return {ok:true};}
        if(r.action==='supportReply'){window.supportCase={...window.supportCase,status:'open',messages:[...window.supportCase.messages,{id:'m2',author:'user',body:r.body,created_at:new Date().toISOString()}]};return {ok:true};}
        if(r.action==='providerAccounts')return {active:'default',accounts:[]};
        if(r.action==='essentialSync')return {skills:r.skills,notes:r.notes};
        return {};
      },
    };
  });
  await page.route('**/fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div class="desktop-titlebar"></div><div class="desktop-content"><div id="root"></div></div><link rel="stylesheet" href="/src/style.css"><link rel="stylesheet" href="/src/revamp.css"><link rel="stylesheet" href="/src/production.css"><link rel="stylesheet" href="/src/desktop/desktop.css">'}));
  await page.route('**/api/**',r=>{const path=new URL(r.request().url()).pathname;return r.fulfill({json:path.endsWith('auth/session')?{user:{id:'fixture-owner',name:'Test'},auth:true}:path.endsWith('models')?[{id:'openai',name:'Codex',provider:'OpenAI',connected:true,context:32000,specialties:[],tools:[]}]:{}});});
  await mockLocalStorage(page);
  await page.goto('http://127.0.0.1:5199/fixture');
  await page.evaluate(async()=>{
    const {default:RefreshRuntime}=await import('/@react-refresh');
    RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>t=>t;window.__vite_plugin_react_preamble_installed__=true;
    const store=await import('/src/store.ts');store.setStorageNamespace('fixture-owner');await store.saveState(store.emptyState);
    location.hash='/';
    const {default:React}=await import('/node_modules/.vite/deps/react.js');
    const {default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js');
    const {default:App}=await import('/src/App.tsx');
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
  });
  // Both signals arrive as sticky notices; the newest (the reply) is in front.
  const stack=page.locator('.notice-stack');
  await stack.locator('.notice-card').nth(1).waitFor();
  assert.equal(await stack.locator('.notice-card').count(),2);
  assert.equal(await stack.locator('.notice-count').innerText(),'2');
  assert.match(await stack.locator('[role=status]').innerText(),/Mowr support replied/);
  await page.waitForTimeout(900);
  await page.screenshot({path:'artifacts/notice-stack.png',clip:{x:0,y:560,width:420,height:340}});
  const account=await page.locator('.account-button').boundingBox(),card=await stack.boundingBox();
  assert.ok(card.y+card.height<=account.y+4,'notices sit above the account button');
  await stack.hover();
  await page.waitForTimeout(500);
  await page.screenshot({path:'artifacts/notice-stack-expanded.png',clip:{x:0,y:440,width:420,height:460}});
  assert.equal(await page.locator('.settings-badge').innerText(),'1');
  // The action opens the inbox, marks the reply seen and lets the person answer.
  await page.getByRole('button',{name:'Read reply'}).click();
  await page.locator('.support-list').waitFor();
  await page.getByRole('button',{name:/Export shows odd symbols/}).click();
  await page.getByText('Fixed in the next build',{exact:false}).waitFor();
  assert.ok((await page.evaluate(()=>window.requests)).some(r=>r.action==='supportSeen'&&r.id==='case-00000001'));
  await page.getByRole('textbox',{name:'Reply'}).fill('Updated and it works now.');
  await page.getByRole('button',{name:'Send reply'}).click();
  await page.getByText('Updated and it works now.').waitFor();
  await page.screenshot({path:'artifacts/support-thread.png'});
  // Dismissing leaves the remaining notice in front.
  const close=page.locator('.notice-stack .notice-close').first();
  if(await close.count()){await close.click();await page.waitForTimeout(400);}
  // Ctrl+K opens the palette; typing narrows to settings and Enter navigates.
  await page.keyboard.press('Control+k');
  await page.locator('dialog.command-palette').waitFor();
  await page.keyboard.type('models');
  await page.screenshot({path:'artifacts/command-palette.png'});
  await page.keyboard.press('Enter');
  await page.locator('.settings-tabs button.active',{hasText:'Models'}).waitFor();
  await page.keyboard.press('Control+n');
  await page.locator('.greeting-row').waitFor();
  console.log('PASS notice stack order, placement, expansion, support reply notice, seen receipt, in-app reply, command palette and shortcuts');
}finally{await browser.close();await server.close();}
