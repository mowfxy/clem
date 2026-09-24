import {useCallback,useEffect,useRef,useState} from 'react';
import {desktop} from '../desktop/bridge';

export type Announcement={id:string;title:string;body:string;tone:'info'|'success'|'warning';link:string|null};
export type SupportMessage={id:string;author:'user'|'staff';body:string;created_at:string};
export type SupportCase={id:string;category:string;subject:string;message:string;created_at:string;status:'open'|'pending'|'resolved'|'closed';updated_at?:string;staff_replied_at?:string|null;unread:boolean;messages:SupportMessage[]};

const POLL=5*60000;
const read=(key:string):string[]=>{try{return JSON.parse(localStorage.getItem(key)||'[]');}catch{return [];}};
const write=(key:string,value:string[])=>{try{localStorage.setItem(key,JSON.stringify(value.slice(-200)));}catch{/* Storage can be unavailable; notices simply reappear. */}};

/** Low-frequency account signals: staff announcements and replies to the person's support cases. */
export function useWorkspaceSignals(enabled:boolean,onAnnouncement:(a:Announcement)=>void,onReply:(c:SupportCase)=>void){
  const [cases,setCases]=useState<SupportCase[]>([]);
  const callbacks=useRef({onAnnouncement,onReply});callbacks.current={onAnnouncement,onReply};
  const last=useRef(0);
  const refresh=useCallback(async(force=false)=>{
    if(!desktop||!enabled||document.hidden)return;
    // Focus events are frequent; keep account-service traffic modest.
    if(!force&&Date.now()-last.current<30000)return;
    last.current=Date.now();
    const [news,support]=await Promise.allSettled([desktop.invoke({action:'announcements'}),desktop.invoke({action:'supportCases'})]);
    if(news.status==='fulfilled'){
      const seen=read('mowr-seen-announcements');
      for(const a of (news.value as {announcements:Announcement[]}).announcements||[])if(!seen.includes(a.id)){seen.push(a.id);callbacks.current.onAnnouncement(a);}
      write('mowr-seen-announcements',seen);
    }
    if(support.status==='fulfilled'){
      const list=(support.value as {cases:SupportCase[]}).cases||[];
      setCases(list);
      const notified=read('mowr-notified-replies');
      for(const c of list){const key=c.id+'@'+c.staff_replied_at;if(c.unread&&!notified.includes(key)){notified.push(key);callbacks.current.onReply(c);}}
      write('mowr-notified-replies',notified);
    }
  },[enabled]);
  useEffect(()=>{
    if(!enabled)return;
    void refresh(true);
    const timer=setInterval(()=>void refresh(true),POLL);
    const focus=()=>void refresh();
    addEventListener('focus',focus);
    return()=>{clearInterval(timer);removeEventListener('focus',focus);};
  },[enabled,refresh]);
  return {cases,unread:cases.filter(c=>c.unread).length,refresh:()=>refresh(true)};
}
