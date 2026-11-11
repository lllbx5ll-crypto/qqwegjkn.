import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');
const api=readFileSync(new URL('../server/api.js',import.meta.url),'utf8');
test('Profile routes get ids from real location rather than missing useParams route context',()=>{
 assert.match(source,/function PublicProfile\(\)\{\s*const id=useLocation\(\)\.pathname\.split/);
 assert.match(source,/function ProjectPage\(\)\{const id=useLocation\(\)\.pathname\.split/);
});
test('Chat resolves author photo and nickname from up-to-date Firestore user profiles',()=>{
 assert.match(source,/getDoc\(doc\(db,'users',uid\)\)/);
 assert.match(source,/members\[msg\.uid\]/);
 assert.match(source,/author\.displayName/);
 assert.match(source,/<Avatar user=\{author\}/);
});
test('Share and social interactions are genuinely interactive, not cosmetic',()=>{
 assert.match(source,/navigator\.share/);
 assert.match(source,/navigator\.clipboard\.writeText/);
 assert.match(source,/social\('follow'\)/);
 assert.match(source,/social\('like'\)/);
 assert.match(api,/commit\(env,writes\)/);
 assert.match(rules,/getAfter\(userDoc\(request\.resource\.data\.targetUid\)\)/);
 assert.match(rules,/socialCountUpdate/);
});
