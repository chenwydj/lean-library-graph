import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jpegPdf} from '../lean_graph/web/pdf.js';

test('PDF uses byte offsets and preserves arbitrary binary image data',async()=>{
  const jpeg=Uint8Array.of(255,216,0,128,10,13,255,217);
  const pdf=jpegPdf(jpeg,640,320);
  assert.equal(pdf.type,'application/pdf');
  const data=new Uint8Array(await pdf.arrayBuffer());
  const text=Buffer.from(data).toString('latin1');
  const xref=Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(xref,xref+4),'xref');
  const entries=text.slice(xref).split('\n').slice(3,8);
  entries.forEach((entry,i)=>assert.ok(text.slice(Number(entry.slice(0,10))).startsWith(`${i+1} 0 obj\n`)));
  const stream=text.indexOf('stream\n',text.indexOf('4 0 obj'))+7;
  assert.deepEqual(data.slice(stream,stream+jpeg.length),jpeg);
  assert.match(text,/\/MediaBox \[0 0 1200.000 600.000\]/);
  assert.match(text,/\/Width 640 \/Height 320/);
  assert.match(text,/\/Count 1/);
});

test('PDF rejects invalid image dimensions',()=>{
  for(const [w,h] of [[0,3],[3,-1],[Infinity,2],[2,NaN],[1.5,2]])
    assert.throws(()=>jpegPdf(Uint8Array.of(1),w,h),/Invalid PDF image/);
});
