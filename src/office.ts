import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
export type OfficePatch={part:string;index:number;text:string};
export type OfficeBlock=OfficePatch & {label:string;editable:boolean};
export const officePart=/^(word\/document|ppt\/slides\/slide\d+|xl\/worksheets\/sheet\d+)\.xml$/;
async function packageFiles(blob:Blob,all=false){
 if(blob.size>30_000_000)throw Error('Choose an Office file under 30 MB.');
 let expanded=0;
 return unzipSync(new Uint8Array(await blob.arrayBuffer()),{filter:entry=>{expanded+=entry.originalSize;if(expanded>60_000_000)throw Error('The expanded document is too large.');return all||officePart.test(entry.name)||entry.name==='xl/sharedStrings.xml';}});
}
function xml(bytes:Uint8Array){const doc=new DOMParser().parseFromString(strFromU8(bytes),'application/xml');if(doc.querySelector('parsererror')||doc.doctype)throw Error('This Office document contains unsupported XML.');return doc;}
const elements=(node:Element|Document,name:string)=>Array.from(node.getElementsByTagNameNS('*',name));
const value=(node:Element|Document,name:string)=>elements(node,name).map(n=>n.textContent||'').join('');
export async function readOffice(blob:Blob):Promise<OfficeBlock[]>{
 const files=await packageFiles(blob);
 const shared=files['xl/sharedStrings.xml']?elements(xml(files['xl/sharedStrings.xml']),'si').map(n=>value(n,'t')):[];
 const blocks:OfficeBlock[]=[];
 for(const part of Object.keys(files).filter(k=>officePart.test(k)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))){
  const doc=xml(files[part]),sheet=part.startsWith('xl/');
  elements(doc,sheet?'c':'p').forEach((node,index)=>{
   // A formula with no saved result (a workbook Mowr made, which Excel calculates on open) shows the formula itself.
   const raw=sheet?value(node,'v')||value(node,'t')||(elements(node,'f').length?'='+value(node,'f'):''):value(node,'t');
   const text=sheet&&node.getAttribute('t')==='s'?shared[Number(raw)]||'':raw;
   const section=part.startsWith('ppt/')?'Slide '+part.match(/slide(\d+)/)?.[1]:sheet?'Sheet '+part.match(/sheet(\d+)/)?.[1]:'Document';
   blocks.push({part,index,text,label:section+(sheet?' · '+node.getAttribute('r'):' · Paragraph '+(index+1)),editable:sheet?elements(node,'f').length===0:elements(node,'t').length>0});
  });
 }
 if(blocks.length>5000||blocks.reduce((n,b)=>n+b.text.length,0)>200000)throw Error('Choose a shorter document excerpt.');
 if(!blocks.some(b=>b.text.trim()))throw Error('This Office document has no readable text.');
 return blocks;
}
export function applyOfficePatches(blocks:OfficeBlock[],patches:OfficePatch[]){
 const map=new Map(patches.map(p=>[p.part+':'+p.index,p.text]));
 return blocks.map(block=>({...block,text:map.get(block.part+':'+block.index)??block.text}));
}
export async function officeText(blob:Blob,_name:string){return(await readOffice(blob)).map(b=>b.text).join('\n');}
export async function exportOffice(blob:Blob,patches:OfficePatch[]){
 const files=await packageFiles(blob,true),docs=new Map<string,Document>();
 if(patches.length>500||patches.reduce((n,p)=>n+p.text.length,0)>200000)throw Error('Too many document edits.');
 for(const patch of patches){
  if(!officePart.test(patch.part)||!files[patch.part]||!Number.isSafeInteger(patch.index)||patch.index<0||patch.text.length>20000)throw Error('Invalid Office edit.');
  let doc=docs.get(patch.part);if(!doc){doc=xml(files[patch.part]);docs.set(patch.part,doc);}
  const sheet=patch.part.startsWith('xl/'),node=elements(doc,sheet?'c':'p')[patch.index];if(!node)throw Error('The edited element is no longer in this document.');
  if(sheet){
   if(elements(node,'f').length)throw Error('Formula cells cannot be overwritten by the text editor.');
   // Preserve numeric cell types where possible, without interpreting text as formulas.
   const numeric=(!node.hasAttribute('t')||node.getAttribute('t')==='n')&&patch.text.trim()!==''&&/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(patch.text)&&Number.isFinite(Number(patch.text));
   for(const child of Array.from(node.children))if(['v','is'].includes(child.localName))child.remove();
   if(numeric){node.setAttribute('t','n');const v=doc.createElementNS(node.namespaceURI,'v');v.textContent=patch.text;node.append(v);}
   else{node.setAttribute('t','inlineStr');const inline=doc.createElementNS(node.namespaceURI,'is'),t=doc.createElementNS(node.namespaceURI,'t');t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.textContent=patch.text;inline.append(t);node.append(inline);}
  }else{
   const texts=elements(node,'t');if(!texts.length)throw Error('This empty paragraph cannot be edited yet.');
   texts[0].textContent=patch.text;texts[0].setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');for(const rest of texts.slice(1))rest.textContent='';
  }
 }
 for(const [part,doc] of docs)files[part]=strToU8(new XMLSerializer().serializeToString(doc));
 return new Blob([new Uint8Array(zipSync(files,{level:6}))],{type:blob.type||'application/octet-stream'});
}
