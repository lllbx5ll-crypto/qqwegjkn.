import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {detectImageMime,imageTypeOrThrow,uploadedFileLike} from '../server/media-validation.js';
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Real image magic bytes, not unreliable Android MIME, determine type',()=>{
 const png=Buffer.from('89504e470d0a1a0a00000000','hex');
 const jpg=Buffer.from('ffd8ffe000104a4649460000','hex');
 const webp=Buffer.from('524946460400000057454250','hex');
 assert.equal(detectImageMime(png),'image/png');
 assert.equal(detectImageMime(jpg),'image/jpeg');
 assert.equal(detectImageMime(webp),'image/webp');
 assert.equal(detectImageMime(Buffer.from('3c68746d6c3e3c68746d6c3e','hex')),null);
 assert.throws(()=>imageTypeOrThrow(Buffer.from('not-a-real-image')),/اختر ملف/);
});
test('File-like upload accepts legitimate browser Blob and rejects text pretending to be a file',()=>{
 assert.equal(uploadedFileLike(new File([new Uint8Array([1])],'hello.bin',{type:'application/octet-stream'})),true);
 assert.equal(uploadedFileLike('hello.bin'),false);
 assert.equal(uploadedFileLike({size:15,name:'fake.jpg'}),false);
});
test('Firestore rules allow missing block/like/project-edit lookups to return 404, not permission denied',()=>{
 const rules=source('firestore.rules');
 for(const phrase of ["edgeId.matches('^' + request.auth.uid", "viewId.matches('^' + request.auth.uid", "likeId.matches('^' + request.auth.uid", "exists(projectPath(projectId))"]){
   assert.ok(rules.includes(phrase),`Missing safe look-up for ${phrase}`);
 }
 const features=source('server/features.js');
 assert.doesNotMatch(features,/if\(!await getDoc\(env,'dmThreads',tid\)\)/);
 assert.match(features,/updateWrite\(env,'dmThreads',tid/);
});
test('Upload retry IDs are stable and do not duplicate projects or stories',()=>{
 assert.match(source('src/App.jsx'),/submissionId=useRef\(crypto.randomUUID\(\)\)/);
 assert.match(source('src/Community.jsx'),/submissionId=useRef\(crypto.randomUUID\(\)\)/);
 assert.match(source('server/api.js'),/alreadyReceived:true/);
 assert.match(source('server/features.js'),/alreadyReceived:true/);
});
test('Publishing guidance points to current Firestore rules, without stale v1.5 text',()=>{
 assert.doesNotMatch(source('server/api.js'),/نسخة NEXBOTS v1\.5/);
 assert.match(source('server/api.js'),/version:'v3\.1\.0'/);
});
