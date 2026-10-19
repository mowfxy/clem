import {useState} from 'react';
import {adminApi} from './api';
import {Empty,ErrorNote,I,PageHead,Skeleton,Sparkbars,date,useLoad} from './ui';

type Row={provider:string;model:string;turns:number;images:number;people:number};
type Stats={range:number;turns:number;images:number;people:number;perPerson:number;topPerson:number;multiProvider:number;everyDay:number;
  busiest:{date:string|null;count:number};providers:{provider:string;turns:number;images:number;people?:number}[];models:Row[];
  reasoning:{reasoning:string;turns:number}[];byHour:number[];byWeekday:number[];series:{date:string;count:number;people:number}[];
  links:{kind:string;people:number}[];sync:{kind:string;people:number}[]};

const providerName:Record<string,string>={chatgpt:'ChatGPT',claude:'Claude',grok:'Grok',antigravity:'Gemini'};
const linkName:Record<string,string>={codex:'ChatGPT',claude:'Claude'};
const syncName:Record<string,string>={skills:'Skills',memory:'Memory',notes:'Notes'};
const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const modelName=(m:Row)=>m.model==='default'?`${providerName[m.provider]||m.provider} default`:m.model.replace(/^gpt/i,'GPT').replace(/^./,c=>c.toUpperCase());
const people=(n=0)=>`${n} ${n===1?'person':'people'}`;
const pct=(n:number,of:number)=>of?Math.round(n/of*100):0;
const hourLabel=(h:number)=>h===0?'12am':h<12?`${h}am`:h===12?'12pm':`${h-12}pm`;

/** Bars with their own labels, for hours and weekdays. */
function Bars({values,labels,label,every=1}:{values:number[];labels:string[];label:string;every?:number}){
  const max=Math.max(1,...values);
  return <>
    <div className="adm-sparkbars" role="img" aria-label={label}>{values.map((v,i)=><span key={i} title={`${labels[i]}: ${v}`} style={{height:`${Math.max(4,v/max*100)}%`,animationDelay:i*22+'ms'}} className={v?'':'zero'}/>)}</div>
    <div className="adm-axis">{labels.map((l,i)=>i%every===0?<span key={i}>{l}</span>:null)}</div>
  </>;
}

function Share({items,total,note}:{items:{key:string;label:string;value:number;sub?:string}[];total:number;note?:string}){
  return <ul className="adm-funnel adm-share">{items.map(item=><li key={item.key}><span title={item.label}>{item.label}{item.sub&&<small>{item.sub}</small>}</span><i><b style={{width:`${pct(item.value,total)}%`}}/></i><strong>{pct(item.value,total)}%</strong></li>)}{note&&<li className="note">{note}</li>}</ul>;
}

export function Stats(){
  const [range,setRange]=useState(30);
  const {data,error,loading,reload}=useLoad(()=>adminApi<Stats>(`/admin/stats?days=${range}`),[range]);
  const head=<PageHead scene="kite" title="Stats" line="Which AIs people pick and how they use Mowr. Counts only, never what anyone wrote.">
    <div className="adm-segment" role="tablist" aria-label="Time range">{[7,30,90].map(n=><button key={n} role="tab" aria-selected={range===n} className={range===n?'on':''} onClick={()=>setRange(n)}>{n} days</button>)}</div>
    <button className="adm-ghost" onClick={reload}><I name="refresh"/>Refresh</button>
  </PageHead>;
  if(error)return <div className="adm-page">{head}<ErrorNote error={error} onRetry={reload}/></div>;
  if(loading&&!data)return <div className="adm-page">{head}<Skeleton rows={8}/></div>;
  const d=data!;
  const top=d.providers[0],topModel=d.models[0];
  const night=d.byHour.slice(0,5).reduce((a,b)=>a+b,0),hourTotal=d.byHour.reduce((a,b)=>a+b,0);
  const peakHour=d.byHour.indexOf(Math.max(...d.byHour));
  const weekend=d.byWeekday[0]+d.byWeekday[6],weekTotal=d.byWeekday.reduce((a,b)=>a+b,0);
  const reasoningTotal=d.reasoning.reduce((a,r)=>a+r.turns,0);
  const imageModel=[...d.models].sort((a,b)=>b.images-a.images)[0];
  const facts=[
    top&&{k:'Crowd favourite',v:providerName[top.provider]||top.provider,s:`${pct(top.turns,d.turns)}% of all messages`},
    topModel&&{k:'Most used model',v:modelName(topModel),s:`${topModel.turns.toLocaleString()} messages from ${people(topModel.people)}`},
    d.busiest.date&&{k:'Busiest day',v:date(d.busiest.date),s:`${d.busiest.count.toLocaleString()} messages`},
    hourTotal>0&&{k:'Rush hour',v:`${hourLabel(peakHour)}–${hourLabel((peakHour+1)%24)}`,s:'Local time for each person'},
    hourTotal>0&&{k:'Night owls',v:`${pct(night,hourTotal)}%`,s:'of messages sent between midnight and 5am'},
    weekTotal>0&&{k:'Weekend share',v:`${pct(weekend,weekTotal)}%`,s:'of messages on Saturday or Sunday'},
    {k:'Top chatter',v:d.topPerson.toLocaleString(),s:'messages from the most active person'},
    {k:'Switchers',v:String(d.multiProvider),s:`${d.multiProvider===1?'person uses':'people use'} more than one AI`},
    d.reasoning[0]&&{k:'Favourite thinking level',v:d.reasoning[0].reasoning.replace(/^./,c=>c.toUpperCase()),s:`${pct(d.reasoning[0].turns,reasoningTotal)}% of messages that set one`},
    imageModel?.images>0&&{k:'Picture lovers',v:modelName(imageModel),s:`${imageModel.images.toLocaleString()} images attached`},
  ].filter(Boolean) as {k:string;v:string;s:string}[];
  const linkTotal=Math.max(1,...d.links.map(l=>l.people));
  return <div className="adm-page">
    {head}
    <section className="adm-stats">
      <div className="adm-stat"><span>Messages</span><strong>{d.turns.toLocaleString()}</strong><small>last {d.range} days</small></div>
      <div className="adm-stat"><span>People chatting</span><strong>{d.people}</strong><small>{d.everyDay} came back on {Math.min(d.range,7)}+ days</small></div>
      <div className="adm-stat"><span>Per person</span><strong>{d.perPerson}</strong><small>messages on average</small></div>
      <div className="adm-stat"><span>Images sent</span><strong>{d.images.toLocaleString()}</strong><small>attached to messages</small></div>
    </section>
    {d.turns===0?<section className="adm-card"><Empty scene="hourglass" title="No usage counts yet">They start arriving as people update to the latest Windows release and send messages.</Empty></section>:<>
    <div className="adm-grid-2">
      <section className="adm-card">
        <header><h2>Providers</h2><span className="adm-muted">Share of messages</span></header>
        <Share total={d.turns} items={d.providers.map(p=>({key:p.provider,label:providerName[p.provider]||p.provider,sub:people(p.people),value:p.turns}))}/>
      </section>
      <section className="adm-card">
        <header><h2>Top models</h2><span className="adm-muted">Share of messages</span></header>
        <Share total={d.turns} items={d.models.slice(0,6).map(m=>({key:m.provider+m.model,label:modelName(m),sub:providerName[m.provider],value:m.turns}))}/>
      </section>
    </div>
    <section className="adm-card">
      <header><h2>Messages per day</h2><span className="adm-muted">Last {d.range} days</span></header>
      <Sparkbars values={d.series} label={`Messages per day for the last ${d.range} days`}/>
      <div className="adm-axis"><span>{d.series[0]?.date.slice(5)}</span><span>Today</span></div>
    </section>
    <div className="adm-grid-2">
      <section className="adm-card">
        <header><h2>When people chat</h2><span className="adm-muted">By local hour</span></header>
        <Bars values={d.byHour} labels={d.byHour.map((_,h)=>hourLabel(h))} every={6} label="Messages by hour of day"/>
      </section>
      <section className="adm-card">
        <header><h2>Days of the week</h2><span className="adm-muted">All messages</span></header>
        <Bars values={d.byWeekday} labels={weekdays} label="Messages by day of the week"/>
      </section>
    </div>
    <section className="adm-card">
      <header><h2>Fun facts</h2><span className="adm-muted">Last {d.range} days</span></header>
      <div className="adm-facts-grid">{facts.map((f,i)=><div key={f.k} style={{animationDelay:i*40+'ms'}}><span>{f.k}</span><strong>{f.v}</strong><small>{f.s}</small></div>)}</div>
    </section>
    </>}
    <div className="adm-grid-2">
      <section className="adm-card">
        <header><h2>Linked accounts</h2><span className="adm-muted">People, all time</span></header>
        {d.links.length?<ul className="adm-funnel">{d.links.map(l=><li key={l.kind}><span>{linkName[l.kind]||l.kind}</span><i><b style={{width:`${pct(l.people,linkTotal)}%`}}/></i><strong>{l.people}</strong></li>)}</ul>:<p className="adm-muted">No linked accounts yet.</p>}
      </section>
      <section className="adm-card">
        <header><h2>Sync</h2><span className="adm-muted">People syncing each</span></header>
        {d.sync.length?<ul className="adm-funnel">{d.sync.map(s=><li key={s.kind}><span>{syncName[s.kind]||s.kind}</span><i><b style={{width:`${pct(s.people,Math.max(1,...d.sync.map(x=>x.people)))}%`}}/></i><strong>{s.people}</strong></li>)}</ul>:<p className="adm-muted">Nobody syncs yet.</p>}
      </section>
    </div>
  </div>;
}
