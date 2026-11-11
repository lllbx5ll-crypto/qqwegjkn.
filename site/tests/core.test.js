import test from 'node:test';
import assert from 'node:assert/strict';
import {enc,dec,fields,decodeDoc} from '../server/codec.js';
import {activePlan,can,cleanText,validLink,defaultPlans,MAX_IMAGE,MAX_FILE,PERMISSIONS} from '../server/constants.js';
import{readFileSync}from'node:fs';

test('Firestore codec roundtrip nested and Arabic',()=>{
 const value={name:'منصة بوتات',cost:3.5,quota:50,okay:true,nested:{tags:['واتساب','Python'],none:null}};
 const doc={name:'projects/exbots/databases/(default)/documents/projects/example',fields:fields(value),updateTime:'2026-11-02T14:00:00Z'};
 const decoded=decodeDoc(doc);assert.equal(decoded.id,'example');assert.equal(decoded.name,value.name);assert.equal(decoded.cost,3.5);assert.equal(decoded.nested.tags[0],'واتساب');assert.equal(decoded.nested.none,null);
});
test('Permissions are never granted by plan alone',()=>{
 assert.equal(can({role:'user',plan:'pro'},'manageProjects'),false);
 assert.equal(can({role:'developer',permissions:['manageProjects']},'manageProjects'),true);
 assert.equal(can({role:'developer',permissions:[]},'manageProjects'),false);
 assert.equal(can({role:'owner'},'manageSettings'),true);
 assert.equal(PERMISSIONS.includes('viewEmails'),true);
});
test('Expired plans are always free',()=>{
 assert.equal(activePlan({plan:'pro',planEndsAt:'2020-01-01T00:00:00.000Z'}),'free');
 assert.equal(activePlan({plan:'pro',planEndsAt:'2099-01-01T00:00:00.000Z'}),'pro');
 assert.equal(activePlan({plan:'premium',planEndsAt:null}),'free');
 assert.equal(activePlan({plan:'free',planEndsAt:'2099-01-01T00:00:00.000Z'}),'free');
});
test('Safe links and hard file limits',()=>{
 assert.equal(validLink('javascript:alert(1)'),'');
 assert.equal(validLink('http://example.com'),'');
 assert.equal(validLink('https://example.com/resource').startsWith('https://'),true);
 assert.equal(validLink('https://evil.com',true),'');
 assert.equal(validLink('https://wa.me/123456',true).startsWith('https://wa.me/'),true);
 assert.equal(MAX_IMAGE,204800);assert.equal(MAX_FILE,3145728);
 assert.equal(defaultPlans.free.dailyMessages,50);
});
test('Firestore rules enforce keyless roles, reviewed projects and quotas',()=>{
 const source=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
 assert.match(source,/function ownerEmail\(\)/);
 assert.match(source,/request\.auth\.token\.email_verified == true/);
 assert.match(source,/get\(ownerDoc\(\)\)\.data\.uid == request\.auth\.uid/);
 assert.match(source,/match \/projects\/\{projectId\}/);
 assert.match(source,/request\.resource\.data\.status == 'pending'/);
 assert.match(source,/request\.resource\.data\.status == 'approved'/);
 assert.match(source,/getAfter\(quotaPath/);
 assert.match(source,/request\.resource\.data\.count <= messageLimit\(\)/);
 assert.match(source,/match \/privateUsers\/\{uid\}/);
 assert.match(source,/allow read, write: if false;/);
});
test('R2 is bound to the existing private nexbots-files bucket',()=>{
 const source=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
 assert.match(source,/binding\s*=\s*"FILES"/);
 assert.match(source,/bucket_name\s*=\s*"nexbots-files"/);
});
