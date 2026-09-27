import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {textPdf,viewCopyName} from '../../desktop/documents.ts';
test('local PDF export paginates long responses and preserves a valid page structure',async()=>{const bytes=await textPdf(Array.from({length:200},(_,i)=>`Line ${i}: geometry uses deterministic calculations.`).join('\n'));const pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>3);assert.equal(pdf.getPage(0).getWidth(),595.28);});
test('local PDF export rejects unsupported glyphs and unbounded words',async()=>{await assert.rejects(()=>textPdf('مرحبا'));await assert.rejects(()=>textPdf('a'.repeat(300)));});
test('files opened from the workspace are limited to documents and media, never programs or scripts',()=>{for(const name of ['Lecture.pdf','notes.docx','Slides.PPTX','clip.mp4','scan.jpeg'])assert.equal(viewCopyName(name),name);for(const name of ['setup.exe','notes.pdf.js','run.cmd','run.bat','link.lnk','x.hta','x.ps1','x.vbs','x.msi','x.scr','report.docm','book.xlsm','x.url','x.jar','noextension'])assert.equal(viewCopyName(name),null,name);assert.equal(viewCopyName('setup.exe. . '),null);assert.equal(viewCopyName('a/b\\c:d.pdf'),'a-b-c-d.pdf');assert.equal(viewCopyName('report.pdf.'),'report.pdf');});
