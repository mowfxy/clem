import { downloadMade, getBlob } from './store';
import type { StoredFile } from '../core/types';
/** Plain-text formats read as they are, including code and technical files. */
export const textFile=/\.(md|markdown|csv|tsv|json|jsonl|txt|text|log|srt|vtt|tex|bib|rst|adoc|org|html?|xml|svg|ya?ml|toml|ini|cfg|conf|sql|py|ipynb|r|m|jl|js|mjs|cjs|jsx|ts|tsx|java|kt|kts|scala|go|rs|c|h|cc|cpp|cxx|hpp|hh|cs|swift|php|rb|pl|lua|dart|sh|bash|zsh|ps1|bat|cmd|vhd|vhdl|v|sv|asm|s|f|f90|for|gradle|cmake|proto|graphql|sol)$/i;
/** Limits for reading a file's text on this PC. Long technical files are read whole; each request then sends what fits. */
const MAX_PDF_BYTES=200_000_000,MAX_PDF_PAGES=5000,MAX_TEXT_BYTES=20_000_000,MAX_CHARS=6_000_000;
export async function extractFiles(files:StoredFile[],signal?:AbortSignal){
 let total='';
 for(const file of files){signal?.throwIfAborted();const blob=await getBlob(file.id);if(!blob)throw new Error(`${file.name} is missing from this device.`);let text='';
 if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
  if(blob.size>MAX_PDF_BYTES)throw new Error('The local PDF processor supports files up to 200 MB. Split this document into smaller parts.');
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href;
  const loading=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),useSystemFonts:false});const pdf=await loading.promise;
  try{if(pdf.numPages>MAX_PDF_PAGES)throw new Error(`Use an excerpt of ${MAX_PDF_PAGES} pages or fewer for the local document processor.`);for(let p=1;p<=pdf.numPages;p++){signal?.throwIfAborted();const page=await pdf.getPage(p);const content=await page.getTextContent();text+=`\n[${file.name}, page ${p}]\n${content.items.map(item=>'str' in item?item.str:'').join(' ')}\n`;page.cleanup();if(text.length>MAX_CHARS)throw new Error('This PDF has more text than Mowr can read at once. Use a shorter excerpt.');}if(!text.replace(/\[.*?\]/g,'').trim())throw new Error('This PDF has no extractable text. Upload an OCR text version.');}finally{await loading.destroy();}
 }else if(/\.(docx|pptx|xlsx)$/i.test(file.name)){text=await (await import('./office')).officeText(blob,file.name);}
 else if(file.type.startsWith('text/')||/^application\/(json|xml|javascript|x-sh|x-python|sql)/.test(file.type)||textFile.test(file.name)||/^(dockerfile|makefile|readme|license)$/i.test(file.name)){if(blob.size>MAX_TEXT_BYTES)throw new Error('This text file is over 20 MB. Use a shorter excerpt.');text=await blob.text();if(/\.ipynb$/i.test(file.name))text=notebookText(text);}
 else throw new Error(`${file.name} is stored, but this file type cannot be analyzed yet. Use a PDF or text excerpt.`);
 const saved=await (await import('./document-state')).loadEdits(file);if(saved.content?.office?.length&&/\.(docx|pptx|xlsx)$/i.test(file.name)){const office=await import('./office');text=office.applyOfficePatches(await office.readOffice(blob),saved.content.office).map(b=>b.label+': '+b.text).join('\n');}else if(saved.content?.text!==undefined)text=saved.content.text;if(saved.content?.notes?.length)text+='\nSaved annotations:\n'+saved.content.notes.map(n=>'Page '+n.page+': '+n.text).join('\n');
 total+=`\nSource: ${file.name}\n${text}\n`;if(total.length>MAX_CHARS)throw new Error('Selected sources exceed the local context limit. Select fewer documents.');
 }return total;
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
