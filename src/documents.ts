import { download, getBlob } from './store';
import type { StoredFile } from '../core/types';
export async function extractFiles(files:StoredFile[],signal?:AbortSignal){
 let total='';
 for(const file of files){signal?.throwIfAborted();const blob=await getBlob(file.id);if(!blob)throw new Error(`${file.name} is missing from this device.`);let text='';
 if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
  if(blob.size>30_000_000)throw new Error('The local PDF processor supports files up to 30 MB. Split this document into smaller parts.');
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href;
  const loading=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),useSystemFonts:false});const pdf=await loading.promise;
  try{if(pdf.numPages>200)throw new Error('Use an excerpt of 200 pages or fewer for the local document processor.');for(let p=1;p<=pdf.numPages;p++){signal?.throwIfAborted();const page=await pdf.getPage(p);const content=await page.getTextContent();text+=`\n[${file.name}, page ${p}]\n${content.items.map(item=>'str' in item?item.str:'').join(' ')}\n`;page.cleanup();if(text.length>180_000)throw new Error('This PDF exceeds the local context budget. Use a shorter excerpt.');}if(!text.replace(/\[.*?\]/g,'').trim())throw new Error('This PDF has no extractable text. Upload an OCR text version.');}finally{await loading.destroy();}
 }else if(/\.(docx|pptx|xlsx)$/i.test(file.name)){text=await (await import('./office')).officeText(blob,file.name);}
 else if(file.type.startsWith('text/')||/\.(md|csv|json|txt|srt|vtt)$/i.test(file.name)){if(blob.size>180_000)throw new Error('This text file exceeds the 180 KB local context limit.');text=await blob.text();}
 else throw new Error(`${file.name} is stored, but this file type cannot be analyzed yet. Use a PDF or text excerpt.`);
 const saved=await (await import('./document-state')).loadEdits(file);if(saved.content?.office?.length&&/\.(docx|pptx|xlsx)$/i.test(file.name)){const office=await import('./office');text=office.applyOfficePatches(await office.readOffice(blob),saved.content.office).map(b=>b.label+': '+b.text).join('\n');}else if(saved.content?.text!==undefined)text=saved.content.text;if(saved.content?.notes?.length)text+='\nSaved annotations:\n'+saved.content.notes.map(n=>'Page '+n.page+': '+n.text).join('\n');
 total+=`\nSource: ${file.name}\n${text}\n`;if(total.length>200_000)throw new Error('Selected sources exceed the local context limit. Select fewer documents.');
 }return total;
}
const safeTitle=(title:string)=>title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').slice(0,80)||'Mowr document';
export async function exportDocx(content:string,title='Mowr document') {
  download(await (await import('./document-export')).docxBlob(content,title),safeTitle(title)+'.docx');
}
export async function exportSlides(content:string,title='Mowr presentation') {
  download(await (await import('./document-export')).slidesBlob(content,title),safeTitle(title)+'.pptx');
}
