import {useMemo,useState} from 'react';
import {ActivityGraph} from './ActivityGraph';
import {SettingsCard} from './SettingsParts';
import type {Chat,Model,Space,StoredFile,StudySet,VisualRecord,Automation} from '../../core/types';

const DAY=86_400_000;
const WEEKDAYS=['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'];
/** Roughly four characters to a token across the providers Mowr talks to. Nothing here is billed, so an estimate is enough. */
const tokensOf=(text:string)=>Math.ceil(text.length/4);
const wordsOf=(text:string)=>text.trim()?text.trim().split(/\s+/).length:0;
const compact=(n:number)=>n<1000?String(n):n<1_000_000?`${+(n/1000).toFixed(n<10_000?1:0)}K`:`${+(n/1_000_000).toFixed(n<10_000_000?1:0)}M`;
const plural=(n:number,word:string)=>`${n.toLocaleString()} ${word}${n===1?'':'s'}`;
const hourLabel=(h:number)=>new Date(2000,0,1,h).toLocaleTimeString([], {hour:'numeric'});
const dayKey=(t:number)=>new Date(t).toDateString();

export type UsageData={chats:Chat[];spaces:Space[];files:StoredFile[];studySets:StudySet[];visuals:VisualRecord[];automations:Automation[];models:Model[]};

/** Everything the Usage tab shows, worked out from what is saved on this PC. */
export function usageStats({chats,spaces,files,studySets,visuals,automations,models}:UsageData,now=Date.now()){
  const messages=chats.flatMap(c=>c.messages);
  const sent=messages.filter(m=>m.role==='user'),replies=messages.filter(m=>m.role==='assistant');
  const tokensIn=sent.reduce((n,m)=>n+tokensOf(m.content),0),tokensOut=replies.reduce((n,m)=>n+tokensOf(m.content),0);
  const words=sent.reduce((n,m)=>n+wordsOf(m.content),0),wordsBack=replies.reduce((n,m)=>n+wordsOf(m.content),0);
  const longest=chats.reduce<Chat|null>((best,c)=>!best||c.messages.length>best.messages.length?c:best,null);
  const byModel=new Map<string,number>();
  for(const m of replies)if(m.model)byModel.set(m.model,(byModel.get(m.model)||0)+1);
  const topModelId=[...byModel].sort((a,b)=>b[1]-a[1])[0]?.[0];
  const topModel=topModelId?models.find(m=>m.id===topModelId)?.name||topModelId.replace(/^[a-z]+:/,''):null;
  const recent=chats.filter(c=>c.updated>now-30*DAY);
  const weekday=new Array(7).fill(0),hour=new Array(24).fill(0);
  for(const c of chats){const d=new Date(c.updated);weekday[d.getDay()]++;hour[d.getHours()]++;}
  const days=new Set(chats.map(c=>dayKey(c.updated)));
  let streak=0,t=days.has(dayKey(now))?now:now-DAY;
  while(days.has(dayKey(t))){streak++;t-=DAY;}
  const first=chats.reduce((min,c)=>Math.min(min,c.updated),now);
  return {
    threads:chats.length,recent:recent.length,sent:sent.length,replies:replies.length,
    tokensIn,tokensOut,tokens:tokensIn+tokensOut,words,wordsBack,
    longest,topModel,topModelShare:topModelId&&replies.length?byModel.get(topModelId)!/replies.length:0,modelsUsed:byModel.size,
    busiestDay:chats.length?WEEKDAYS[weekday.indexOf(Math.max(...weekday))]:null,
    busiestHour:chats.length?hour.indexOf(Math.max(...hour)):null,
    streak,activeDays:days.size,since:chats.length?first:null,
    perThread:chats.length?messages.length/chats.length:0,
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

export function UsageSettings(data:UsageData){
  const s=useMemo(()=>usageStats(data),[data.chats,data.spaces,data.files,data.studySets,data.visuals,data.automations,data.models]);
  const times=useMemo(()=>data.chats.map(c=>c.updated),[data.chats]);
  const [day,setDay]=useState<{at:number;count:number}|null>(null);
  const novels=s.words+s.wordsBack>=90_000?(s.words+s.wordsBack)/90_000:0;

  return <>
    <div className="settings-card-wrap"><section className="settings-card usage-hero">
      <div className="usage-hero-head">
        <div>
          <span className="usage-eyebrow">{day?new Date(day.at).toLocaleDateString([], {weekday:'long',month:'short',day:'numeric'}):'Last 30 days'}</span>
          <strong>{day?plural(day.count,'thread'):plural(s.recent,'thread')}</strong>
        </div>
        <div className="usage-hero-side">
          <span><b>{s.streak}</b> day streak</span>
          <span><b>{s.activeDays}</b> active days</span>
        </div>
      </div>
      <ActivityGraph times={times} tone="green" label="Threads" height={96} onScrub={setDay}/>
    </section></div>

    <SettingsCard title="Conversations" note={s.since?`Counted from ${new Date(s.since).toLocaleDateString([], {month:'long',day:'numeric',year:'numeric'})}, across the chats saved on this PC.`:undefined}>
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
        <div className="usage-legend"><span><i className="in"/>You · {compact(s.tokensIn)}</span><span><i className="out"/>Mowr · {compact(s.tokensOut)}</span></div>
      </div>
    </SettingsCard>

    <SettingsCard title="Habits">
      <div className="usage-facts">
        {s.topModel&&<p>Your go-to model is <b>{s.topModel}</b>, behind {Math.round(s.topModelShare*100)}% of replies{s.modelsUsed>1?` · ${s.modelsUsed} models tried`:''}.</p>}
        {s.busiestDay&&<p>You’re busiest on <b>{s.busiestDay}</b>, most often around <b>{hourLabel(s.busiestHour!)}</b>.</p>}
        {s.longest&&s.longest.messages.length>2&&<p>Your longest thread, <b>“{s.longest.title}”</b>, runs {plural(s.longest.messages.length,'message')}.</p>}
        {novels>0&&<p>Together you’ve written and read about <b>{novels<10?novels.toFixed(1):Math.round(novels)} novels</b> worth of words.</p>}
        {!s.threads&&<p className="muted">Start a chat and your habits show up here.</p>}
      </div>
    </SettingsCard>

    <SettingsCard title="Workspace">
      <div className="usage-grid">
        <Stat value={s.projects.toLocaleString()} label="Projects"/>
        <Stat value={s.subjects.toLocaleString()} label="Subjects"/>
        <Stat value={s.files.toLocaleString()} label="Files" detail={s.made?`${s.made} made by Mowr`:undefined}/>
        <Stat value={s.cards.toLocaleString()} label="Flashcards" detail={s.reviews?`${compact(s.reviews)} reviews`:undefined}/>
        <Stat value={s.quizzes.toLocaleString()} label="Quizzes taken"/>
        <Stat value={s.visuals.toLocaleString()} label="Visuals" detail={s.automations?plural(s.automations,'automation'):undefined}/>
      </div>
    </SettingsCard>
  </>;
}
