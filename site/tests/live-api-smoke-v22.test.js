import test from 'node:test';
import assert from 'node:assert/strict';
import {onApiRequest} from '../server/api.js';
import {fields,dec} from '../server/codec.js';

const b64=bytes=>Buffer.from(bytes).toString('base64url');
const now=Math.floor(Date.now()/1000);
async function fixture(){
 const kp=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',kp.publicKey);
 const token=async(uid)=>{
  const h=b64(JSON.stringify({alg:'RS256',kid:'testkid',typ:'JWT'}));
  const p=b64(JSON.stringify({aud:'exbots',iss:'https://securetoken.google.com/exbots',sub:uid,iat:now,exp:now+3600,auth_time:now,email:uid+'@example.test',email_verified:true,name:uid}));
  const sig=await crypto.subtle.sign({name:'RSASSA-PKCS1-v1_5'},kp.privateKey,new TextEncoder().encode(h+'.'+p));
  return h+'.'+p+'.'+b64(sig);
 };
 const store=new Map([['users/author',{uid:'author',displayName:'المطور',role:'user',plan:'plus',planEndsAt:'2100-01-01T00:00:00Z',verified:false}],['users/other',{uid:'other',displayName:'صديق',role:'user',plan:'free',verified:false}]]);
 const objects=new Map();
 const env={FIREBASE_PROJECT_ID:'exbots',FIREBASE_WEB_API_KEY:'public-web-key',OWNER_EMAIL:'owner@example.test',FILES:{put:async(key,bytes,meta)=>{objects.set(key,{bytes:new Uint8Array(bytes),meta})},get:async key=>null,delete:async key=>{objects.delete(key)}}};
 const fetchMock=async(input,options={})=>{
  const url=new URL(String(input));
  if(url.hostname==='www.googleapis.com')return Response.json({keys:[{...jwk,kid:'testkid',alg:'RS256',use:'sig'}]});
  assert.equal(url.hostname,'firestore.googleapis.com');
  const nameFromPath=url.pathname.match(/\/documents\/([^/]+)(?:\/([^/:?]+))?$/);
  const col=nameFromPath?.[1],id=nameFromPath?.[2],key=col&&id?`${col}/${decodeURIComponent(id)}`:'';
  const encoded=(k,v)=>({name:'projects/exbots/databases/(default)/documents/'+k,fields:fields(v),updateTime:'2026-11-03T12:00:00Z'});
  const method=options.method||'GET';
  if(method==='GET')return store.has(key)?Response.json(encoded(key,store.get(key))):Response.json({error:{message:'not found'}},{status:404});
  if(url.pathname.endsWith(':runQuery')){
   const query=JSON.parse(options.body).structuredQuery;
   const where=query.where?.fieldFilter;
   const data=[...store.entries()].filter(([k,v])=>k.startsWith(query.from[0].collectionId+'/')).filter(([k,v])=>{
    if(!where)return true;
    const needle=where.value.stringValue||where.value.integerValue;
    return where.op==='ARRAY_CONTAINS'?v[where.field.fieldPath]?.includes(needle):v[where.field.fieldPath]===needle;
   });return Response.json(data.map(([k,v])=>({document:encoded(k,v)})));
  }
  if(url.pathname.endsWith(':commit')){
   const {writes}=JSON.parse(options.body);
   for(const w of writes){
    if(w.update){const k=w.update.name.split('/documents/')[1];store.set(k,Object.fromEntries(Object.entries(w.update.fields||{}).map(([key,val])=>[key,dec(val)])))}
    else if(w.delete)store.delete(w.delete.split('/documents/')[1]);
   }return Response.json({commitTime:'2026-11-03T12:00:00Z'});
  }
  if(method==='PATCH'){
   const v=Object.fromEntries(Object.entries(JSON.parse(options.body).fields).map(([k,v])=>[k,dec(v)]));store.set(key,{...store.get(key),...v});return Response.json(encoded(key,store.get(key)));
  }
  if(method==='DELETE'){store.delete(key);return Response.json({});}
  return Response.json({error:{message:'unexpected mocked Firestore request'}},{status:500});
 };
 return {env,token,store,objects,fetchMock};
}
const postContext=(env,t,path,form)=>({env,request:new Request('https://nexbots.pages.dev/api/'+path,{method:'POST',headers:{Authorization:'Bearer '+t},body:form})});
const getContext=(env,t,path)=>({env,request:new Request('https://nexbots.pages.dev/api/'+path,{headers:{Authorization:'Bearer '+t}})});

test('Signed Firebase user uploads a real JPEG & script into R2 and is able to confirm a lost response by same submission ID',async()=>{
 const fx=await fixture();const previous=globalThis.fetch;globalThis.fetch=fx.fetchMock;
 try{
  const t=await fx.token('author'),id=crypto.randomUUID(),form=new FormData();
  form.append('submissionId',id);form.append('title','بوت حديث');form.append('description','هذا مشروع بوت شامل مع تعليمات مفصلة للإدارة وبدون مفاتيح خاصة');
  form.append('category','whatsapp');form.append('language','JavaScript');form.append('tags','whatsapp');form.append('usage','شغّل المشروع');
  const image=new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,0,0]);
  form.append('image',new File([image],'sample.jpg',{type:'image/jpeg'}));
  form.append('file',new File(['console.log("NEXBOTS");'],'bot.js',{type:'text/javascript'}));
  const res=await onApiRequest(postContext(fx.env,t,'projects',form));
  assert.equal(res.status,201,await res.clone().text());
  assert.equal((await res.json()).id,id);
  assert.equal(fx.objects.size,2);
  assert.equal(fx.store.get('projects/'+id)?.authorId,'author');
  const status=await onApiRequest(getContext(fx.env,t,'upload-status/projects/'+id));
  assert.equal(status.status,200);assert.equal((await status.json()).received,true);
  const foreign=await onApiRequest(getContext(fx.env,await fx.token('other'),'upload-status/projects/'+id));
  assert.equal(foreign.status,403);
 }finally{globalThis.fetch=previous}
});
