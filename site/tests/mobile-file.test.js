import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotUploadFile } from '../src/mobile-file.js';
import { readFileSync } from 'node:fs';

test('copies file contents without reading original size, preserving name and bytes', async () => {
  const b = new Uint8Array([80,75,3,4,1,2,3]);
  const pickerFile = {
    name: 'bot.zip', type: 'application/zip',
    get size() { throw new Error('Do not access device-backed File.size before reading!'); },
    stream() { return new Blob([b]).stream(); }
  };
  const local = await snapshotUploadFile(pickerFile, 3*1024*1024);
  assert.equal(local.name, 'bot.zip');
  assert.deepEqual([...new Uint8Array(await local.arrayBuffer())], [...b]);
  assert.equal(local.size,b.length);
});

test('rejects large selection after bounded streaming; never buffers entire large file', async () => {
  const pickerFile = { name:'huge.zip',type:'application/zip',stream(){return new Blob([new Uint8Array(1024),new Uint8Array(1024)]).stream();}};
  await assert.rejects(snapshotUploadFile(pickerFile, 1024), e=>e.code==='FILE_TOO_LARGE');
});

test('empty file and inaccessible mobile file picker produce actionable errors', async () => {
  await assert.rejects(snapshotUploadFile({name:'blank.zip',stream(){return new Blob([]).stream()}},1024),/فارغ/);
  await assert.rejects(snapshotUploadFile({name:'drive.zip',stream(){throw new Error('provider unavailable')}},1024),/تعذرت قراءة/);
});

test('upload page prepares files before reading size or submitting',()=>{
  const src = readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  assert.match(src,/snapshotUploadFile\(f,sizeLimit\)/);
  assert.match(src,/disabled=\{busy\|\|preparing>0\}/);
  assert.match(src,/onClick=\{e=>e\.stopPropagation\(\)\}/);
});

test('2MB project ZIP is materialized and can be appended to multipart form safely', async () => {
  const data=new Uint8Array(2_000_000);data.set([0x50,0x4b,3,4],0);data[124]=43;
  const androidPicked={name:'FLOWTECH.zip',type:'application/zip',stream(){return new Blob([data]).stream();}};
  const snapshot=await snapshotUploadFile(androidPicked,3*1024*1024);
  const form=new FormData();form.append('file',snapshot,snapshot.name);
  assert.equal(form.get('file').size,data.length);
  assert.equal(form.get('file').name,'FLOWTECH.zip');
  assert.deepEqual([...new Uint8Array(await form.get('file').slice(0,4).arrayBuffer())],[0x50,0x4b,3,4]);
});
