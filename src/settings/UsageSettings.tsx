import {useMemo} from 'react';
import {ActivityGraph} from './ActivityGraph';
import {SettingsCard} from './SettingsParts';
import type {Chat,Model,Space,StoredFile,StudySet,VisualRecord,Automation} from '../../core/types';

const DAY=86_400_000;
const WEEKDAYS=['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'];
/** Roughly four characters to a token across the providers Clem talks to. Nothing here is billed, so an estimate is enough. */
const tokensOf=(text:string)=>Math.ceil(text.length/4);
const wordsOf=(text:string)=>text.trim()?text.trim().split(/\s+/).length:0;
const compact=(n:number)=>n<1000?String(n):n<1_000_000?`${+(n/1000).toFixed(n<10_000?1:0)}K`:`${+(n/1_000_000).toFixed(n<10_000_000?1:0)}M`;
const plural=(n:number,word:string)=>`${n.toLocaleString()} ${word}${n===1?'':'s'}`;
const hourLabel=(h:number)=>new Date(2000,0,1,h).toLocaleTimeString([], {hour:'numeric'});
const dayKey=(t:number)=>new Date(t).toDateString();

export type UsageData={chats:Chat[];spaces:Space[];files:StoredFile[];studySets:StudySet[];visuals:VisualRecord[];automations:Automation[];models:Model[];archive?:UsageArchive};

/** What deleted chats added to the Usage tab, kept as totals (never their words) so deleting a chat doesn't undo its usage. */
export type UsageArchive={threads:number;messages:number;sent:number;replies:number;tokensIn:number;tokensOut:number;words:number;wordsBack:number;models:Record<string,number>;times:number[];longest?:{title:string;messages:number}};
export const emptyArchive=():UsageArchive=>({threads:0,messages:0,sent:0,replies:0,tokensIn:0,tokensOut:0,words:0,wordsBack:0,models:{},times:[]});
/** Adds chats about to be deleted to the archive. Temporary chats never counted, so they are left out. */
export function archiveChats(archive:UsageArchive|undefined,chats:Chat[]):UsageArchive{
  const a:UsageArchive=structuredClone(archive||emptyArchive());
  for(const c of chats){
    if(c.temporary)continue;
    a.threads++;a.messages+=c.messages.length;a.times.push(c.updated);
    for(const m of c.messages){
      if(m.role==='user'){a.sent++;a.tokensIn+=tokensOf(m.content);a.words+=wordsOf(m.content);}
      else if(m.role==='assistant'){a.replies++;a.tokensOut+=tokensOf(m.content);a.wordsBack+=wordsOf(m.content);if(m.model)a.models[m.model]=(a.models[m.model]||0)+1;}
    }
    if(c.messages.length>(a.longest?.messages||0))a.longest={title:c.title,messages:c.messages.length};
  }
  a.times=a.times.slice(-20_000);
  return a;
}

/** Everything the Usage tab shows, worked out from what is saved on this PC. */
export function usageStats({chats,spaces,files,studySets,visuals,automations,models,archive=emptyArchive()}:UsageData,now=Date.now()){
  const messages=chats.flatMap(c=>c.messages);
  const sentNow=messages.filter(m=>m.role==='user'),repliesNow=messages.filter(m=>m.role==='assistant');
  const sent={length:sentNow.length+archive.sent},replies={length:repliesNow.length+archive.replies};
  const tokensIn=sentNow.reduce((n,m)=>n+tokensOf(m.content),archive.tokensIn),tokensOut=repliesNow.reduce((n,m)=>n+tokensOf(m.content),archive.tokensOut);
  const words=sentNow.reduce((n,m)=>n+wordsOf(m.content),archive.words),wordsBack=repliesNow.reduce((n,m)=>n+wordsOf(m.content),archive.wordsBack);
  const kept=chats.reduce<{title:string;messages:number}|null>((best,c)=>!best||c.messages.length>best.messages?{title:c.title,messages:c.messages.length}:best,null);
  const longest=archive.longest&&archive.longest.messages>(kept?.messages||0)?archive.longest:kept;
  const byModel=new Map<string,number>(Object.entries(archive.models));
  for(const m of repliesNow)if(m.model)byModel.set(m.model,(byModel.get(m.model)||0)+1);
  const topModelId=[...byModel].sort((a,b)=>b[1]-a[1])[0]?.[0];
  const topModel=topModelId?models.find(m=>m.id===topModelId)?.name||topModelId.replace(/^[a-z]+:/,''):null;
  const times=[...chats.map(c=>c.updated),...archive.times],threads=times.length;
  const recent=times.filter(t=>t>now-30*DAY);
  const weekday=new Array(7).fill(0),hour=new Array(24).fill(0);
  for(const t of times){const d=new Date(t);weekday[d.getDay()]++;hour[d.getHours()]++;}
  const days=new Set(times.map(dayKey));
  let streak=0,t=days.has(dayKey(now))?now:now-DAY;
  while(days.has(dayKey(t))){streak++;t-=DAY;}
  const first=times.reduce((min,t)=>Math.min(min,t),now);
  return {
    threads,recent:recent.length,sent:sent.length,replies:replies.length,
    tokensIn,tokensOut,tokens:tokensIn+tokensOut,words,wordsBack,
    longest,topModel,topModelShare:topModelId&&replies.length?byModel.get(topModelId)!/replies.length:0,modelsUsed:byModel.size,
    busiestDay:threads?WEEKDAYS[weekday.indexOf(Math.max(...weekday))]:null,
    busiestHour:threads?hour.indexOf(Math.max(...hour)):null,
    streak,activeDays:days.size,since:threads?first:null,
    perThread:threads?(messages.length+archive.messages)/threads:0,
    projects:spaces.filter(s=>s.kind!=='subject').length,subjects:spaces.filter(s=>s.kind==='subject').length,
    files:files.length,made:files.filter(f=>f.made).length,
    cards:studySets.filter(s=>s.kind==='flashcards').reduce((n,s)=>n+s.items.length,0),
    reviews:studySets.reduce((n,s)=>n+(s.cards||[]).reduce((r,c)=>r+(c?.reps||0),0),0),
    quizzes:studySets.reduce((n,s)=>n+s.attempts.length,0),
    visuals:visuals.length,automations:automations.length,
  };
}

function Stat({value,label,detail}:{value:string;label:string;detail?:string}){
  return <div className="usage-stat"><b>{value}</b><span>{label}</span>{detail&&<small>{detail}</small>}</div>;
}

/** One line of the Workspace list; a count still at zero is shown quietly, so the ones in use stand out. */
function Count({value,label,detail}:{value:number;label:string;detail?:string}){
  return <div className={value?undefined:'zero'}><dt>{label}{detail&&<small>{detail}</small>}</dt><dd>{value.toLocaleString()}</dd></div>;
}

export function UsageSettings(data:UsageData){
  const s=useMemo(()=>usageStats(data),[data.chats,data.spaces,data.files,data.studySets,data.visuals,data.automations,data.models,data.archive]);
  const times=useMemo(()=>[...data.chats.map(c=>c.updated),...(data.archive?.times||[])],[data.chats,data.archive]);
  const novels=s.words+s.wordsBack>=90_000?(s.words+s.wordsBack)/90_000:0;

  return <>
    <section className="st-card-wrap"><div className="st-card usage-hero">
      <div className="usage-hero-head">
        <div>
          <span className="st-eyebrow">Last 30 days</span>
          <strong>{plural(s.recent,'thread')}</strong>
        </div>
        <div className="usage-hero-side">
          <span><b>{s.streak}</b>day streak</span>
          <span><b>{s.activeDays}</b>active days</span>
        </div>
      </div>
      <ActivityGraph times={times} label="Threads" unit="thread" height={104}/>
    </div></section>

    <SettingsCard title="Conversations" note={s.since?`Counted from ${new Date(s.since).toLocaleDateString([], {month:'long',day:'numeric',year:'numeric'})}, across every chat on this PC, including ones you deleted.`:undefined}>
      <div className="usage-grid">
        <Stat value={s.threads.toLocaleString()} label="Threads" detail={`${s.perThread.toFixed(1)} messages each`}/>
        <Stat value={s.sent.toLocaleString()} label="Messages sent" detail={`${compact(s.words)} words written`}/>
        <Stat value={s.replies.toLocaleString()} label="Replies" detail={`${compact(s.wordsBack)} words read`}/>
      </div>
    </SettingsCard>

    <SettingsCard title="Tokens" note="Estimated from the text of your chats, at about four characters a token. Files and sources sent alongside aren’t counted.">
      <div className="usage-tokens">
        <div className="usage-token-total"><b>{compact(s.tokens)}</b><span>total tokens</span></div>
        <div className="usage-bar" role="img" aria-label={`${compact(s.tokensIn)} tokens sent, ${compact(s.tokensOut)} tokens received`}>
          <i style={{flexGrow:s.tokensIn||0}}/><i style={{flexGrow:s.tokensOut||(s.tokens?0:1)}}/>
        </div>
        <div className="usage-legend"><span><i className="in"/>You · {compact(s.tokensIn)}</span><span><i className="out"/>Clem · {compact(s.tokensOut)}</span></div>
      </div>
    </SettingsCard>

    <SettingsCard title="Habits">
      <div className="usage-facts">
        {s.topModel&&<p>Your go-to model is <b>{s.topModel}</b>, behind {Math.round(s.topModelShare*100)}% of replies{s.modelsUsed>1?` · ${s.modelsUsed} models tried`:''}.</p>}
        {s.busiestDay&&<p>You’re busiest on <b>{s.busiestDay}</b>, most often around <b>{hourLabel(s.busiestHour!)}</b>.</p>}
        {s.longest&&s.longest.messages>2&&<p>Your longest thread, <b>“{s.longest.title}”</b>, runs {plural(s.longest.messages,'message')}.</p>}
        {novels>0&&<p>Together you’ve written and read about <b>{novels<10?novels.toFixed(1):Math.round(novels)} novels</b> worth of words.</p>}
        {!s.threads&&<p className="muted">Start a chat and your habits show up here.</p>}
      </div>
    </SettingsCard>

    <SettingsCard title="Workspace">
      <div className="usage-ws">
        <div className="usage-tokens">
          <div className="usage-token-total"><b>{s.files.toLocaleString()}</b><span>{s.files===1?'file':'files'} in Clem</span></div>
          <div className="usage-bar" role="img" aria-label={`${s.files-s.made} added by you, ${s.made} made by Clem`}>
            <i style={{flexGrow:s.files-s.made}}/><i style={{flexGrow:s.made||(s.files?0:1)}}/>
          </div>
          <div className="usage-legend"><span><i className="in"/>Added by you · {(s.files-s.made).toLocaleString()}</span><span><i className="out"/>Made by Clem · {s.made.toLocaleString()}</span></div>
        </div>
        <dl className="usage-ws-list">
          <Count value={s.subjects} label="Subjects"/>
          <Count value={s.projects} label="Projects"/>
          <Count value={s.cards} label="Flashcards" detail={s.reviews?`${compact(s.reviews)} reviews`:undefined}/>
          <Count value={s.quizzes} label="Quizzes taken"/>
          <Count value={s.visuals} label="Visuals"/>
          <Count value={s.automations} label="Automations"/>
        </dl>
      </div>
    </SettingsCard>
  </>;
}
