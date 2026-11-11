import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicStatus,cachePublicSettings,readPublicSettings,OFFLINE_MESSAGE} from '../src/public-status.js';
import {getNativeGoogleIdToken,isNativeAndroid,openExternalInAndroid} from '../src/native-android.js';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf-8');

test('public error message is readable and does not expose Firebase internals',()=>{
 const ui=read('src/App.jsx');
 assert.match(ui,/serviceError\.title/);
 assert.doesNotMatch(ui,/افحص اتصال الخادم عبر \/api\/health/);
 assert.equal(publicStatus(new Error('failed'),false).message,OFFLINE_MESSAGE);
 assert.equal(publicStatus({code:'NETWORK'},true).title,'تعذّر الاتصال حالياً');
 assert.equal(publicStatus(new Error('Firebase PERMISSION_DENIED'),true).title,'المنصة غير متاحة مؤقتاً');
});

test('public settings cache contains no account secret and survives parsing errors',()=>{
 const store=new Map();
 globalThis.localStorage={getItem:key=>store.get(key)||null,setItem:(key,val)=>store.set(key,val)};
 cachePublicSettings({settings:{siteName:'NEXBOTS'},plans:{plus:{}}});
 const cached=readPublicSettings();
 assert.equal(cached.settings.siteName,'NEXBOTS');
 assert.ok(!JSON.stringify(cached).includes('idToken'));
 delete globalThis.localStorage;
});

test('native login bridge is origin-restricted and correlates login responses',async()=>{
 let response;
 const sent=[];
 globalThis.window={location:{origin:'https://nexbots.pages.dev'},NexbotsAndroid:{postMessage:value=>sent.push(JSON.parse(value))},addEventListener:(name,cb)=>{response=cb},removeEventListener:()=>{}};
 assert.equal(isNativeAndroid(),true);
 assert.equal(openExternalInAndroid('https://wa.me/9671234567'),true);
 assert.equal(openExternalInAndroid('javascript:alert(1)'),false);
 const pending=getNativeGoogleIdToken();
 const call=sent.find(x=>x.action==='googleSignIn');
 assert.ok(call?.requestId);
 response({detail:{requestId:call.requestId,idToken:'id-token-from-native'}});
 assert.equal(await pending,'id-token-from-native');
 window.location.origin='https://evil.example';
 assert.equal(isNativeAndroid(),false);
 delete globalThis.window;
});

test('support links open with Android external handler, not WebView internal iframe',()=>{
 const app=read('src/App.jsx');
 assert.match(app,/onOutsideContact\(e,site\[key\]\)/);
 assert.match(app,/نسخ رابط التواصل/);
 const native=read('src/native-android.js');
 assert.match(native,/NexbotsAndroid/);
 const kotlin=read('src/lib.js');
 assert.match(kotlin,/signInWithCredential/);
});
