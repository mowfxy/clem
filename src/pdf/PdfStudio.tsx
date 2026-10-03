import {useEffect,useRef,useState} from 'react';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import './pdf-studio.css';

type Box={page:number;x:number;y:number;w:number;h:number};

/** Continuous pages, rendered sharp for the screen, with optional highlight boxes. */
export function Pages({pdf,highlights,onSelect}:{pdf:PDFDocumentProxy;highlights:Box[];onSelect?:(text:string)=>void}){
  const host=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(0);
  useEffect(()=>{const el=host.current;if(!el)return;const ro=new ResizeObserver(()=>setWidth(Math.min(920,el.clientWidth-48)));ro.observe(el);return()=>ro.disconnect();},[]);
  const [pages,setPages]=useState<{n:number;w:number;h:number;scale:number}[]>([]);
  useEffect(()=>{
    if(!width)return;let cancelled=false;
    void (async()=>{const out=[];for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n);const base=p.getViewport({scale:1});const scale=width/base.width;out.push({n,w:width,h:base.height*scale,scale});}if(!cancelled)setPages(out);})();
    return()=>{cancelled=true;};
  },[pdf,width]);
  return <div className="ps-pages" ref={host} onMouseUp={()=>{const s=window.getSelection()?.toString();if(s&&onSelect)onSelect(s.slice(0,8000));}}>
    {pages.map(p=><Page key={p.n} pdf={pdf} n={p.n} w={p.w} h={p.h} scale={p.scale} boxes={highlights.filter(b=>b.page===p.n)}/>)}
  </div>;
}

function Page({pdf,n,w,h,scale,boxes}:{pdf:PDFDocumentProxy;n:number;w:number;h:number;scale:number;boxes:Box[]}){
  const canvas=useRef<HTMLCanvasElement>(null),text=useRef<HTMLDivElement>(null);
  const [viewportH,setViewportH]=useState(h);
  useEffect(()=>{
    let cancelled=false,task:{cancel:()=>void}|undefined;
    void (async()=>{
      const page=await pdf.getPage(n);const viewport=page.getViewport({scale});const ratio=Math.min(window.devicePixelRatio||1,2);
      const c=canvas.current!;c.width=Math.floor(viewport.width*ratio);c.height=Math.floor(viewport.height*ratio);setViewportH(viewport.height);
      task=page.render({canvas:c,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]}) as unknown as {cancel:()=>void};
      await (task as unknown as {promise:Promise<void>}).promise;
      if(cancelled||!text.current)return;
      const {TextLayer}=await import('pdfjs-dist');text.current.replaceChildren();text.current.style.setProperty('--total-scale-factor',String(scale));
      await new TextLayer({textContentSource:await page.getTextContent(),container:text.current,viewport}).render();
    })().catch(()=>{});
    return()=>{cancelled=true;task?.cancel();};
  },[pdf,n,scale]);
  return <div className="ps-page" data-page={n} style={{width:w,height:viewportH}}>
    <canvas ref={canvas} style={{width:w,height:viewportH}} aria-label={`Page ${n}`}/>
    <div className="ps-text textLayer" ref={text}/>
    {boxes.map((b,i)=><span key={i} className="ps-mark" style={{left:b.x*scale,top:viewportH-(b.y+b.h)*scale,width:b.w*scale,height:b.h*scale,animationDelay:`${i*70}ms`}}/>)}
    <span className="ps-num">{n}</span>
  </div>;
}
