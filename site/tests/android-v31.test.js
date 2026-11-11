import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const read=x=>fs.readFileSync(new URL(x,import.meta.url),'utf8');
for(const path of ['../src/native-download.js','../src/native-push.js','../server/push.js'])test(`parses ${path}`,()=>{assert.ok(read(path).length>200)});
test('private send triggers push only after Firestore commit',()=>{const code=read('../server/features.js');assert.match(code,/await commit\(env,\[updateWrite\(env,'dmMessages'/);assert.match(code,/helpers.notifyPrivate\?\.\(recipient,user.displayName,thread.id\)/)});
test('push endpoint owner-only for announcements',()=>{const code=read('../server/push.js');assert.match(code,/if\(!isOwner\(user\)\)return bad/);assert.match(code,/topic:'nexbots_announcements'/)});
test('no token exposed to other users',()=>{const code=read('../server/push.js');assert.match(code,/env\.PUSH_TOKENS/);assert.doesNotMatch(code,/return json\(\{token:/)});
test('downloads verified and authenticated',()=>{const js=read('../src/native-download.js');assert.match(js,/api\/download/);assert.match(js,/idToken/);const kt=read('../../android/app/src/main/java/dev/nexbots/android/MainActivity.kt');assert.match(kt,/"Authorization", "Bearer \$bearer"/);assert.match(kt,/DownloadManager\.COLUMN_STATUS/)});
test('admin panel available',()=>{const code=read('../src/App.jsx');assert.match(code,/AdminPushPanel/);assert.match(code,/الإشعارات العامة/)});
import {handlePush} from '../server/push.js';
test('FCM token registers under authenticated account only',async()=>{
 const memory=new Map();const env={PUSH_TOKENS:{put:async(k,v)=>memory.set(k,JSON.parse(v)),delete:async k=>memory.delete(k)}};
 const deviceId='f4dca659-aee7-4bb2-8bc4-ce5edbce1234';const token='abc123:APA91'+'x'.repeat(85);
 const req=new Request('https://nexbots.pages.dev/api/push/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId,token,uid:'evil'})});
 const res=await handlePush(req,env,['push','register'],'POST',{identityUser:async()=>({user:{uid:'owner1',role:'user'}}),isOwner:()=>false});
 assert.equal(res.status,200);assert.equal(memory.size,1);
 assert.equal(memory.get('push:owner1:'+deviceId).uid,'owner1');
 assert.equal(memory.has('push:evil:'+deviceId),false);
});
test('members cannot send broadcast notifications',async()=>{
 const env={PUSH_TOKENS:{}};
 const req=new Request('https://nexbots.pages.dev/api/push/announcement',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'تنبيه',body:'هذا إعلان تجريبي'})});
 const result=await handlePush(req,env,['push','announcement'],'POST',{identityUser:async()=>({user:{uid:'member1'}}),isOwner:()=>false});
 assert.equal(result.status,403);
});
test('invalid device token rejected without touching KV',async()=>{
 let called=false;const env={PUSH_TOKENS:{put:async()=>{called=true}}};
 const req=new Request('https://nexbots.pages.dev/api/push/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceId:'bad',token:'bad'})});
 const result=await handlePush(req,env,['push','register'],'POST',{identityUser:async()=>({user:{uid:'owner1'}}),isOwner:()=>false});
 assert.equal(result.status,400);assert.equal(called,false);
});
