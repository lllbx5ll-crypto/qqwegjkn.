import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {onApiRequest} from '../server/api.js';
import {mp4DurationSeconds} from '../server/features.js';
import {fields,dec} from '../server/codec.js';

const enc=bytes=>Buffer.from(bytes).toString('base64url');
async function fixture(){
 const now=Math.floor(Date.now()/1000);
 const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey);
 const kid='staging-'+crypto.randomUUID();
 const token=async(uid)=>{
  const h=enc(JSON.stringify({alg:'RS256',kid,typ:'JWT'}));
  const p=enc(JSON.stringify({aud:'exbots',iss:'https://securetoken.google.com/exbots',sub:uid,iat:now,exp:now+3600,auth_time:now,email:uid+'@example.test',email_verified:true,name:uid}));
  const sig=await crypto.subtle.sign({name:'RSASSA-PKCS1-v1_5'},pair.privateKey,new TextEncoder().encode(h+'.'+p));
  return `${h}.${p}.${enc(sig)}`;
 };
 const docs=new Map([['users/author',{uid:'author',displayName:'المطور',role:'user',plan:'plus',planEndsAt:'2100-01-01T00:00:00Z',verified:false}]]);
 const objects=new Map();
 const r2={
  put:async(key,bytes,opts={})=>{
   assert.ok(bytes instanceof Uint8Array || bytes instanceof ArrayBuffer,
     'R2 mock enforces production known-length requirement; unknown-length streams are invalid');
   const data=new Uint8Array(bytes instanceof ArrayBuffer?bytes:bytes.slice().buffer);
   objects.set(key,{data,opts});return {size:data.length,customMetadata:opts.customMetadata||{}};
  },
  head:async key=>{const x=objects.get(key);return x?{size:x.data.length,customMetadata:x.opts.customMetadata||{},httpMetadata:x.opts.httpMetadata||{}}:null},
  get:async(key,{range}={})=>{const x=objects.get(key);if(!x)return null;const data=range?x.data.subarray(range.offset,range.offset+range.length):x.data;return {body:new Blob([data]).stream(),arrayBuffer:async()=>data.slice().buffer,httpMetadata:x.opts.httpMetadata||{},customMetadata:x.opts.customMetadata||{}}},
  delete:async key=>{objects.delete(key)}
 };
 const env={FIREBASE_PROJECT_ID:'exbots',FIREBASE_WEB_API_KEY:'test-web-key',OWNER_EMAIL:'owner@example.test',FILES:r2};
 const toDoc=(key,val)=>({name:'projects/exbots/databases/(default)/documents/'+key,fields:fields(val),updateTime:'2026-11-04T10:00:00Z'});
 const fetchMock=async(input,options={})=>{
  const url=new URL(String(input));
  if(url.hostname==='www.googleapis.com')return Response.json({keys:[{...publicKey,kid,alg:'RS256',use:'sig'}]});
  assert.equal(url.hostname,'firestore.googleapis.com');
  const match=url.pathname.match(/\/documents\/([^/:]+)(?:\/([^/:?]+))?$/);
  const key=match?.[2]?`${match[1]}/${decodeURIComponent(match[2])}`:null;
  const method=options.method||'GET';
  if(method==='GET')return docs.has(key)?Response.json(toDoc(key,docs.get(key))):Response.json({error:{message:'Not found'}},{status:404});
  if(url.pathname.endsWith(':runQuery')){
   const q=JSON.parse(options.body).structuredQuery;const f=q.where?.fieldFilter;const needle=f?.value?.stringValue??f?.value?.integerValue;
   const result=[...docs.entries()].filter(([k,v])=>k.startsWith(q.from[0].collectionId+'/')).filter(([k,v])=>!f||v[f.field.fieldPath]===needle);
   return Response.json(result.map(([k,v])=>({document:toDoc(k,v)})));
  }
  if(url.pathname.endsWith(':commit')){
   const data=JSON.parse(options.body);
   for(const w of data.writes){
    if(w.update){const k=w.update.name.split('/documents/')[1];docs.set(k,Object.fromEntries(Object.entries(w.update.fields||{}).map(([n,v])=>[n,dec(v)])));}
    if(w.delete)docs.delete(w.delete.split('/documents/')[1]);
   }
   return Response.json({commitTime:'2026-11-04T10:00:00Z'});
  }
  if(method==='PATCH'){
   const changes=Object.fromEntries(Object.entries(JSON.parse(options.body).fields||{}).map(([n,v])=>[n,dec(v)]));docs.set(key,{...docs.get(key),...changes});return Response.json(toDoc(key,docs.get(key)));
  }
  if(method==='DELETE'){docs.delete(key);return Response.json({});}
  throw Error(`Unexpected request ${method} ${url}`);
 };
 const call=async(uid,path,method='GET',body,headers={})=>onApiRequest({env,request:new Request('https://nexbots.pages.dev/api/'+path,{method,headers:{Authorization:'Bearer '+await token(uid),...headers},body})});
 return {token,docs,objects,env,call,fetchMock};
}
function makeBox(type,bytes){const len=Buffer.alloc(8);len.writeUInt32BE(bytes.length+8);len.write(type,4,'ascii');return Buffer.concat([len,bytes]);}
function mp4(durationMs=14000){const mvhd=Buffer.alloc(24);mvhd.writeUInt32BE(1000,12);mvhd.writeUInt32BE(durationMs,16);return new Uint8Array(Buffer.concat([makeBox('ftyp',Buffer.from('isom0000')),makeBox('moov',makeBox('mvhd',mvhd))]));}
const projectForm=id=>{const form=new FormData();for(const [k,v] of Object.entries({submissionId:id,title:'بوت حديث لإدارة واتساب',description:'مشروع بوت عملي مع تعليمات وأوامر وبرمجيات متكاملة للمطورين',category:'whatsapp',language:'JavaScript',tags:'واتساب',usage:'حمّل الملف',stagedAssets:'1',imageName:'cover.jpg',fileName:'worker.js'}))form.append(k,v);return form;};
const image=new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,0,0]);
const stage=async(fx,uid,section,id,slot,bytes,filename,storyType='')=>fx.call(uid,`stage/${section}/${id}/${slot}`,'POST',new Blob([bytes]),{'x-file-name':encodeURIComponent(filename),'x-file-size':String(bytes.length),'x-story-type':storyType,'content-type':'application/octet-stream'});

test('Project media streams to R2 independently, then Firestore saves small metadata and exact receipt',async()=>{
 const fx=await fixture(),old=globalThis.fetch;globalThis.fetch=fx.fetchMock;
 try{
  const id=crypto.randomUUID(),script=new Uint8Array(2_800_000);script.fill(65);
  const cover=await stage(fx,'author','projects',id,'image',image,'cover.jpg');assert.equal(cover.status,201,await cover.text());
  const file=await stage(fx,'author','projects',id,'file',script,'worker.js');assert.equal(file.status,201,await file.text());
  assert.equal(fx.objects.get(`projects/${id}/file`)?.data.length,2_800_000);
  assert.equal(fx.objects.get(`projects/${id}/cover`)?.opts.httpMetadata.contentType,'image/jpeg');
  const status=await fx.call('author',`stage-status/projects/${id}/file`);assert.deepEqual(await status.json(),{received:true,size:2_800_000});
  const different=await fx.call('guest',`stage-status/projects/${id}/file`);assert.equal((await different.json()).received,false);
  const result=await fx.call('author','projects','POST',projectForm(id));assert.equal(result.status,201,await result.clone().text());
  assert.equal((await result.json()).id,id);assert.equal(fx.docs.get('projects/'+id)?.originalFileName,'worker.js');
  const receipt=await fx.call('author','upload-status/projects/'+id);assert.equal((await receipt.json()).received,true);
  // A duplicate finalization is safely idempotent, not a second project.
  const duplicate=await fx.call('author','projects','POST',projectForm(id));assert.equal(duplicate.status,200);
 }finally{globalThis.fetch=old}
});

test('Android image filename may have different format from actual valid image bytes',async()=>{
 const fx=await fixture(),old=globalThis.fetch;globalThis.fetch=fx.fetchMock;
 try{
  const id=crypto.randomUUID();
  const actualJpeg=image; // valid JPEG signature, despite gallery assigning PNG filename.
  const uploaded=await stage(fx,'author','projects',id,'image',actualJpeg,'android-photo.png');
  assert.equal(uploaded.status,201,await uploaded.clone().text());
  const stored=fx.objects.get(`projects/${id}/cover`);
  assert.equal(stored?.opts.httpMetadata.contentType,'image/jpeg');
  assert.equal(stored?.opts.customMetadata.originalName,'android-photo.png');
  const fileUploaded=await stage(fx,'author','projects',id,'file',new TextEncoder().encode('console.log("Hello NEXBOTS")'),'bot.js');
  assert.equal(fileUploaded.status,201,await fileUploaded.clone().text());
  const form=projectForm(id);
  form.set('imageName','android-photo.png');form.set('fileName','bot.js');
  const published=await fx.call('author','projects','POST',form);
  assert.equal(published.status,201,await published.clone().text());
  assert.equal(fx.docs.get('projects/'+id)?.originalFileName,'bot.js');
 }finally{globalThis.fetch=old}
});

test('Image renamed to JPG but containing non-image content is rejected',async()=>{
 const fx=await fixture(),old=globalThis.fetch;globalThis.fetch=fx.fetchMock;
 try{
  const response=await stage(fx,'author','projects',crypto.randomUUID(),'image',new TextEncoder().encode('javascript disguised as image!'),'cover.jpg');
  assert.equal(response.status,400);
  assert.match((await response.json()).error,/JPG|PNG|WebP/);
 }finally{globalThis.fetch=old}
});

test('MP4 story is accepted by server based on real container duration, not mobile browser metadata',async()=>{
 const fx=await fixture(),old=globalThis.fetch;globalThis.fetch=fx.fetchMock;
 try{
  const id=crypto.randomUUID(),bytes=mp4(14000);assert.equal(mp4DurationSeconds(bytes),14);
  const uploaded=await stage(fx,'author','stories',id,'media',bytes,'clip.mp4','video');assert.equal(uploaded.status,201,await uploaded.text());
  const form=new FormData();for(const [k,v] of Object.entries({submissionId:id,type:'video',text:'لقطة رائعة',stagedAssets:'1',mediaName:'clip.mp4'}))form.append(k,v);
  const published=await fx.call('author','stories','POST',form);assert.equal(published.status,201,await published.clone().text());
  assert.equal(fx.docs.get('stories/'+id)?.type,'video');
  assert.equal(fx.docs.get('stories/'+id)?.mediaKey,`stories/${id}/media`);
  const media=fx.objects.get(`stories/${id}/media`);assert.equal(media.opts.httpMetadata.contentType,'video/mp4');
 }finally{globalThis.fetch=old}
});

test('Overlong MP4 is rejected by authoritative server check and never published',async()=>{
 const fx=await fixture(),old=globalThis.fetch;globalThis.fetch=fx.fetchMock;
 try{
  const id=crypto.randomUUID(),bytes=mp4(16000);
  const uploaded=await stage(fx,'author','stories',id,'media',bytes,'clip.mp4','video');assert.equal(uploaded.status,201);
  const form=new FormData();for(const [k,v] of Object.entries({submissionId:id,type:'video',text:'نص',stagedAssets:'1'}))form.append(k,v);
  const published=await fx.call('author','stories','POST',form);
  assert.equal(published.status,400);assert.match((await published.json()).error,/15 ثانية/);assert.equal(fx.docs.has('stories/'+id),false);assert.equal(fx.objects.has(`stories/${id}/media`),false);
 }finally{globalThis.fetch=old}
});

test('Staged media is authenticated, finite size and cannot be overwritten after project is published',async()=>{
 const fx=await fixture(),old=globalThis.fetch;globalThis.fetch=fx.fetchMock;
 try{
  const id=crypto.randomUUID();
  const tooLarge=await fx.call('author',`stage/projects/${id}/file`,'PUT',new Blob(['a']),{'x-file-size':'4000000','x-file-name':encodeURIComponent('a.zip')});assert.equal(tooLarge.status,413);
  const good=await stage(fx,'author','projects',id,'file',new Uint8Array([65,66]),'worker.js');assert.equal(good.status,201);
  const free=await stage(fx,'guest','projects',crypto.randomUUID(),'file',new Uint8Array([65]),'worker.js');assert.equal(free.status,403);
  fx.docs.set('projects/'+id,{authorId:'author',status:'pending'});
  const again=await stage(fx,'author','projects',id,'file',new Uint8Array([65,66,67]),'worker.js');assert.equal(again.status,200);assert.equal((await again.json()).alreadyReceived,true);
 }finally{globalThis.fetch=old}
});

test('UI delegates video validation to server and uploads media before Firestore metadata',()=>{
 const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
 const community=readFileSync(new URL('../src/Community.jsx',import.meta.url),'utf8');
 const lib=readFileSync(new URL('../src/lib.js',import.meta.url),'utf8');
 assert.doesNotMatch(community,/await verifyVideo\(/);
 assert.match(community,/stageAsset\('stories'/);
 assert.match(app,/submitProjectWithFallback/);
 const helper=readFileSync(new URL('../src/project-upload.js',import.meta.url),'utf8');
 assert.match(helper,/stageAsset\('projects'/);
 assert.match(lib,/body instanceof Blob/);
});


test('R2 staging rejects byte count mismatches before writing storage objects',async()=>{
 const fx=await fixture(),old=globalThis.fetch;globalThis.fetch=fx.fetchMock;
 try{
  const key=crypto.randomUUID();
  const response=await fx.call('author',`stage/projects/${key}/file`,'PUT',new Blob([new Uint8Array([1,2,3])]),{
   'x-file-name':encodeURIComponent('worker.js'),'x-file-size':'2','content-type':'application/octet-stream'});
  assert.equal(response.status,413);
  assert.equal(fx.objects.size,0);
 }finally{globalThis.fetch=old}
});


test('Live binary R2 diagnostic is owner-only and removes its temporary object',async()=>{
 const fx=await fixture(),old=globalThis.fetch;globalThis.fetch=fx.fetchMock;
 try{
  const sample=new Blob([new Uint8Array(32768)]);
  const denied=await fx.call('author','admin/r2-check','POST',sample,{'x-file-size':'32768'});
  assert.equal(denied.status,403,'regular subscribers cannot run storage diagnostics');
  const good=await fx.call('owner','admin/r2-check','POST',sample,{'x-file-size':'32768'});
  assert.equal(good.status,200,await good.clone().text());
  const body=await good.json();
  assert.equal(body.ok,true);
  assert.deepEqual(body.stages,['browser-to-pages','r2-put','r2-head']);
  assert.equal(fx.objects.size,0,'diagnostic object must be deleted');
 }finally{globalThis.fetch=old}
});

test('Real R2 write error is returned with an actual diagnostic stage and no mock success',async()=>{
 const fx=await fixture(),old=globalThis.fetch;globalThis.fetch=fx.fetchMock;
 try{
  fx.env.FILES.put=async()=>{throw new TypeError('R2 write rejected')};
  const probe=await fx.call('owner','admin/r2-check','POST',new Blob([new Uint8Array([1,2,3])]),{'x-file-size':'3'});
  assert.equal(probe.status,503);
  const result=await probe.json();
  assert.equal(result.ok,false);
  assert.equal(result.step,'put');
 }finally{globalThis.fetch=old}
});

test('Client reports HTML Cloudflare exceptions and Ray IDs instead of claiming a network disconnect',()=>{
 const lib=readFileSync(new URL('../src/lib.js',import.meta.url),'utf8');
 assert.match(lib,/api\(endpoint,\{method:'POST'/);
 assert.match(lib,/Cloudflare 1101\/1102\/403/);
 assert.match(lib,/cf-ray/);
 assert.match(lib,/INVALID_RESPONSE/);
 const admin=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
 assert.match(admin,/admin\/r2-check/);
});


test('A successful R2.put is not converted to an upload failure by a later HEAD outage',async()=>{
 const fx=await fixture(),old=globalThis.fetch;globalThis.fetch=fx.fetchMock;
 try{
  fx.env.FILES.head=async()=>{throw Error('R2 secondary read outage')};
  const doc=crypto.randomUUID();
  const result=await stage(fx,'author','projects',doc,'file',new Uint8Array([1,2,3,4]),'worker.js');
  assert.equal(result.status,201,await result.clone().text());
  assert.equal(fx.objects.get(`projects/${doc}/file`)?.data.byteLength,4);
 }finally{globalThis.fetch=old}
});

test('Image signatures are checked before writing anything to R2',async()=>{
 const fx=await fixture(),old=globalThis.fetch;globalThis.fetch=fx.fetchMock;
 try{
  const doc=crypto.randomUUID();
  const result=await stage(fx,'author','projects',doc,'image',new Uint8Array(64),'cover.jpg');
  assert.equal(result.status,400);
  assert.equal(fx.objects.size,0);
 }finally{globalThis.fetch=old}
});

test('Direct multipart fallback uses R2 and Firestore on server with single idempotent project ID',async()=>{
 const fx=await fixture(),old=globalThis.fetch;globalThis.fetch=fx.fetchMock;
 try{
  const submissionId=crypto.randomUUID();
  const form=new FormData();
  for(const [k,v] of Object.entries({submissionId,title:'بوت حديث لإدارة واتساب',description:'مشروع بوت كامل مع خطوات الإدارة والتشغيل وميزات متعددة للمجتمع',category:'whatsapp',language:'JavaScript',tags:'واتساب',forSale:'false'}))form.append(k,v);
  form.append('image',new File([image],'cover.jpg',{type:'image/jpeg'}));
  form.append('file',new File(['console.log("NEXBOTS")'],'api.js',{type:'application/javascript'}));
  const result=await fx.call('author','projects','POST',form);
  assert.equal(result.status,201,await result.clone().text());
  assert.equal((await result.json()).id,submissionId);
  assert.equal(fx.objects.get(`projects/${submissionId}/cover`)?.opts.httpMetadata.contentType,'image/jpeg');
  assert.equal(fx.objects.get(`projects/${submissionId}/file`)?.data.length,22);
  assert.equal(fx.docs.get(`projects/${submissionId}`).status,'pending');
  assert.equal(fx.docs.get(`projects/${submissionId}`).originalFileName,'api.js');
  const again=await fx.call('author','projects','POST',form);
  assert.equal(again.status,200);
  assert.equal((await again.json()).alreadyReceived,true);
 }finally{globalThis.fetch=old}
});
