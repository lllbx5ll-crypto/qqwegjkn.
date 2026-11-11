import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const read=(f)=>fs.readFileSync(path.join(root,f),'utf8');

test('native Android points to live NEXBOTS web origin for dynamic site changes',()=>{
 const source=read('android/app/src/main/java/dev/nexbots/android/MainActivity.kt');
 assert.match(source,/private val base = "https:\/\/nexbots\.pages\.dev"/);
 assert.match(source,/web\.loadUrl\(base \+ lastPagePath\)/);
 assert.match(source,/setOf\(base\)/); // restricted JS message origin
});

test('offline shell has local navigation but no private or network data',()=>{
 const html=read('android/app/src/main/assets/offline.html');
 for(const route of ['/explore','/chat','/private','/account'])assert.ok(html.includes(`data-section="${route}"`));
 assert.match(html,/id="retry"/);
 assert.match(html,/تعذّر تنفيذ العملية دون اتصال/);
 assert.doesNotMatch(html,/fetch\(|localStorage|indexedDB|\/api\/private/);
});

test('native network fallback and top-screen failure banners are present',()=>{
 const activity=read('android/app/src/main/java/dev/nexbots/android/MainActivity.kt');
 const manifest=read('android/app/src/main/AndroidManifest.xml');
 assert.match(manifest,/android\.permission\.ACCESS_NETWORK_STATE/);
 assert.match(activity,/NET_CAPABILITY_VALIDATED/);
 assert.match(activity,/showOffline\(\)/);
 assert.match(activity,/Gravity\.TOP/);
 assert.match(activity,/showTopMessage\("تعذّر بدء التنزيل/);
});

test('website toast appears top and offline submits are blocked',()=>{
 const css=read('site/src/styles.css');
 const app=read('site/src/App.jsx');
 assert.match(css,/\.toast\{position:fixed;top:/);
 assert.match(app,/onSubmitCapture=\{preventOfflineSubmit\}/);
 assert.match(app,/onClickCapture=\{preventOfflineAction\}/);
});

test('GitHub has a root-level APK workflow with uploaded APK',()=>{
 const yaml=read('.github/workflows/build-android-apk.yml');
 assert.match(yaml,/workflow_dispatch:/);
 assert.match(yaml,/gradle --no-daemon --stacktrace assembleDebug/);
 assert.match(yaml,/actions\/upload-artifact@v4/);
 assert.match(yaml,/android\/app\/build\/outputs\/apk\/debug\/app-debug\.apk/);
});
