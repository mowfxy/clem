import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {textPdf} from '../../desktop/documents.ts';
test('local PDF export paginates long responses and preserves a valid page structure',async()=>{const bytes=await textPdf(Array.from({length:200},(_,i)=>`Line ${i}: geometry uses deterministic calculations.`).join('\n'));const pdf=await PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>3);assert.equal(pdf.getPage(0).getWidth(),595.28);});
test('local PDF export rejects unsupported glyphs and unbounded words',async()=>{await assert.rejects(()=>textPdf('مرحبا'));await assert.rejects(()=>textPdf('a'.repeat(300)));});
