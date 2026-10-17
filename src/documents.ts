import { downloadMade, getBlob } from './store';
import type { StoredFile } from '../core/types';
/** Plain-text formats read as they are, including code and technical files. */
export const textFile=/\.(md|markdown|csv|tsv|json|jsonl|txt|text|log|srt|vtt|tex|bib|rst|adoc|org|html?|xml|svg|ya?ml|toml|ini|cfg|conf|sql|py|ipynb|r|m|jl|js|mjs|cjs|jsx|ts|tsx|java|kt|kts|scala|go|rs|c|h|cc|cpp|cxx|hpp|hh|cs|swift|php|rb|pl|lua|dart|sh|bash|zsh|ps1|bat|cmd|vhd|vhdl|v|sv|asm|s|f|f90|for|gradle|cmake|proto|graphql|sol)$/i;
/** Limits for reading a file's text on this PC. Long technical files are read whole; each request then sends what fits. */
const MAX_PDF_BYTES=200_000_000,MAX_PDF_PAGES=5000,MAX_TEXT_BYTES=20_000_000,MAX_CHARS=7_900_000;
export async function extractFiles(files:StoredFile[],signal?:AbortSignal){
 let total='';
 for(const file of files){signal?.throwIfAborted();
 // The type and size are checked before the file is read, so an unsupported or oversized one is never loaded.
 const kind=file.type==='application/pdf'||/\.pdf$/i.test(file.name)?'pdf':/\.(docx|pptx|xlsx)$/i.test(file.name)?'office':file.type.startsWith('text/')||/^application\/(json|xml|javascript|x-sh|x-python|sql)/.test(file.type)||textFile.test(file.name)||/^(dockerfile|makefile|readme|license)$/i.test(file.name)?'text':null;
 if(!kind)throw new Error(`${file.name} is stored, but this file type cannot be analyzed yet. Use a PDF or text excerpt.`);
 const tooBig=(size:number)=>kind==='pdf'&&size>MAX_PDF_BYTES?'The local PDF processor supports files up to 200 MB. Split this document into smaller parts.':kind==='text'&&size>MAX_TEXT_BYTES?'This text file is over 20 MB. Use a shorter excerpt.':'';
 if(tooBig(file.size||0))throw new Error(tooBig(file.size));
 const blob=await getBlob(file.id);if(!blob)throw new Error(`${file.name} is missing from this device.`);let text='';
 if(tooBig(blob.size))throw new Error(tooBig(blob.size));
 if(kind==='pdf'){
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href;
  const loading=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),useSystemFonts:false});const pdf=await loading.promise;
  try{const pages:string[]=[];let chars=0;
  for(let p=1;p<=Math.min(pdf.numPages,MAX_PDF_PAGES);p++){signal?.throwIfAborted();const page=await pdf.getPage(p);const content=await page.getTextContent();const words=content.items.map(item=>'str' in item?item.str:'').join(' ');page.cleanup();chars+=words.length+file.name.length+20;if(chars>MAX_CHARS)break;pages.push(words);}
  // Scanned pages (no text layer, or only a page number) are read with Windows' OCR, so they can be searched and cited.
  // A long scan is read a part at a time: what is not read yet is marked, and the next request reads on (src/desktop/ocr.ts).
  const blank=pages.flatMap((t,i)=>t.replace(/\s/g,'').length<12?[i+1]:[]);let pending:number[]=[];
  if(blank.length){const {scannedText}=await import('./desktop/ocr');const ocr=await scannedText(pdf,blank,`${file.id}:${file.size}:${file.updated||file.created}`,Date.now()+45_000,signal);ocr.texts.forEach((t,p)=>{if(t)pages[p-1]=`(text read from the scanned page)\n${t}`;});pending=ocr.pending;}
  const {OCR_PENDING}=await import('./desktop/ocr');
  text=pages.map((t,i)=>`\n[${file.name}, page ${i+1}]\n${pending.includes(i+1)?OCR_PENDING:t}\n`).join('');const read=pages.length;
  if(!pending.length&&!pages.some(t=>t.replace(/\s/g,'').length>=12))text=`\n[${file.name}: a scanned or image-only PDF of ${pdf.numPages} page${pdf.numPages===1?'':'s'} whose text could not be read. Read it from its pages as they are shown to you, and look at any other page.]\n`;
  // A very long PDF is indexed as far as the text limit allows; its later pages can still be looked at as pages.
  else if(read<pdf.numPages)text+=`\n[${file.name}: the text above runs to page ${read} of ${pdf.numPages}; later pages are not in the text index. Look at them as pages.]\n`;
  // The PDF's own bookmarks with their pages: a map of a long document, to find where to read.
  // Only when it fits: a PDF read up to the text limit would otherwise go over it and not be read at all.
  const outline=await pdfOutline(pdf);if(outline&&text.length+outline.length+2*file.name.length+200<=MAX_CHARS)text=`\n[${file.name}: contents, from its bookmarks]\n${outline}\n`+text;}finally{await loading.destroy();}
 }else if(kind==='office'){text=await (await import('./office')).officeText(blob,file.name);}
 else{text=await blob.text();if(/\.ipynb$/i.test(file.name))text=notebookText(text);}
 const saved=await (await import('./document-state')).loadEdits(file);if(saved.content?.office?.length&&/\.(docx|pptx|xlsx)$/i.test(file.name)){const office=await import('./office');text=office.applyOfficePatches(await office.readOffice(blob),saved.content.office).map(b=>b.label+': '+b.text).join('\n');}else if(saved.content?.text!==undefined)text=saved.content.text;if(saved.content?.notes?.length)text+='\nSaved annotations:\n'+saved.content.notes.map(n=>'Page '+n.page+': '+n.text).join('\n');
 total+=`\nSource: ${file.name}\n${text}\n`;if(total.length>MAX_CHARS)throw new Error('Selected sources exceed the local context limit. Select fewer documents.');
 }return total;
}
/** A PDF's bookmarks as an indented list with their pages (at most 400), or "" when it has none. */
async function pdfOutline(pdf:any){
 try{
  const items=await pdf.getOutline();if(!items?.length)return '';
  const lines:string[]=[];
  const walk=async(list:any[],depth:number)=>{for(const item of list){if(lines.length>=400)return;let page='';
   try{const dest=typeof item.dest==='string'?await pdf.getDestination(item.dest):item.dest;if(Array.isArray(dest)&&dest[0])page=' — page '+((await pdf.getPageIndex(dest[0]))+1);}catch{}
   lines.push('  '.repeat(depth)+String(item.title||'').trim()+page);if(item.items?.length&&depth<3)await walk(item.items,depth+1);}};
  await walk(items,0);return lines.join('\n');
 }catch{return '';}
}
/** A Jupyter notebook as its cells, in order, without the JSON and embedded images. */
function notebookText(raw:string){
 try{const nb=JSON.parse(raw);return (nb.cells||[]).map((c:{cell_type?:string;source?:string|string[];outputs?:{text?:string|string[]}[]},i:number)=>{const src=Array.isArray(c.source)?c.source.join(''):c.source||'';const out=(c.outputs||[]).map(o=>Array.isArray(o.text)?o.text.join(''):o.text||'').filter(Boolean).join('\n');return `[cell ${i+1}, ${c.cell_type||'code'}]\n${src}${out?'\n[output]\n'+out.slice(0,4000):''}`;}).join('\n\n');}
 catch{return raw;}
}
const safeTitle=(title:string)=>title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,80)||'Mowr document';
export async function exportDocx(content:string,title='Mowr document') {
  await downloadMade(await (await import('./document-export')).docxBlob(content,title),safeTitle(title)+'.docx');
}
export async function exportSlides(content:string,title='Mowr presentation') {
  await downloadMade(await (await import('./document-export')).slidesBlob(content,title),safeTitle(title)+'.pptx');
}
