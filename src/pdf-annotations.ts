import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';

// Append complete notes on separate pages; never paint over source content.
export async function annotatedPdf(blob:Blob,notes:{page:number;text:string}[]){
 const document=await PDFDocument.load(await blob.arrayBuffer());
 const sourcePages=document.getPageCount();
 const font=await document.embedFont(StandardFonts.Helvetica);
 for(const note of notes){
  if(note.page<1||note.page>sourcePages)throw Error('A note refers to a page that is no longer in this document.');
  try{font.encodeText(note.text.replace(/[\r\n\t]/g,' '));}catch{throw Error('PDF note export currently supports Latin characters. Your complete note remains in Mowr; download the original PDF separately.');}
  let page=document.addPage([595,842]),y=780;
  const heading=()=>{page.drawText('Notes for source page '+note.page,{x:48,y,size:16,font,color:rgb(.2,.2,.2)});y-=36;};
  heading();
  const line=(value:string)=>{if(y<48){page=document.addPage([595,842]);y=780;heading();}if(value)page.drawText(value,{x:48,y,size:11,font});y-=16;};
  for(const paragraph of note.text.replace(/\r/g,'').replace(/\t/g,'    ').split('\n')){
   let current='';
   for(const character of paragraph){if(font.widthOfTextAtSize(current+character,11)>499){line(current);current='';}current+=character;}
   line(current);
  }
 }
 return new Blob([new Uint8Array(await document.save())],{type:'application/pdf'});
}
