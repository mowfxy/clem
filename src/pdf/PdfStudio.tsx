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
  // Pages away from the view are drawn one after another in the background, never all at once.
  const queue=useRef<Promise<void>>(Promise.resolve());
  const later=(job:()=>Promise<void>)=>{queue.current=queue.current.then(job).catch(()=>{});};
  return <div className="ps-pages" ref={host} onMouseUp={()=>{const s=window.getSelection()?.toString();if(s&&onSelect)onSelect(s.slice(0,8000));}}>
    {pages.map(p=><Page key={p.n} pdf={pdf} n={p.n} w={p.w} h={p.h} scale={p.scale} later={later} boxes={highlights.filter(b=>b.page===p.n)}/>)}
  </div>;
}

type Later=(job:()=>Promise<void>)=>void;

/** Every page is drawn sharp, as before. Pages near the view stay live canvases; a page further away is kept as a
 *  lossless PNG of the same pixels, so it shows at once when scrolled back to while holding a fraction of the
 *  memory (35 pages at 2× were ~640 MB of live bitmaps). The pages scroll inside the viewer, so its scroll box is
 *  the root the distances are measured from. */
function Page({pdf,n,w,h,scale,boxes,later}:{pdf:PDFDocumentProxy;n:number;w:number;h:number;scale:number;boxes:Box[];later:Later}){
  const canvas=useRef<HTMLCanvasElement>(null),text=useRef<HTMLDivElement>(null);
  const [viewportH,setViewportH]=useState(h);
  const [near,setNear]=useState(false),[still,setStill]=useState('');
  const nearRef=useRef(false),stillRef=useRef(''),texted=useRef(false);
  const ratio=Math.min(window.devicePixelRatio||1,2);
  const draw=async(target:HTMLCanvasElement,alive:()=>boolean)=>{
    const page=await pdf.getPage(n);if(!alive())return false;const viewport=page.getViewport({scale});
    target.width=Math.floor(viewport.width*ratio);target.height=Math.floor(viewport.height*ratio);setViewportH(viewport.height);
    const task=page.render({canvas:target,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]}) as unknown as {cancel:()=>void;promise:Promise<void>};
    const stop=setInterval(()=>{if(!alive())task.cancel();},50);
    try{await task.promise;}finally{clearInterval(stop);}
    if(!alive())return false;
    if(!texted.current&&text.current){
      texted.current=true;
      const {TextLayer}=await import('pdfjs-dist');text.current.replaceChildren();text.current.style.setProperty('--total-scale-factor',String(scale));
      await new TextLayer({textContentSource:await page.getTextContent(),container:text.current,viewport}).render();
    }
    return true;
  };
  const keep=(from:HTMLCanvasElement)=>new Promise<void>(resolve=>from.toBlob(blob=>{
    if(blob){if(stillRef.current)URL.revokeObjectURL(stillRef.current);stillRef.current=URL.createObjectURL(blob);setStill(stillRef.current);}
    resolve();
  },'image/png'));
  useEffect(()=>{
    const el=canvas.current?.parentElement;if(!el)return;
    let root=el.parentElement;while(root&&!/(auto|scroll)/.test(getComputedStyle(root).overflowY))root=root.parentElement;
    const enter=new IntersectionObserver(([e])=>{if(e.isIntersecting){nearRef.current=true;setNear(true);}},{root,rootMargin:'200% 0px'});
    const leave=new IntersectionObserver(([e])=>{if(!e.isIntersecting){nearRef.current=false;setNear(false);}},{root,rootMargin:'400% 0px'});
    enter.observe(el);leave.observe(el);
    return()=>{enter.disconnect();leave.disconnect();};
  },[]);
  // A new size or file starts over: the old picture and text no longer match.
  useEffect(()=>{
    texted.current=false;
    let gone=false;
    later(async()=>{
      if(gone||nearRef.current||stillRef.current)return;
      const off=document.createElement('canvas');
      if(await draw(off,()=>!gone))await keep(off);
      off.width=off.height=0;
    });
    return()=>{gone=true;if(stillRef.current){URL.revokeObjectURL(stillRef.current);stillRef.current='';setStill('');}};
  },[pdf,n,scale]);
  useEffect(()=>{
    if(!near)return;
    let cancelled=false,drawn=false;const c=canvas.current!;
    void draw(c,()=>!cancelled).then(ok=>{drawn=ok;}).catch(()=>{});
    return()=>{
      cancelled=true;
      // Still in view: a new size or file is about to redraw this canvas, so there is nothing to keep.
      if(nearRef.current)return;
      // Keep the exact pixels before letting the live canvas go; a page that never finished is drawn in the background.
      if(drawn)void keep(c).then(()=>{if(!nearRef.current){c.width=0;c.height=0;}});
      else{c.width=0;c.height=0;if(!stillRef.current)later(async()=>{if(nearRef.current||stillRef.current)return;const off=document.createElement('canvas');if(await draw(off,()=>!nearRef.current))await keep(off);off.width=off.height=0;});}
      void pdf.getPage(n).then(p=>p.cleanup()).catch(()=>{});
    };
  },[pdf,n,scale,near]);
  return <div className="ps-page" data-page={n} style={{width:w,height:viewportH}}>
    {still&&<img className="ps-still" src={still} alt="" style={{position:'absolute',left:0,top:0,width:w,height:viewportH}}/>}
    <canvas ref={canvas} style={{position:'relative',width:w,height:viewportH}} aria-label={`Page ${n}`}/>
    <div className="ps-text textLayer" ref={text}/>
    {boxes.map((b,i)=><span key={i} className="ps-mark" style={{left:b.x*scale,top:viewportH-(b.y+b.h)*scale,width:b.w*scale,height:b.h*scale,animationDelay:`${i*70}ms`}}/>)}
    <span className="ps-num">{n}</span>
  </div>;
}
