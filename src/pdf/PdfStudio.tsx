import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import './pdf-studio.css';

type Box={page:number;x:number;y:number;w:number;h:number};

/** Continuous pages, rendered sharp for the screen, with optional highlight boxes. `zoom` scales the fitted width;
 *  `onLayout` runs once the pages are laid out at a new size, before they paint, so the reader can keep its place. */
export function Pages({pdf,highlights,onSelect,zoom=1,onLayout}:{pdf:PDFDocumentProxy;highlights:Box[];onSelect?:(text:string)=>void;zoom?:number;onLayout?:()=>void}){
  const host=useRef<HTMLDivElement>(null);
  const [fit,setFit]=useState(0);
  // Resizing the reader (dragging its edge) lays the pages out again once the size settles, not on every pixel.
  useEffect(()=>{const el=host.current;if(!el)return;let t=0,first=true;const measure=()=>setFit(Math.max(160,Math.min(920,el.clientWidth-48)));const ro=new ResizeObserver(()=>{clearTimeout(t);if(first){first=false;measure();}else t=window.setTimeout(measure,140);});ro.observe(el);return()=>{clearTimeout(t);ro.disconnect();};},[]);
  const width=Math.round(fit*zoom);
  const [pages,setPages]=useState<{n:number;w:number;h:number;scale:number}[]>([]);
  useEffect(()=>{
    if(!width)return;let cancelled=false;
    void (async()=>{const out=[];for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n);const base=p.getViewport({scale:1});const scale=width/base.width;out.push({n,w:width,h:base.height*scale,scale});}if(!cancelled)setPages(out);})();
    return()=>{cancelled=true;};
  },[pdf,width]);
  const layout=useRef(onLayout);layout.current=onLayout;
  useLayoutEffect(()=>{if(pages.length)layout.current?.();},[pages]);
  // Pages away from the view are drawn one after another in the background, never all at once.
  const queue=useRef<Promise<void>>(Promise.resolve());
  const later=(job:()=>Promise<void>)=>{queue.current=queue.current.then(job).catch(()=>{});};
  return <div className="ps-pages" ref={host} onMouseUp={()=>{const s=window.getSelection()?.toString();if(s&&onSelect)onSelect(s.slice(0,8000));}}>
    {pages.map(p=><Page key={p.n} pdf={pdf} n={p.n} w={p.w} h={p.h} scale={p.scale} later={later} boxes={highlights.filter(b=>b.page===p.n)}/>)}
  </div>;
}

type Later=(job:()=>Promise<void>)=>void;

/** Dragging a text selection over the blank space between lines makes the browser pick the nearest text in the page's
 *  order, often its very end, so one drag selected the whole page. As in pdf.js's own viewer, each text layer ends in
 *  an empty box that covers the layer while selecting and sits right after the point the selection reached, so blank
 *  space extends the selection to where the pointer is instead. */
let lastRange:Range|null=null;
function followSelection(){
  const sel=getSelection();
  if(!sel?.rangeCount){lastRange=null;return;}
  const range=sel.getRangeAt(0);
  const start=!!lastRange&&(range.compareBoundaryPoints(Range.END_TO_END,lastRange)===0||range.compareBoundaryPoints(Range.START_TO_END,lastRange)===0);
  let at:Node|null=start?range.startContainer:range.endContainer;
  if(at?.nodeType===Node.TEXT_NODE)at=at.parentNode;
  const layer=(at as Element|null)?.parentElement?.closest('.ps-text'),end=layer?.querySelector(':scope .endOfContent');
  if(layer&&end&&at&&at!==end&&at.parentElement)at.parentElement.insertBefore(end,start?at:at.nextSibling);
  lastRange=range.cloneRange();
}
let selecting=0;
function startSelecting(layer:HTMLElement){
  layer.classList.add('selecting');
  if(selecting++===0)document.addEventListener('selectionchange',followSelection);
  const done=()=>{layer.classList.remove('selecting');removeEventListener('pointerup',done);removeEventListener('blur',done);if(--selecting===0)document.removeEventListener('selectionchange',followSelection);lastRange=null;};
  addEventListener('pointerup',done);addEventListener('blur',done);
}

/** Every page is drawn sharp, as before. Pages near the view stay live canvases; a page further away is kept as a
 *  lossless PNG of the same pixels, so it shows at once when scrolled back to while holding a fraction of the
 *  memory (35 pages at 2× were ~640 MB of live bitmaps). The pages scroll inside the viewer, so its scroll box is
 *  the root the distances are measured from. */
function Page({pdf,n,w,h,scale,boxes,later}:{pdf:PDFDocumentProxy;n:number;w:number;h:number;scale:number;boxes:Box[];later:Later}){
  const canvas=useRef<HTMLCanvasElement>(null),text=useRef<HTMLDivElement>(null);
  // The page's height is known before it is drawn (the same viewport), so the layout never shifts as pages draw.
  const viewportH=h;
  const [near,setNear]=useState(false),[still,setStill]=useState('');
  const nearRef=useRef(false),stillRef=useRef(''),texted=useRef(false);
  // pdf.js refuses a second render on a canvas that is still drawing, which left a page half drawn at its old size
  // after a resize: draws on the live canvas wait for the one before them (a cancelled one ends within 50 ms).
  const live=useRef<Promise<unknown>>(Promise.resolve()),liveTask=useRef<{cancel:()=>void}|null>(null);
  const ratio=Math.min(window.devicePixelRatio||1,2);
  const draw=async(target:HTMLCanvasElement,alive:()=>boolean)=>{
    const page=await pdf.getPage(n);if(!alive())return false;const viewport=page.getViewport({scale});
    target.width=Math.floor(viewport.width*ratio);target.height=Math.floor(viewport.height*ratio);
    const task=page.render({canvas:target,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]}) as unknown as {cancel:()=>void;promise:Promise<void>};
    if(target===canvas.current)liveTask.current=task;
    const stop=setInterval(()=>{if(!alive())task.cancel();},50);
    try{await task.promise;}finally{clearInterval(stop);}
    if(!alive())return false;
    if(!texted.current&&text.current){
      texted.current=true;
      const {TextLayer}=await import('pdfjs-dist');text.current.replaceChildren();text.current.style.setProperty('--total-scale-factor',String(scale));
      await new TextLayer({textContentSource:await page.getTextContent(),container:text.current,viewport}).render();
      const end=document.createElement('div');end.className='endOfContent';text.current.append(end);
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
    const run=live.current.catch(()=>{}).then(()=>cancelled?false:draw(c,()=>!cancelled)).then(ok=>{drawn=!!ok;}).catch(()=>{});live.current=run;
    return()=>{
      cancelled=true;liveTask.current?.cancel();liveTask.current=null;
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
    <div className="ps-text textLayer" ref={text} onPointerDown={e=>{if(e.button===0)startSelecting(e.currentTarget);}}/>
    {boxes.map((b,i)=><span key={i} className="ps-mark" style={{left:b.x*scale,top:viewportH-(b.y+b.h)*scale,width:b.w*scale,height:b.h*scale,animationDelay:`${i*70}ms`}}/>)}
    <span className="ps-num">{n}</span>
  </div>;
}
