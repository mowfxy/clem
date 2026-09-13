import { download, getBlob } from './store';
import type { StoredFile } from '../core/types';
export async function extractFiles(files:StoredFile[],signal?:AbortSignal){
 let total='';
 for(const file of files){signal?.throwIfAborted();const blob=await getBlob(file.id);if(!blob)throw new Error(`${file.name} is missing from this device.`);let text='';
 if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
  if(blob.size>30_000_000)throw new Error('The local PDF processor supports files up to 30 MB. Split this document into smaller parts.');
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).href;
  const loading=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer()),useSystemFonts:false});const pdf=await loading.promise;
  try{if(pdf.numPages>200)throw new Error('Use an excerpt of 200 pages or fewer for this local development connection.');for(let p=1;p<=pdf.numPages;p++){signal?.throwIfAborted();const page=await pdf.getPage(p);const content=await page.getTextContent();text+=`\n[${file.name}, page ${p}]\n${content.items.map(item=>'str' in item?item.str:'').join(' ')}\n`;page.cleanup();if(text.length>180_000)throw new Error('This PDF exceeds the local context budget. Use a shorter excerpt.');}if(!text.replace(/\[.*?\]/g,'').trim())throw new Error('This PDF has no extractable text. Upload an OCR text version.');}finally{await loading.destroy();}
 }else if(file.type.startsWith('text/')||/\.(md|csv|json|txt|srt|vtt)$/i.test(file.name)){if(blob.size>180_000)throw new Error('This text file exceeds the 180 KB local context limit.');text=await blob.text();}
 else throw new Error(`${file.name} is stored, but this file type cannot be analyzed yet. Use a PDF or text excerpt.`);
 total+=`\nSource: ${file.name}\n${text}\n`;if(total.length>200_000)throw new Error('Selected sources exceed the local context limit. Select fewer documents.');
 }return total;
}
export async function exportDocx(content:string,title='Mowr document'){
 const {Document,Packer,Paragraph,TextRun,HeadingLevel}=await import('docx');
 const children=content.split('\n').map(line=>{const heading=line.match(/^(#{1,3})\s+(.+)/);return new Paragraph({...(heading?{heading:heading[1].length===1?HeadingLevel.HEADING_1:heading[1].length===2?HeadingLevel.HEADING_2:HeadingLevel.HEADING_3}:{}),children:[new TextRun({text:heading?heading[2]:line,font:'Soft Ink Serif',size:heading?32:23})],spacing:{after:150,line:300}});});
 const doc=new Document({title,creator:'Mowr',styles:{default:{document:{run:{font:'Soft Ink Serif',size:23}}}},sections:[{properties:{},children}]});download(await Packer.toBlob(doc),`${title.slice(0,50)}.docx`);
}
export async function exportSlides(content:string,title='Mowr presentation'){
 const {default:PptxGenJS}=await import('pptxgenjs');const pptx=new PptxGenJS();pptx.layout='LAYOUT_WIDE';pptx.author='Mowr';pptx.title=title;pptx.theme={headFontFace:'Soft Ink Serif',bodyFontFace:'Soft Ink Serif'};
 const sections=content.split(/\n(?=#{1,2}\s)/).filter(Boolean);for(const section of sections){const lines=section.split('\n').filter(Boolean);const heading=(lines.shift()||title).replace(/^#+\s*/,'');const body=lines.join('\n');const chunks=body.match(/[\s\S]{1,1000}/g)||[''];for(let i=0;i<chunks.length;i++){const slide=pptx.addSlide();slide.background={color:'171717'};slide.addText(`${heading}${i?' · continued':''}`,{x:.65,y:.55,w:12,h:.8,fontFace:'Soft Ink Serif',fontSize:29,color:'E5E2DB',breakLine:false});slide.addText(chunks[i],{x:.7,y:1.7,w:11.8,h:4.8,fontFace:'Soft Ink Serif',fontSize:18,color:'C9CDC0',valign:'top',breakLine:false});slide.addText('Mowr',{x:.7,y:7,w:3,h:.2,fontSize:10,color:'9CA48C'});}}
 await pptx.writeFile({fileName:`${title.slice(0,50)}.pptx`});
}

