import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import {Document,Packer,Paragraph} from 'docx';
import PptxGenJS from 'pptxgenjs';
import {zipSync,strToU8} from 'fflate';
import assert from 'node:assert/strict';
const server=await createServer({server:{host:'127.0.0.1',port:5198,strictPort:true}});await server.listen();
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5198/');
 const doc=await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('Original paragraph')]}]}));
 const slides=new PptxGenJS();slides.addSlide().addText('Original slide',{x:1,y:1,w:5,h:1});const ppt=await slides.write({outputType:'nodebuffer'});
 const workbook=zipSync({'xl/worksheets/sheet1.xml':strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"><v>12</v></c><c r="B1"><f>A1*2</f><v>24</v></c></row></sheetData></worksheet>')});
 const result=await page.evaluate(async({doc,ppt,workbook})=>{
  const office=await import('/src/office.ts');
  const check=async(bytes,name,replacement)=>{const original=new Blob([Uint8Array.from(bytes)]),blocks=await office.readOffice(original),block=blocks.find(b=>b.editable);const exported=await office.exportOffice(original,[{part:block.part,index:block.index,text:replacement}]);const edited=await office.readOffice(exported);return {original:blocks[0].text,edited:edited[0].text};};
  const docx=await check(doc,'sample.docx','Changed paragraph'),pptx=await check(ppt,'sample.pptx','Changed slide');
  const original=new Blob([Uint8Array.from(workbook)]),blocks=await office.readOffice(original);let formulaRejected=false;
  try{await office.exportOffice(original,[{part:blocks[1].part,index:blocks[1].index,text:'999'}]);}catch{formulaRejected=true;}
  const exported=await office.exportOffice(original,[{part:blocks[0].part,index:blocks[0].index,text:'=1+1'}]),edited=await office.readOffice(exported);
  return {docx,pptx,formulaRejected,literal:edited[0].text,formulaPreserved:edited[1].text};
 },{doc:[...doc],ppt:[...ppt],workbook:[...workbook]});
 assert.deepEqual(result,{docx:{original:'Original paragraph',edited:'Changed paragraph'},pptx:{original:'Original slide',edited:'Changed slide'},formulaRejected:true,literal:'=1+1',formulaPreserved:'24'});
 console.log('Office round trips passed: DOCX paragraphs, PPTX text, formula protection, literal cell text and preserved formula values.');
}finally{await browser.close();await server.close();}
