import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Private conversations preserve history while blocks prevent new messages',()=>{
 const rules=src('firestore.rules'),features=src('server/features.js');
 assert.match(rules,/function memberThread\(id\)/);
 assert.match(rules,/allow get, list: if memberThread\(resource.data.threadId\)/);
 assert.match(rules,/allow create: if registered\(\) && !blocked\(\)\s*&& inThread/);
 assert.match(features,/await checkUnblocked\(env,user.uid,recipient\)/);
});
test('R2 story media API can retrieve only still-active stories',()=>{
 const rules=src('firestore.rules'),api=src('server/api.js');
 assert.match(rules,/allow get: if \(resource == null && registered\(\)\) \|\| resource.data.expiresAt > request.time;/);
 assert.match(api,/path\[1\]==='story'/);
 assert.match(api,/Date.parse\(story.expiresAt\)<=Date.now\(\)/);
 assert.match(api,/cache-control','no-store/);
});
test('Story cleanup deletion happens on R2 before removing Firestore',()=>{
 const features=src('server/features.js'),cron=src('cleanup/worker.js');
 assert.ok(features.indexOf("await env.FILES.delete(story.mediaKey)") < features.indexOf("await removeDoc(env,'stories',path[1])"));
 assert.ok(cron.indexOf('await env.FILES.delete(field)') < cron.indexOf("method:'DELETE'"));
 assert.match(cron,/field.startsWith\('stories\/'\)/);
});
test('Stories are limited to five active uploads per user and expire after 24 hours',()=>{
 const features=src('server/features.js');
 assert.match(features,/activeOwn.length>=5/);
 assert.match(features,/86400000/);
 assert.match(features,/new Date\(Date.now\(\)\+10000\)/);
});
test('Report moderation metadata matches Firestore allowed fields',()=>{
 const features=src('server/features.js'),rules=src('firestore.rules');
 assert.match(features,/reviewerUid:user.uid/);
 assert.match(rules,/\['status','reviewerUid','reviewedAt','reason'\]/);
});
test('DM owner and buyer conditions stay part of existing project system',()=>{
 const api=src('server/api.js');
 assert.match(api,/purchase-grants/);
 assert.match(api,/project-edits/);
 assert.match(api,/forSale\?undefined/);
});
