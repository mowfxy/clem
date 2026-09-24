import {createElement,useEffect,useRef,useState,type CSSProperties,type ReactNode} from 'react';

/** Fades content up once as it scrolls into view. Content is visible without JavaScript or motion. */
export function Reveal({children,className='',delay=0,as='div'}:{children:ReactNode;className?:string;delay?:number;as?:string}){
  const ref=useRef<HTMLElement>(null);
  const [shown,setShown]=useState(false);
  useEffect(()=>{
    const el=ref.current;
    if(!el||!('IntersectionObserver' in window)||matchMedia('(prefers-reduced-motion: reduce)').matches){setShown(true);return;}
    const io=new IntersectionObserver(([entry])=>{if(entry.isIntersecting){setShown(true);io.disconnect();}},{rootMargin:'0px 0px -8% 0px'});
    io.observe(el);
    return()=>io.disconnect();
  },[]);
  return createElement(as,{ref,className:`sx-reveal ${shown?'in':''} ${className}`,style:{'--delay':delay+'ms'} as CSSProperties},children);
}
