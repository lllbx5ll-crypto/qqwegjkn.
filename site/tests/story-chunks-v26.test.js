import test from 'node:test';
import assert from 'node:assert/strict';
import {handleStoryChunks} from '../server/story-chunks.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

function fakeR2(){
 const data=new Map();
 return {
  data,
  async put(key,bytes,options={}){const copy=new Uint8Array(bytes);data.set(key,{bytes:copy,size:copy.byteLength,customMetadata:options.customMetadata||{}});return {size:copy.byteLength};},
  async get(key){const obj=data.get(key);return obj?{...obj,arrayBuffer:async()=>obj.bytes.buffer.slice(0)}:null;},
  async head(key){const obj=data.get(key);return obj?{size:obj.size,customMetadata:obj.customMetadata}:null;},
  async delete(key){data.delete(key);}
 };
}
test('a 2MB+ mobile story video transfers in 1MiB chunks and rejoins byte-for-byte, with lost part response recovery',async()=>{
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>new Response('',{status:404}); // Story not yet published in Firestore.
 try{
  const bucket=fakeR2(),env={FILES:bucket,FIREBASE_PROJECT_ID:'exbots',FIREBASE_WEB_API_KEY:'public'};
  const uid='member-1',identity=async()=>({user:{uid,role:'owner'}});
  const uuid='f5422000-ef10-4d95-b3c2-b75b6b21f3e4';
  const total=2*1048576+193,source=Uint8Array.from({length:total},(_,i)=>i%251),parts=Math.ceil(total/1048576);
  for(let index=0;index<parts;index++){
   const chunk=source.slice(index*1048576,Math.min(total,(index+1)*1048576));
   const request=new Request('https://example.com/api/stage-story-chunk',{method:'POST',body:chunk,headers:{'x-file-total-size':String(total),'x-total-parts':String(parts),'x-file-size':String(chunk.byteLength)}});
   const response=await handleStoryChunks(request,env,['stage-story-chunk',uuid,String(index)],'POST',identity);
   assert.equal(response.status,201,await response.text());
   const check=await handleStoryChunks(new Request('https://example.com/api/stage-story-chunk'),env,['stage-story-chunk',uuid,String(index)],'GET',identity);
   assert.deepEqual(await check.json(),{received:true,size:chunk.byteLength});
  }
  const result=await handleStoryChunks(new Request('https://example.com/api/stage-story-complete',{method:'POST',body:JSON.stringify({size:total})}),env,['stage-story-complete',uuid],'POST',identity);
  assert.equal(result.status,200);
  const stored=bucket.data.get(`stories/${uuid}/media`);
  assert.deepEqual(stored.bytes,source);
  assert.equal(stored.customMetadata.uploadUid,uid);
  assert.equal(stored.customMetadata.storyType,'video');
  assert.equal([...bucket.data.keys()].filter(k=>k.includes('/chunks/')).length,0);
  const retry=await handleStoryChunks(new Request('https://example.com/api/stage-story-complete',{method:'POST',body:JSON.stringify({size:total})}),env,['stage-story-complete',uuid],'POST',identity);
  assert.equal(retry.status,200);
  assert.equal((await retry.json()).recovered,true);
 }finally{globalThis.fetch=oldFetch;}
});

test('the project upload source remains byte-identical to uploaded version',()=>{
 const source=readFileSync(new URL('../src/project-upload.js',import.meta.url));
 const originalHash='961eb99c'; // First 8 characters of the original ZIP's project-upload.js SHA-256.
 // Verify the project flow was not replaced by the story upload implementation.
 assert.match(source.toString(),/submitProjectWithFallback/);
 assert.doesNotMatch(source.toString(),/stage-story-chunk/);
 assert.match(readFileSync(new URL('../src/lib.js',import.meta.url),'utf8'),/export async function stageStoryVideo/);
 assert.equal(createHash('sha256').update(source).digest('hex').slice(0,8),originalHash);
});
