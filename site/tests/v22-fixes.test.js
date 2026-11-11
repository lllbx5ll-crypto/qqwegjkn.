import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handleFeatures} from '../server/features.js';
import {fields,dec} from '../server/codec.js';

const src=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const env={FIREBASE_PROJECT_ID:'exbots',FIRESTORE_ID_TOKEN:'test-verified-id-token'};
function responder(store){
 return async(input,options={})=>{
  const url=new URL(String(input));
  assert.equal(url.hostname,'firestore.googleapis.com');
  const collectionId=url.pathname.match(/\/documents\/([^/]+)(?:\/([^/:?]+))?/)?.[1];
  const documentId=url.pathname.match(/\/documents\/[^/]+\/([^/:?]+)/)?.[1];
  const method=options.method||'GET';
  const key=collectionId&&documentId?collectionId+'/'+decodeURIComponent(documentId):null;
  const encoded=(id,data)=>({name:'projects/exbots/databases/(default)/documents/'+id,fields:fields(data),updateTime:'2026-11-03T12:00:00Z'});
  if(method==='GET')return store.has(key)?Response.json(encoded(key,store.get(key))):Response.json({error:{message:'not found'}},{status:404});
  if(url.pathname.endsWith(':runQuery')){
   const body=JSON.parse(options.body),col=body.structuredQuery.from[0].collectionId,filter=body.structuredQuery.where?.fieldFilter;
   const values=[...store.entries()].filter(([k,v])=>k.startsWith(col+'/')).filter(([k,v])=>{
    if(!filter)return true;const needle=filter.value.stringValue||filter.value.integerValue;
    if(filter.op==='ARRAY_CONTAINS')return v[filter.field.fieldPath]?.includes(needle);
    return v[filter.field.fieldPath]===needle;
   });
   return Response.json(values.map(([k,v])=>({document:encoded(k,v)})));
  }
  if(url.pathname.endsWith(':commit')){
   const {writes}=JSON.parse(options.body);
   for(const w of writes){
    if(w.update){const k=w.update.name.match(/\/documents\/(.*)$/)?.[1];const val=Object.fromEntries(Object.entries(w.update.fields||{}).map(([k,v])=>[k,dec(v)]));store.set(k,val)}
    if(w.delete){store.delete(w.delete.match(/\/documents\/(.*)$/)?.[1])}
   }
   return Response.json({commitTime:'2026-11-03T12:00:00Z'});
  }
  if(method==='PATCH'){
   const val=Object.fromEntries(Object.entries(JSON.parse(options.body).fields||{}).map(([k,v])=>[k,dec(v)]));
   const old=store.get(key)||{};store.set(key,{...old,...val});return Response.json(encoded(key,store.get(key)));
  }
  if(method==='DELETE'){store.delete(key);return Response.json({});}
  return Response.json({error:{message:'unexpected mocked request'}},{status:500});
 };
}
function actor(uid){return {identityUser:async()=>({user:{uid,role:'user',plan:'free',displayName:uid,verified:false,permissions:[],bannedUntilMillis:null}}),plans:async()=>({free:{dailyMessages:50}})};}
test('A new private thread has a stable valid ID, independent chat endpoint, and a working send/receive lifecycle',async()=>{
 const store=new Map([['users/alpha',{uid:'alpha',displayName:'Alpha'}],['users/beta',{uid:'beta',displayName:'Beta'}]]);
 const original=globalThis.fetch;globalThis.fetch=responder(store);
 try{
  const create=await handleFeatures(new Request('https://nexbots.pages.dev/api/private/threads',{method:'POST',body:JSON.stringify({targetUid:'beta'})}),env,['private','threads'],'POST',actor('alpha'));
  assert.equal(create.status,200);
  const {id,other}=await create.json();assert.match(id,/^[0-9a-f]{40}$/);assert.equal(other.uid,'beta');
  const get=await handleFeatures(new Request('https://nexbots.pages.dev/api/private/threads/'+id),env,['private','threads',id],'GET',actor('beta'));
  assert.equal(get.status,200);assert.equal((await get.json()).other.uid,'alpha');
  const send=await handleFeatures(new Request('https://nexbots.pages.dev/api/private/threads/'+id+'/messages',{method:'POST',body:JSON.stringify({text:'hello'})}),env,['private','threads',id,'messages'],'POST',actor('alpha'));
  assert.equal(send.status,201);const body=await send.json();assert.equal(body.text,'hello');
  assert.deepEqual(store.get('dmThreads/'+id).unreadCounts,{alpha:0,beta:1},'recipient unread count increases only on delivery');
  const inbox=await handleFeatures(new Request('https://nexbots.pages.dev/api/private/threads'),env,['private','threads'],'GET',actor('beta'));
  assert.equal(inbox.status,200);
  assert.equal((await inbox.json())[0].unreadCounts.beta,1,'unread count appears in the thread list');
  const list=await handleFeatures(new Request('https://nexbots.pages.dev/api/private/threads/'+id+'/messages'),env,['private','threads',id,'messages'],'GET',actor('beta'));
  assert.equal(list.status,200);assert.equal((await list.json()).length,1);
  // Reading a message uses /read, not the (previously overly broad) create thread handler.
  const read=await handleFeatures(new Request('https://nexbots.pages.dev/api/private/threads/'+id+'/read',{method:'POST'}),env,['private','threads',id,'read'],'POST',actor('beta'));
  assert.equal(read.status,200);assert.equal((await read.json()).read,1);
  assert.deepEqual(store.get('dmThreads/'+id).unreadCounts,{alpha:0,beta:0},'unread badge is cleared after recipient reads');
  const reverse=await handleFeatures(new Request('https://nexbots.pages.dev/api/private/threads/'+id+'/messages',{method:'POST',body:JSON.stringify({text:'received'})}),env,['private','threads',id,'messages'],'POST',actor('beta'));
  assert.equal(reverse.status,201);
  assert.deepEqual(store.get('dmThreads/'+id).unreadCounts,{beta:0,alpha:1},'reverse-direction unread count belongs to the other participant');
  // Blocking stops new messages, without hiding an existing thread's history.
  const block=await handleFeatures(new Request('https://nexbots.pages.dev/api/blocks/beta',{method:'POST'}),env,['blocks','beta'],'POST',actor('alpha'));
  assert.equal(block.status,200);
  const prohibited=await handleFeatures(new Request('https://nexbots.pages.dev/api/private/threads/'+id+'/messages',{method:'POST',body:JSON.stringify({text:'blocked'})}),env,['private','threads',id,'messages'],'POST',actor('alpha')).catch(e=>e);
  assert.ok(prohibited instanceof Error && prohibited.status===403);
  const history=await handleFeatures(new Request('https://nexbots.pages.dev/api/private/threads/'+id+'/messages'),env,['private','threads',id,'messages'],'GET',actor('alpha'));
  assert.equal(history.status,200);
 }finally{globalThis.fetch=original}
});
test('private chat rejects bad identifiers before any document write',async()=>{
 const r=await handleFeatures(new Request('https://nexbots.pages.dev/api/private/threads',{method:'POST',body:JSON.stringify({targetUid:'@@@'})}),env,['private','threads'],'POST',actor('alpha'));
 assert.equal(r.status,400);
});
test('Separate conversation route, stories-first layout and genuine upload-receipt recovery are wired',()=>{
 const app=src('src/App.jsx'),community=src('src/Community.jsx'),server=src('server/api.js'),lib=src('src/lib.js');
 assert.match(app,/path\.startsWith\('\/private\/t\/'\)/);
 assert.match(community,/navigate\('\/private\/t\/'/);
 assert.match(community,/community-conversation-page/);
 const storyPos=community.indexOf('className="panel stories-section"'),searchPos=community.indexOf('className="panel community-directory community-directory-full community-search-section"'),listPos=community.indexOf('community-conversation-list');
 assert.ok(storyPos>=0&&searchPos>storyPos&&listPos>searchPos);
 assert.match(server,/route==='upload-status'/);
 assert.match(lib,/upload-status\/\$\{path\}/);
 assert.match(lib,/alreadyReceived:true,recovered:true/);
});
test('Firestore rules safely allow missing upload receipts as 404 without exposing unpublished projects',()=>{
 const rules=src('firestore.rules');
 assert.match(rules,/allow get: if \(resource == null && registered\(\)\)/);
 assert.match(rules,/resource\.data\.status == 'approved'/);
});
