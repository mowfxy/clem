// Development-only fixtures for previewing the portal without staff credentials.
const day=86400000,iso=(offset:number)=>new Date(Date.now()-offset).toISOString();
const names=[['ava@studio.co','ava','Ava Laurent'],['kenji@uni.ac.jp','kenji','Kenji Mori'],['sara.h@gmail.com','sarah','Sara Haddad'],['omar@lab.eg','omar_k','Omar Khaled'],['lena@proton.me','lena','Lena Fischer'],['dev@mowrai.com','mowr_dev','Mowr Dev'],['priya@college.edu','priya','Priya Nair'],['tom@hey.com','tomw','Tom Walsh']];
const plans=['free','free','free','free','free','owner','free','free'];
const steps=[4,4,2,4,0,4,3,4];
const people=names.map(([email,username,display_name],i)=>({id:`00000000-0000-4000-8000-00000000000${i}`,email,username,display_name,first_seen_at:iso((i*3+1)*day),last_seen_at:iso(i*4*3600000),setup_step:steps[i],suspended:i===7,suspended_until:i===7?iso(-3*day):null,cases:i%3,plan:plans[i],until:null}));
const cases=[
  {id:'case-7f1a2b3c',owner_id:people[0].id,category:'Report a bug',subject:'PPTX export shows odd symbols before bullets',message:'When I export my notes to slides every bullet starts with a question-mark diamond. Happens on every deck.',status:'open',priority:'high'},
  {id:'case-8e2d4c1a',owner_id:people[2].id,category:'Contact support',subject:'Can I use two ChatGPT accounts?',message:'I have a personal and a work account. Can Mowr switch between them automatically?',status:'pending',priority:'normal'},
  {id:'case-9a3b5d2e',owner_id:people[4].id,category:'Report a bug',subject:'Stuck on “Connect your AI”',message:'The Claude sign-in finishes in the browser but Mowr keeps waiting on the last setup step.',status:'open',priority:'urgent'},
  {id:'case-1b4c6e3f',owner_id:people[1].id,category:'Suggest a feature',subject:'Anki export for flashcards',message:'Would love to send subject flashcards straight to Anki.',status:'resolved',priority:'low'},
].map((c,i)=>({...c,created_at:iso((i+1)*day/2),updated_at:iso(i*3600000),email:people.find(p=>p.id===c.owner_id)!.email,username:people.find(p=>p.id===c.owner_id)!.username,replies:i%2,awaiting_staff:c.status==='open',assignee_id:null}));
const messages:Record<string,any[]>={'case-8e2d4c1a':[{id:'m1',author:'staff',author_name:'Mowr support',body:'Yes! Add both in Settings → Models, then turn on “Switch accounts automatically”.',created_at:iso(20*3600000)},{id:'m2',author:'note',author_name:'',body:'Point to the auto-switch docs once published.',created_at:iso(19*3600000)}]};
const audit=[['user.note',people[1].id,'Early tester'],['user.suspend',people[7].id,'Repeated spam in support · until 2026-09-27'],['case.reply',people[2].id,'case-8e2d4c1a'],['announcement.publish','a1','Mowr 0.3 preview']].map(([action,target,detail],i)=>({id:'audit'+i,actor_email:'m@mohamedmowafy.com',action,target,detail,created_at:iso(i*5*3600000)}));
const announcements=[{id:'a1',title:'Mowr 0.3 preview',body:'Support inbox, faster usage checks and smoother popups.',tone:'success',link:null,starts_at:iso(day),ends_at:iso(-6*day),archived:0,created_at:iso(day)}];

export async function demoApi(path:string,body?:any):Promise<any>{
  await new Promise(r=>setTimeout(r,250));
  if(body!==undefined){
    if(path==='/admin/announcements')announcements.unshift({id:'a'+Date.now(),...body,starts_at:iso(0),ends_at:body.days?iso(-body.days*day):null,archived:0,created_at:iso(0)});
    const reply=/^\/admin\/cases\/(.+)\/reply$/.exec(path);
    if(reply)(messages[reply[1]]??=[]).push({id:'m'+Date.now(),author:body.internal?'note':'staff',author_name:'Mowr support',body:body.body,created_at:iso(0)});
    return {ok:true};
  }
  const url=new URL(path,'https://x');
  if(path==='/admin/me')return {id:people[5].id,email:'m@mohamedmowafy.com',role:'owner',mfa:false,lemon:false,directory:false,requireMfa:false};
  if(path==='/admin/overview')return {users:people.length,newThisWeek:3,activeThisWeek:6,activeToday:4,suspended:1,setup:steps.reduce((a:any,s)=>(a[s]=(a[s]||0)+1,a),{}),openCases:3,awaitingReply:2,urgentCases:2,signups:Array.from({length:14},(_,i)=>({date:new Date(Date.now()-(13-i)*day).toISOString().slice(0,10),count:[0,1,0,2,1,3,1,0,2,4,2,1,3,5][i]})),recentCases:cases.filter(c=>c.status!=='resolved'),recentAudit:audit};
  if(url.pathname==='/admin/users'){const q=(url.searchParams.get('q')||'').toLowerCase(),plan=url.searchParams.get('plan');const rows=people.filter(p=>(!q||p.email.includes(q)||p.username.includes(q))&&(plan==='all'||!plan||(plan==='active'?Date.now()-Date.parse(p.last_seen_at)<7*day:plan==='new'?Date.now()-Date.parse(p.first_seen_at)<7*day:plan==='setup'?p.setup_step<4:plan==='suspended'?p.suspended:p.plan===plan)));return {users:rows,total:rows.length};}
  const person=/^\/admin\/users\/(.+)$/.exec(url.pathname);
  if(person){const p=people.find(x=>x.id===person[1])||people[0];return {user:p,owner:p.plan==='owner',moderation:p.suspended?{status:'suspended',reason:'Repeated spam in support',until:p.suspended_until,updated_at:iso(day)}:null,notes:[{id:'n1',author_email:'m@mohamedmowafy.com',body:'Early tester, very helpful feedback on subjects.',created_at:iso(2*day)}],cases:cases.filter(c=>c.owner_id===p.id),directory:null,history:audit.filter(a=>a.target===p.id)};}
  if(url.pathname==='/admin/cases'){const s=url.searchParams.get('status')||'active';return {cases:cases.filter(c=>s==='all'||(s==='active'?['open','pending'].includes(c.status):c.status===s))};}
  const one=/^\/admin\/cases\/(.+)$/.exec(url.pathname);
  if(one){const c=cases.find(x=>x.id===one[1])||cases[0];const p=people.find(x=>x.id===c.owner_id)!;return {case:{...c,display_name:p.display_name,last_seen_at:p.last_seen_at,plan:p.plan,user_seen_at:iso(0)},messages:messages[c.id]||[],otherCases:cases.filter(x=>x.owner_id===c.owner_id&&x.id!==c.id),team:[{id:people[5].id,email:'m@mohamedmowafy.com',role:'owner'}]};}
  if(url.pathname==='/admin/stats'){
    const range=Number(url.searchParams.get('days'))||30,k=range/30;
    const models=[['claude','sonnet',1840,62,5],['chatgpt','gpt-5.5',1310,40,6],['chatgpt','default',620,11,3],['claude','opus',410,25,2],['grok','grok-4',180,3,1],['claude','haiku',95,0,2]].map(([provider,model,turns,images,people])=>({provider,model,turns:Math.round(Number(turns)*k),images:Math.round(Number(images)*k),people}));
    const turns=models.reduce((a,m)=>a+m.turns,0);
    const series=Array.from({length:range},(_,i)=>({date:new Date(Date.now()-(range-1-i)*day).toISOString().slice(0,10),count:Math.round(turns/range*(0.55+0.9*Math.abs(Math.sin(i*1.7)))),people:5}));
    const busiest=series.reduce((b,s)=>s.count>b.count?s:b,{date:null as string|null,count:0});
    return {range,turns,images:models.reduce((a,m)=>a+m.images,0),people:7,perPerson:Math.round(turns/7),topPerson:Math.round(1520*k),multiProvider:3,everyDay:4,busiest,
      providers:[{provider:'claude',turns:models.filter(m=>m.provider==='claude').reduce((a,m)=>a+m.turns,0),images:0,people:5},{provider:'chatgpt',turns:models.filter(m=>m.provider==='chatgpt').reduce((a,m)=>a+m.turns,0),images:0,people:6},{provider:'grok',turns:models[4].turns,images:0,people:1}].sort((a,b)=>b.turns-a.turns),
      models,reasoning:[{reasoning:'medium',turns:1900},{reasoning:'high',turns:1100},{reasoning:'low',turns:400}],
      byHour:[40,22,14,8,5,4,9,30,70,120,160,170,150,180,210,230,220,190,160,175,210,240,180,90],byWeekday:[380,720,760,700,690,560,420],series,
      links:[{kind:'codex',people:6},{kind:'claude',people:5}],sync:[{kind:'memory',people:6},{kind:'skills',people:4},{kind:'notes',people:3}]};
  }
  if(path==='/admin/announcements')return {announcements};
  if(path==='/admin/team')return {team:[{id:people[5].id,email:'m@mohamedmowafy.com',role:'owner'},{id:people[6].id,email:'priya@college.edu',role:'support'}]};
  if(url.pathname==='/admin/audit')return {entries:audit};
  throw Error('Not in demo data');
}

export async function demoMail(path:string,body?:any):Promise<any>{
  const {staffEmail,staffPresets}=await import('../../server/email-layout.ts');
  await new Promise(r=>setTimeout(r,200));
  if(path==='/presets')return {presets:staffPresets,ready:true};
  if(path==='/case-reply'){const c=cases.find(x=>x.id===body.caseId)!;return {ok:true,to:c.email,subject:'Re: '+c.subject};}
  const person=people.find(p=>p.id===body?.userId)||(body?.email?{id:body.email,email:body.email,display_name:''}:undefined);
  const mail=staffEmail(body.kind,{name:person?.display_name||'',version:body.version||'0.0.0',notes:body.notes||'',subject:body.subject||'Subject',message:body.message||'Your message appears here.',unsubscribe:'https://mowrai.com/api/email/unsubscribe'});
  if(path==='/preview')return {subject:mail.subject,html:mail.html,to:person?.email||null};
  // Nothing leaves the browser in demo mode; the send only lands in the local audit list.
  const entry={id:'audit'+Date.now(),actor_email:'m@mohamedmowafy.com',action:'email.send',target:person!.id,detail:`${body.kind} · ${mail.subject} → ${person!.email}`,created_at:iso(0)};
  audit.unshift(entry);
  return {ok:true,to:person!.email,subject:mail.subject};
}
