import test from 'node:test';
import assert from 'node:assert/strict';
import {validFile,isUploadedFile} from '../server/api.js';

test('multipart upload: valid File and foreign-realm File-like object accepted',async()=>{
  const good=new File([Uint8Array.of(80,75,3,4,0,0)],'working.zip',{type:'application/zip'});
  assert.equal(validFile(good,'file'),good);
  const foreign={size:good.size,name:good.name,type:good.type,arrayBuffer:()=>good.arrayBuffer()};
  assert.equal(foreign instanceof File,false);
  assert.equal(isUploadedFile(foreign),true);
  assert.equal(validFile(foreign,'file'),foreign);
});
test('multipart upload: empty, missing and wrong types rejected explicitly',()=>{
  assert.throws(()=>validFile(new File([],'empty.zip',{type:'application/zip'}),'file'),/صفر بايت/);
  assert.throws(()=>validFile(null,'file'),/لم يصل الملف/);
  assert.throws(()=>validFile('not-a-file','file'),/لم يصل الملف/);
  const oversized={size:3*1024*1024+1,name:'big.zip',type:'application/zip',arrayBuffer:async()=>new ArrayBuffer(0)};
  assert.throws(()=>validFile(oversized,'file'),/3MB/);
});
