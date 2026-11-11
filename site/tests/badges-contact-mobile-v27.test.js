import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {badgeKind} from '../src/badges.js';
import {validInternalChatLink} from '../server/constants.js';
import {isSupportedProjectFile} from '../server/project-file-types.js';
const source=rel=>readFileSync(new URL('../'+rel,import.meta.url),'utf8');
const NOW=Date.parse('2026-11-06T00:00:00Z');

test('blue remains manually controlled and overrides paid white badge',()=>{
 assert.equal(badgeKind({verified:false,activePlan:'pro',badgeType:'blue'},NOW),'blue');
 assert.equal(badgeKind({verified:true,activePlan:'pro',badgeType:'white'},NOW),'white');
 assert.equal(badgeKind({verified:true,activePlan:'pro',badgeType:'none'},NOW),null);
 assert.equal(badgeKind({verified:true,activePlan:'free'},NOW),'blue');
});
test('white badge only for active subscription, expired members lose automatic white',()=>{
 assert.equal(badgeKind({activePlan:'plus',badgeType:'auto'},NOW),'white');
 assert.equal(badgeKind({activePlan:'premium',badgeType:'auto'},NOW),'white');
 assert.equal(badgeKind({activePlan:'pro',badgeType:'auto'},NOW),'white');
 assert.equal(badgeKind({activePlan:'free',badgeType:'auto'},NOW),null);
 assert.equal(badgeKind({plan:'pro',planEndsAt:'2026-10-01T00:00:00Z'},NOW),null);
 assert.equal(badgeKind({plan:'pro',planEndsAt:'2026-12-01T00:00:00Z'},NOW),'white');
});
test('owner-only link settings sanitize to first-party private messages',()=>{
 assert.equal(validInternalChatLink('https://nexbots.pages.dev/private?to=abc-123'),'/private?to=abc-123');
 assert.equal(validInternalChatLink('/u/abc-123'),'/private?to=abc-123');
 assert.equal(validInternalChatLink('/private?to=abc-123'),'/private?to=abc-123');
 assert.equal(validInternalChatLink(''), '');
 for(const evil of ['https://evil.tld/private?to=abc','javascript:alert(1)','//evil.tld/private?to=abc','/private/t/id','/private?to=abc&next=https://evil.tld','/private?to=bad%2Fname'])assert.equal(validInternalChatLink(evil),null,evil);
});
test('Android file picker does not filter JS/PHP/PY and server allows source files',()=>{
 const app=source('src/App.jsx');
 assert.match(app,/const accept=kind==='image'\?'image\/jpeg,image\/png,image\/webp':undefined/);
 assert.match(app,/snapshotUploadFile\(f,sizeLimit\)/);
 for(const file of ['x.zip','x.js','x.php','x.py','x.jsx','x.tsx','x.html','x.css','x.java','x.go','x.rs','x.7z','x.rar'])assert.equal(isSupportedProjectFile(file),true,file);
 for(const file of ['payload.exe','payload.apk','payload.html.js.exe','../secret.py','\\tmp.py'])assert.equal(isSupportedProjectFile(file),false,file);
 assert.match(source('server/api.js'),/isSupportedProjectFile\(fileName\)/);
 assert.match(source('server/api.js'),/isSupportedProjectFile\(file.name\)/);
});
test('new support links and badge controls are exposed, but cannot be assigned by an ordinary user',()=>{
 const app=source('src/App.jsx'),rules=source('firestore.rules'),api=source('server/api.js');
 assert.match(app,/function VerificationPage/);
 assert.match(app,/حساب الشكاوى/);
 assert.match(app,/طلبات التوثيق/);
 assert.match(app,/شارة بيضاء — منح يدوي/);
 assert.match(api,/if\('badgeType'in data\)\{need\(user,'manageBadges'\)/);
 assert.match(rules,/\['verified', 'badgeType'\]/);
 assert.match(rules,/\.hasOnly\(\['displayName', 'bio', 'avatar', 'cover', 'updatedAt','username'\]\)/);
});
