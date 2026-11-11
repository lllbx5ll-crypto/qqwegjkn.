import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {enc,dec} from '../server/codec.js';
import {mp4DurationSeconds,handleFeatures} from '../server/features.js';
import {cleanupExpired} from '../cleanup/worker.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function box(name,payload){const b=new Uint8Array(8+payload.length),v=new DataView(b.buffer);v.setUint32(0,b.length);for(let i=0;i<4;i++)b[i+4]=name.charCodeAt(i);b.set(payload,8);return b;}
function mp4(seconds){const head=box('ftyp',new Uint8Array([105,115,111,109]));const mvhd=new Uint8Array(24);const view=new DataView(mvhd.buffer);view.setUint32(12,1000);view.setUint32(16,seconds*1000);const metadata=box('moov',box('mvhd',mvhd));const result=new Uint8Array(head.length+metadata.length);result.set(head);result.set(metadata,head.length);return result;}
test('real TTL field writes a Firestore Timestamp (not string)',()=>{
 const x=enc(new Date('2026-11-04T13:00:00.000Z'));
 assert.deepEqual(x,{timestampValue:'2026-11-04T13:00:00.000Z'});
 assert.equal(dec(x),'2026-11-04T13:00:00.000Z');
});
test('MP4 duration cannot bypass 15 second story cap',()=>{
 assert.equal(mp4DurationSeconds(mp4(15)),15);
 assert.equal(mp4DurationSeconds(mp4(16)),16);
 assert.equal(mp4DurationSeconds(new Uint8Array([0,1,2,3])),null);
});
test('Stories are subscription-gated even for text-only stories',async()=>{
 const env={FILES:{}};
 const request=new Request('https://nexbots.pages.dev/api/stories',{method:'POST'});
 const res=await handleFeatures(request,env,['stories'],'POST',{identityUser:async()=>({user:{uid:'u',role:'user',plan:'free',planEndsAt:null}})});
 assert.equal(res.status,403);
 assert.match((await res.json()).error,/للمشتركين/);
});
test('R2 cleanup deletes ONLY expired story-prefix media and expired metadata',async()=>{
 const expiredDate=new Date(Date.now()-3600000).toISOString(),calls=[],r2=[];
 const expireDoc={name:'projects/exbots/databases/(default)/documents/stories/a',fields:{mediaKey:{stringValue:'stories/a/media'},expiresAt:{timestampValue:expiredDate}}};
 const view={name:'projects/exbots/databases/(default)/documents/storyViews/ux_a',fields:{expiresAt:{timestampValue:expiredDate}}};
 const like={name:'projects/exbots/databases/(default)/documents/storyLikes/ux_a',fields:{expiresAt:{timestampValue:expiredDate}}};
 const original=globalThis.fetch;
 globalThis.fetch=async(input,opts)=>{
  const url=String(input);calls.push({url,method:opts?.method,body:opts?.body});
  if(url.endsWith(':runQuery?key=publickey')){
   const col=JSON.parse(opts.body).structuredQuery.from[0].collectionId;
   return new Response(JSON.stringify(({storyViews:[{document:view}],storyLikes:[{document:like}],stories:[{document:expireDoc}]}[col])||[]),{status:200});
  }
  return new Response('{}',{status:200});
 };
 try{
  const result=await cleanupExpired({FIREBASE_PROJECT_ID:'exbots',FIREBASE_WEB_API_KEY:'publickey',FILES:{delete:async key=>r2.push(key)}});
  assert.deepEqual(r2,['stories/a/media']);
  assert.equal(result.successes,3);
  assert.equal(result.failures,0);
  assert.ok(calls.filter(x=>x.method==='DELETE').every(x=>x.url.includes('/documents/stor')));
 }finally{globalThis.fetch=original;}
});
test('Usernames, privacy, blocks, reports and moderation are in Firestore security rules',()=>{
 const rules=read('firestore.rules');
 for(const col of ['usernames','userBlocks','dmThreads','dmMessages','reports','stories','storyViews','storyLikes','purchaseGrants','projectEdits'])assert.match(rules,new RegExp('match /'+col+'/'));
 assert.match(rules,/canDM\(/);
 assert.match(rules,/expiresAt <= request.time/);
 assert.match(rules,/request.resource.data.expiresAt is timestamp/);
 assert.match(rules,/permission\('manageUsers'\)/);
});
test('Every requested UI section is wired without visible release badge',()=>{
 const app=read('src/App.jsx'),community=read('src/Community.jsx');
 assert.match(app,/path==='\/private'/);
 assert.match(app,/AdminReportsView/);
 assert.match(app,/AdminProjectEditsView/);
 assert.match(app,/MyProjectManager/);
 assert.match(community,/function StoryViewer/);
 assert.match(community,/function DmConversation/);
 assert.match(community,/إلغاء الحظر/);
 assert.match(community,/تمت القراءة/);
 assert.doesNotMatch(app,/release-mini\">\{RELEASE\}/);
 assert.doesNotMatch(app,/footer-release\">\{RELEASE\}/);
 assert.doesNotMatch(app,/NEXBOTS SYSTEM <span className="version">/);
});
test('Story cleaner is scheduled every 15 minutes and bound to the same bucket',()=>{
 const wrangler=read('cleanup/wrangler.toml');
 assert.match(wrangler,/crons = \["\*\/15 \* \* \* \*"\]/);
 assert.match(wrangler,/bucket_name = "nexbots-files"/);
 assert.match(wrangler,/main = "worker.js"/);
});
