import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handlePayments,defaultPaymentConfig} from '../server/payments.js';
import {fields} from '../server/codec.js';

const env={FIREBASE_PROJECT_ID:'exbots',FIREBASE_WEB_API_KEY:'public'};
test('configured currency accounts are exact and prices start disabled until owner sets them',async()=>{
 assert.deepEqual(defaultPaymentConfig.accounts,{YER:'3156806675',SAR:'3107309798',USD:'3157185224'});
 for(const p of ['plus','premium','pro'])for(const c of ['YER','SAR','USD'])assert.equal(defaultPaymentConfig.prices[p][c],null);
 const old=globalThis.fetch;
 globalThis.fetch=async()=>new Response('',{status:404});
 try{const res=await handlePayments(new Request('https://x/api/payments/config'),env,['payments','config'],'GET',{});assert.equal(res.status,200);const config=await res.json();assert.deepEqual(config.accounts,defaultPaymentConfig.accounts);assert.equal('ownerName' in config,false);}
 finally{globalThis.fetch=old;}
});
test('a normal user cannot list or approve bank transfers from the owner API',async()=>{
 const res=await handlePayments(new Request('https://x/api/admin/payments'),env,['admin','payments'],'GET',{identityUser:async()=>({user:{uid:'u1',role:'user'}})});
 assert.equal(res.status,403);
});
test('manual payment and story badge routes are registered and Firestore rules restrict approval to owner',()=>{
 const api=readFileSync(new URL('../server/api.js',import.meta.url),'utf8');
 const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../src/Payments.jsx',import.meta.url),'utf8');
 const community=readFileSync(new URL('../src/Community.jsx',import.meta.url),'utf8');
 assert.match(api,/handlePayments\(request,env,path,method/);
 assert.match(api,/handleStoryChunks\(request,env,path,method/);
 assert.match(rules,/match \/paymentRequests\/\{requestId\}/);
 assert.match(rules,/allow update: if owner\(\)/);
 assert.match(ui,/الدفع عبر الكريمي/);
 assert.match(ui,/تم إرسال طلب الاشتراك بنجاح/);
 assert.match(community,/VerifiedBadge user=\{t.other\}/);
 assert.match(community,/stageStoryVideo\(submissionId.current,file,setProgress\)/);
});

test('receipt stays pending until owner confirms a real stored image; approval changes plan only once',async()=>{
 const {dec}=await import('../server/codec.js');
 const oldFetch=globalThis.fetch;
 const fsDocs=new Map(),r2=new Map();
 const putDoc=(col,id,obj)=>fsDocs.set(col+'/'+id,obj);
 const fromWire=wire=>Object.fromEntries(Object.entries(wire||{}).map(([k,v])=>[k,dec(v)]));
 const toWire=(col,id,obj)=>({name:`projects/exbots/databases/(default)/documents/${col}/${id}`,fields:fields(obj),updateTime:'2026-11-06T00:00:00.123456Z'});
 const dataResponse=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
 globalThis.fetch=async (url,options={})=>{
  const href=new URL(url),endpoint=href.pathname.split('/documents')[1]||'';
  if(endpoint===':runQuery'){
   const query=JSON.parse(options.body).structuredQuery, col=query.from[0].collectionId;
   const field=query.where.fieldFilter.field.fieldPath,value=dec(query.where.fieldFilter.value);
   return dataResponse([...fsDocs].filter(([key,doc])=>key.startsWith(col+'/')&&doc[field]===value).map(([key,doc])=>({document:toWire(col,key.split('/')[1],doc)})));
  }
  if(endpoint===':commit'){
   const writes=JSON.parse(options.body).writes;
   for(const write of writes){const key=write.update.name.split('/documents/')[1];fsDocs.set(key,fromWire(write.update.fields));}
   return dataResponse({writeResults:writes.map(()=>({}))});
  }
  if(options.method==='PATCH'){
   const key=endpoint.replace(/^\//,'');fsDocs.set(key,fromWire(JSON.parse(options.body).fields));return dataResponse(toWire(...key.split('/'),fsDocs.get(key)));
  }
  const key=endpoint.replace(/^\//,'');if(!fsDocs.has(key))return dataResponse({},404);
  const [col,id]=key.split('/');return dataResponse(toWire(col,id,fsDocs.get(key)));
 };
 const bucket={
  async put(key,bytes,options={}){const b=new Uint8Array(bytes);r2.set(key,{bytes:b,size:b.length,customMetadata:options.customMetadata||{}});return {size:b.length};},
  async head(key){const o=r2.get(key);return o?{size:o.size,customMetadata:o.customMetadata}:null;},
  async get(key){const o=r2.get(key);return o?{...o,body:new Blob([o.bytes]).stream()}:null;},
  async delete(key){r2.delete(key);}
 };
 const e={...env,FILES:bucket};
 const member={uid:'alice',displayName:'أمل',role:'user'},owner={uid:'owner',role:'owner',displayName:'المالك'};
 const caller=u=>({identityUser:async()=>({user:u})});
 try{
  putDoc('config','payment',{...defaultPaymentConfig,prices:{...defaultPaymentConfig.prices,pro:{YER:2500,SAR:17,USD:5}}});
  putDoc('users','alice',{...member,plan:'free',planEndsAt:null,planStartsAt:null,verified:false,permissions:[],createdAt:'2026-11-06T00:00:00Z'});
  const bytes=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0,1,2,3,4]);
  const form=new FormData();form.set('plan','pro');form.set('currency','USD');form.set('amount','5');form.set('account','3157185224');form.set('receipt',new File([bytes],'receipt.png',{type:'image/png'}));
  const sent=await handlePayments(new Request('https://test/api/payments/request',{method:'POST',body:form}),e,['payments','request'],'POST',caller(member));
  assert.equal(sent.status,201,await sent.clone().text());
  const requestData=await sent.json();
  assert.equal(fsDocs.get('users/alice').plan,'free');
  assert.equal(fsDocs.get('paymentRequests/'+requestData.id).status,'pending');
  const receiptAccess=await handlePayments(new Request('https://test/api/payment-receipts/'+requestData.id),e,['payment-receipts',requestData.id],'GET',caller({uid:'someone-else',role:'user'}));
  assert.equal(receiptAccess.status,403);
  const confirm=await handlePayments(new Request('https://test/api/admin/payments/'+requestData.id,{method:'PATCH',body:JSON.stringify({action:'approve'})}),e,['admin','payments',requestData.id],'PATCH',caller(owner));
  assert.equal(confirm.status,200,await confirm.clone().text());
  const user=fsDocs.get('users/alice');
  assert.equal(user.plan,'pro');assert.ok(Date.parse(user.planEndsAt)>Date.now()+29*86400000);
  assert.equal(fsDocs.get('paymentRequests/'+requestData.id).status,'approved');
  const repeated=await handlePayments(new Request('https://test/api/admin/payments/'+requestData.id,{method:'PATCH',body:JSON.stringify({action:'approve'})}),e,['admin','payments',requestData.id],'PATCH',caller(owner));
  assert.equal(repeated.status,409);
  assert.equal(fsDocs.get('users/alice').planEndsAt,user.planEndsAt);
 }finally{globalThis.fetch=oldFetch;}
});
