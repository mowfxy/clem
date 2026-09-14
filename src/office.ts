import {unzipSync,strFromU8} from 'fflate';

// Read XML as data only. Never insert imported markup into the page.
export async function officeText(blob:Blob,name:string){
 if(blob.size>30_000_000)throw Error('Choose an Office file under 30 MB.');
 let expanded=0;
 const files=unzipSync(new Uint8Array(await blob.arrayBuffer()),{filter:entry=>{
  expanded+=entry.originalSize;
  if(expanded>60_000_000)throw Error('The expanded document is too large.');
  return /^(word\/document|ppt\/slides\/slide\d+|xl\/sharedStrings|xl\/worksheets\/sheet\d+)\.xml$/.test(entry.name);
 }});
 const xml=(bytes:Uint8Array)=>{const doc=new DOMParser().parseFromString(strFromU8(bytes),'application/xml');if(doc.querySelector('parsererror'))throw Error('This Office document contains invalid XML.');return doc;};
 const texts=(el:Element|Document,tag:string)=>Array.from(el.getElementsByTagNameNS('*',tag)).map(n=>n.textContent||'');
 const shared=files['xl/sharedStrings.xml']?Array.from(xml(files['xl/sharedStrings.xml']).getElementsByTagNameNS('*','si')).map(n=>texts(n,'t').join('')):[];
 const parts=Object.keys(files).filter(k=>!k.endsWith('sharedStrings.xml')).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(k=>{
  const doc=xml(files[k]);
  if(k.startsWith('xl/'))return Array.from(doc.getElementsByTagNameNS('*','row')).map(row=>Array.from(row.getElementsByTagNameNS('*','c')).map(c=>{
   const value=texts(c,'v')[0]||texts(c,'t').join('');return `${c.getAttribute('r')||''}: ${c.getAttribute('t')==='s'?shared[Number(value)]||'':value}`;
  }).join(' | ')).join('\n');
  return Array.from(doc.getElementsByTagNameNS('*','p')).map(p=>texts(p,'t').join('')).join('\n');
 });
 const result=parts.join('\n\n');
 if(!result.trim())throw Error(`${name} has no readable document text.`);
 if(result.length>200_000)throw Error('Choose a shorter document excerpt.');
 return result;
}
