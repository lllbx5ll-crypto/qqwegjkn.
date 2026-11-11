import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {onApiRequest} from '../server/api.js';
import{fields}from'../server/codec.js';

const b64=buf=>Buffer.from(buf).toString('base64url');
const docs=new Map(),files=new Map();
let revision=0;
const fkey=(col,id)=>`${col}/${id}`;
const toWire=(name,data)=>({name:`projects/exbots/databases/(default)/documents/${name}`,fields:fields(data.value),updateTime:data.updateTime});
const mockR2={put:async(k,body,options)=>{files.set(k,{body,options});},get:async k=>files.has(k)?{body:files.get(k).body,httpMetadata:files.get(k).options?.httpMetadata}:null,delete:async k=>files.delete(k)};
const env={FIREBASE_PROJECT_ID:'exbots',OWNER_EMAIL:'lllbx5ll@gmail.com',FIREBASE_WEB_API_KEY:'public-test-api-key',FILES:mockR2};
let privateKey;
async function signed(uid,email){const t=Math.floor(Date.now()/1000),head={alg:'RS256',typ:'JWT',kid:'test-key'},payload={aud:'exbots',iss:'https://securetoken.google.com/exbots',sub:uid,email,email_verified:true,name:uid,iat:t-5,exp:t+3600,auth_time:t-40};const header=b64(JSON.stringify(head)),body=b64(JSON.stringify(payload));const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,new TextEncoder().encode(`${header}.${body}`));return `${header}.${body}.${b64(sig)}`;}
async function call(path,token,method='GET',body=null){const options={method,headers:token?{Authorization:`Bearer ${token}`}:{}};if(body!==null){if(body instanceof FormData)options.body=body;else{options.body=JSON.stringify(body);options.headers['Content-Type']='application/json';}}const response=await onApiRequest({request:new Request(`https://nexbots.pages.dev/api/${path}`,options),env});const text=await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}return{status:response.status,data};}
function mockFirestore(url,options){const path=new URL(url).pathname;const start='/documents/';const rel=path.includes(start)?decodeURIComponent(path.slice(path.indexOf(start)+start.length)):'';
 if(path.endsWith('documents:runQuery')){
   const query=JSON.parse(options.body).structuredQuery;
   const col=query.from[0].collectionId;
   const field=query.where.fieldFilter.field.fieldPath;
   const wireValue=query.where.fieldFilter.value;
   const wanted=fromWire({v:wireValue}).v;
   const docsFound=[...docs].filter(([name,doc])=>name.startsWith(col+'/')&&name.split('/').length===2&&doc.value[field]===wanted).slice(0,query.limit);
   return Response.json(docsFound.map(([name,doc])=>({document:toWire(name,doc)})));
 }
 // The actual Firestore service (not this stub) evaluates Security Rules.
 if(options.method && options.method!=='GET' && !options.headers?.Authorization){
   return Response.json({error:{message:'Missing Firebase user token'}},{status:401});
 }
 if(path.endsWith('documents:commit')){
   const body=JSON.parse(options.body);
   // Atomic mock: precondition validation occurs before any writes.
   for(const write of body.writes){if(!write.update?.name)continue;const key=write.update.name.split('/documents/')[1],found=docs.get(key),pre=write.currentDocument;
     if(pre?.exists===false&&found)return new Response(JSON.stringify({error:{message:'ALREADY_EXISTS'}}),{status:409});
     if(pre?.updateTime&&(!found||found.updateTime!==pre.updateTime))return new Response(JSON.stringify({error:{message:'FAILED_PRECONDITION'}}),{status:412});
   }
   for(const write of body.writes){if(write.update){const key=write.update.name.split('/documents/')[1];docs.set(key,{value:fromWire(write.update.fields),updateTime:new Date(Date.now()+ ++revision).toISOString()});}
     if(write.delete){docs.delete(write.delete.split('/documents/')[1]);}
     if(write.transform){const key=write.transform.document.split('/documents/')[1],found=docs.get(key);if(found){for(const tr of write.transform.fieldTransforms)found.value[tr.fieldPath]=(found.value[tr.fieldPath]||0)+Number(tr.increment.integerValue);}}}
   return Response.json({writeResults:[]});
 }
 if(!rel)return new Response('{}',{status:404});
 const key=rel,stored=docs.get(key);
 if(options.method==='PATCH'){
   const body=JSON.parse(options.body);const next={value:fromWire(body.fields),updateTime:new Date(Date.now()+ ++revision).toISOString()};docs.set(key,next);return Response.json(toWire(key,next));
 }
 if(options.method==='DELETE'){docs.delete(key);return new Response('',{status:200});}
 if(stored)return Response.json(toWire(key,stored));
 const col=key.split('/')[0];if(key===col){
   let documents=[...docs].filter(([k])=>k.startsWith(col+'/')&&k.split('/').length===2).map(([k,v])=>toWire(k,v));
   documents=documents.slice(0,Number(new URL(url).searchParams.get('pageSize'))||100);
   return Response.json({documents});
 }
 return Response.json({error:{message:'NOT_FOUND'}},{status:404});
}
function fromWire(fields){const decode=val=>{if('stringValue'in val)return val.stringValue;if('integerValue'in val)return Number(val.integerValue);if('doubleValue'in val)return Number(val.doubleValue);if('booleanValue'in val)return val.booleanValue;if('nullValue'in val)return null;if('arrayValue'in val)return(val.arrayValue.values||[]).map(decode);if('mapValue'in val)return fromWire(val.mapValue.fields);return null;};return Object.fromEntries(Object.entries(fields||{}).map(([k,v])=>[k,decode(v)]));}

await test('Integration: owner, subscriber upload, moderation and protected downloads',async()=>{
 const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);privateKey=pair.privateKey;
 const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);jwk.kid='test-key';
 
 globalThis.fetch=async(url,options={})=>{
   if(String(url).includes('/jwk/securetoken'))return Response.json({keys:[jwk]});
   if(String(url).includes('firestore.googleapis.com'))return mockFirestore(url,options);
   throw new Error('unexpected URL '+url);
 };
 const owner=await signed('uid-owner',env.OWNER_EMAIL),alice=await signed('uid-alice','alice@gmail.com');
 assert.equal((await call('public')).status,200);
 assert.equal((await call('health')).data.authMode,'firebase-id-token-rules');
 assert.equal((await call('admin/users',alice)).status,403);
 const a=await call('me',alice);assert.equal(a.status,200);assert.equal(a.data.user.role,'user');
 const o=await call('me',owner);assert.equal(o.status,200);assert.equal(o.data.user.role,'owner');
 // Actual old bug: getDoc() injects `id`, and old setDoc() persisted it on
 // avatar/profile updates. Firestore rules reject any unexpected user fields.
 const profilePhoto=new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbnAAAAABJRU5ErkJggg==','base64')],'avatar.png',{type:'image/png'});
 const photoForm=new FormData();photoForm.append('kind','avatar');photoForm.append('file',profilePhoto);
 const photoResult=await call('profile-upload',owner,'POST',photoForm);
 assert.equal(photoResult.status,200,`Owner avatar upload: ${JSON.stringify(photoResult.data)}`);
 assert.equal(docs.get('users/uid-owner').value.id,undefined,'Persisted Firestore doc should not include derived id');
 assert.match(docs.get('users/uid-owner').value.avatar,/^profiles\/uid-owner\/avatar-/);
 const renamed=await call('me',owner,'PATCH',{displayName:'NEXBOTS OWNER'});
 assert.equal(renamed.status,200,`Owner profile edit: ${JSON.stringify(renamed.data)}`);
 assert.equal(docs.get('users/uid-owner').value.id,undefined);

 assert.equal(docs.get('config/owner').value.uid,'uid-owner');
 const deniedUpload=new FormData();deniedUpload.append('title','WhatsApp Test Bot');deniedUpload.append('description','This project is a functional useful bot for WhatsApp communities.');deniedUpload.append('category','whatsapp');deniedUpload.append('externalUrl','https://example.com/bot.zip');
 assert.equal((await call('projects',alice,'POST',deniedUpload)).status,403);
 const ends=new Date(Date.now()+30*86400000).toISOString();
 const grant=await call('admin/users/uid-alice',owner,'PATCH',{plan:'plus',planEndsAt:ends});assert.equal(grant.status,200);
 const png=new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbnAAAAABJRU5ErkJggg==','base64')],'cover.png',{type:'image/png'});
 deniedUpload.append('image',png);deniedUpload.append('file',new File([new Uint8Array([80,75,3,4])],'bot.zip',{type:'application/zip'}));
 const created=await call('projects',alice,'POST',deniedUpload);assert.equal(created.status,201);const pid=created.data.id;
 assert.equal((await call('projects')).data.length,0);assert.equal(files.has(`projects/${pid}/cover`),true);assert.equal(files.has(`projects/${pid}/file`),true);
 assert.equal((await call(`projects/${pid}`)).status,401);
 const approved=await call('admin/projects/'+pid,owner,'PATCH',{status:'approved'});assert.equal(approved.status,200);
 const publicProjects=(await call('projects')).data;assert.equal(publicProjects.length,1);assert.equal(publicProjects[0].imageKey,`projects/${pid}/cover`);
 const detail=(await call('projects/'+pid)).data;
 assert.equal(detail.authorProfile.uid,'uid-alice');
 assert.equal(detail.authorProfile.displayName,docs.get('users/uid-alice').value.displayName);
 assert.equal(detail.authorProfile.role,'user');
 assert.equal(JSON.stringify(detail.authorProfile).includes('alice@gmail.com'),false,'public author data must not leak email');
 assert.equal((await call(`download/${pid}`)).status,401);
 const downloaded=await call(`download/${pid}`,alice);assert.equal(downloaded.status,200);assert.equal(downloaded.data,'PK\x03\x04');
 const profile=await call('profiles/uid-alice');assert.equal(profile.status,200);assert.equal(JSON.stringify(profile.data).includes('alice@gmail.com'),false);
 // Social profile links are stable Firebase UID links with real server-side counters.
 const beforeSocial=await call('profiles/uid-alice',owner);
 assert.equal(beforeSocial.status,200);
 assert.equal(beforeSocial.data.stats.followers,0);
 assert.equal(beforeSocial.data.stats.likes,0);
 const following=await call('profiles/uid-alice/follow',owner,'POST');
 assert.equal(following.status,200,JSON.stringify(following.data));
 assert.deepEqual(following.data,{active:true,count:1});
 assert.equal(docs.get('users/uid-alice').value.followersCount,1);
 assert.equal(docs.get('profileFollows/uid-owner_uid-alice').value.actorUid,'uid-owner');
 assert.equal((await call('profiles/uid-alice/follow',owner,'POST')).data.count,1,'duplicate follow is idempotent');
 assert.equal((await call('profiles/uid-alice',owner)).data.viewer.following,true);
 assert.equal((await call('profiles/uid-alice',owner)).data.stats.followers,1);
 assert.equal((await call('profiles/uid-alice/like',owner,'POST')).data.count,1);
 assert.equal((await call('profiles/uid-alice',owner)).data.viewer.liked,true);
 assert.equal((await call('profiles/uid-alice/like',owner,'DELETE')).data.count,0);
 assert.equal((await call('profiles/uid-alice/follow',owner,'DELETE')).data.count,0);
 assert.equal(docs.get('users/uid-alice').value.followersCount,0);
 assert.equal((await call('profiles/uid-owner/follow',owner,'POST')).status,400,'No self-follow');
 assert.equal((await call('profiles/uid-alice/follow',null,'POST')).status,401,'Login required');
 assert.equal((await call('admin/users',owner)).data.find(x=>x.uid==='uid-alice').email,'alice@gmail.com');
 assert.equal((await call('admin/users',alice)).status,403);
 assert.equal((await call('admin/users/uid-owner',alice,'PATCH',{role:'owner'})).status,403);
 const message=await call('messages',alice,'POST',{text:'مرحبا بالجميع'});assert.equal(message.status,201);
 const count=docs.get(`quotas/uid-alice_${Math.floor(Date.now()/86400000)}`).value.count;assert.equal(count,1);
 // Creating the first DM must not GET an absent hashed thread document; that
 // would fail the resource-dependent Firestore read rule in production.
 const newDM=await call('private/threads',owner,'POST',{targetUid:'uid-alice'});
 assert.equal(newDM.status,200,`First private thread creation: ${JSON.stringify(newDM.data)}`);
 assert.ok(newDM.data.id);
 const repeatedDM=await call('private/threads',owner,'POST',{targetUid:'uid-alice'});
 assert.equal(repeatedDM.status,200,'Existing DM should be reused, not duplicated');
 assert.equal(repeatedDM.data.id,newDM.data.id);
 // A real JPEG/PNG from a mobile picker may be sent with generic MIME.
 const storyId=crypto.randomUUID(),storyForm=new FormData();
 storyForm.append('submissionId',storyId);storyForm.append('type','image');storyForm.append('text','اختبار');
 storyForm.append('file',new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbnAAAAABJRU5ErkJggg==','base64')],'photo.png',{type:'application/octet-stream'}));
 const storyCreated=await call('stories',owner,'POST',storyForm);
 assert.equal(storyCreated.status,201,`Story upload accepts actual PNG bytes: ${JSON.stringify(storyCreated.data)}`);
 assert.equal(files.get(`stories/${storyId}/media`)?.options?.httpMetadata?.contentType,'image/png');
 const storyRetry=await call('stories',owner,'POST',storyForm);
 assert.equal(storyRetry.status,200,'Repeated story upload returns existing record');
 assert.equal(storyRetry.data.alreadyReceived,true);
 const projectSubmissionId=crypto.randomUUID(),newProjectForm=new FormData();
 for(const [k,v] of [['submissionId',projectSubmissionId],['title','Bot from retry safe upload'],['description','A safe project that is uploaded once even if the response was lost.'],['category','whatsapp'],['externalUrl','https://example.com/retry.zip']])newProjectForm.append(k,v);
 const firstTry=await call('projects',alice,'POST',newProjectForm);
 assert.equal(firstTry.status,201,`First project submission: ${JSON.stringify(firstTry.data)}`);
 const secondTry=await call('projects',alice,'POST',newProjectForm);
 assert.equal(secondTry.status,200,`Retry returns existing project: ${JSON.stringify(secondTry.data)}`);
 assert.equal(secondTry.data.id,projectSubmissionId);
 assert.equal(secondTry.data.alreadyReceived,true);
});
