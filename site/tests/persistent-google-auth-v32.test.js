import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = x => fs.readFileSync(new URL(x, import.meta.url), 'utf8');
test('web and Android use the same Firebase project and Android app ID', () => {
  const site = read('../src/lib.js');
  const config = JSON.parse(read('../../android/app/google-services.json'));
  assert.match(site, /exbots/);
  assert.equal(config.project_info.project_id, 'exbots');
  assert.equal(config.client[0].client_info.android_client_info.package_name, 'dev.nexbots.android');
});
test('Google auth persists before native credential sign-in', () => {
  const site = read('../src/lib.js');
  assert.match(site, /await setPersistence\(auth,browserLocalPersistence\)/);
  assert.ok(site.indexOf('await setPersistence(auth,browserLocalPersistence)') < site.indexOf('const nativeToken=await getNativeGoogleIdToken()'));
  assert.match(site, /signInWithCredential\(auth,GoogleAuthProvider.credential\(nativeToken\)\)/);
  assert.match(site, /signOut\(auth\)/);
});
test('Android WebView keeps local storage enabled and opens Downloads, not ZIP viewer', () => {
  const android = read('../../android/app/src/main/java/dev/nexbots/android/MainActivity.kt');
  assert.match(android, /domStorageEnabled = true/);
  assert.match(android, /DownloadManager.ACTION_VIEW_DOWNLOADS/);
  assert.doesNotMatch(android, /dm.getUriForDownloadedFile\(id\)/);
  assert.match(android, /DownloadManager.STATUS_SUCCESSFUL/);
});
