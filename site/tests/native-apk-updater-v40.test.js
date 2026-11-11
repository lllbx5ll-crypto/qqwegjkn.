import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
test('Android 4.0 integrates native in-app updater without changing other bridge actions',()=>{
 const kt=read('android/app/src/main/java/dev/nexbots/android/MainActivity.kt');
 for(const action of ['getAppVersion','installAppUpdate','googleSignIn','shareLink','downloadProject','openDownload','requestPushToken'])
  assert.match(kt,new RegExp('"' + action + '"'));
 assert.match(kt,/setOf\(base\)/);
 assert.match(kt,/uri\.path != "\/api\/app-release\/apk"/);
 assert.match(kt,/url\.scheme/);
 assert.match(kt,/length > 50L \* 1024L \* 1024L/);
 assert.match(kt,/DownloadManager\.Request\(uri\)/);
 assert.match(kt,/setDestinationInExternalFilesDir/);
 assert.match(kt,/getInstalledVersionCode\(|installedVersionCode\(\)/);
});
test('Android validates downloaded APK hash, application package, versionCode and same signing certificate',()=>{
 const kt=read('android/app/src/main/java/dev/nexbots/android/MainActivity.kt');
 for(const pattern of [/MessageDigest\.getInstance\("SHA-256"\)/,/sha != update\.sha256/,/archived\.packageName != packageName/,/actualCode != expectedVersion/,/PackageManager\.GET_SIGNING_CERTIFICATES/,/candidate\.toByteArray\(\)\.contentEquals\(actual\.toByteArray\(\)\)/,/FileProvider\.getUriForFile/,/Intent\.FLAG_GRANT_READ_URI_PERMISSION/])
  assert.match(kt,pattern);
});
test('APK installer requests permission and uses normal Android confirmation instead of silent install',()=>{
 const manifest=read('android/app/src/main/AndroidManifest.xml');
 const paths=read('android/app/src/main/res/xml/nexbots_file_paths.xml');
 const kt=read('android/app/src/main/java/dev/nexbots/android/MainActivity.kt');
 const gradle=read('android/app/build.gradle.kts');
 assert.match(manifest,/android\.permission\.REQUEST_INSTALL_PACKAGES/);
 assert.match(manifest,/android:name="androidx\.core\.content\.FileProvider"/);
 assert.match(manifest,/android:exported="false"/);
 assert.match(paths,/<external-files-path name="nexbots_apk_updates" path="Download\/"\/>/);
 assert.match(kt,/ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
 assert.match(kt,/canRequestPackageInstalls\(\)/);
 assert.match(kt,/Intent\(Intent\.ACTION_VIEW\)/);
 assert.match(gradle,/versionCode = 6/);
 assert.match(gradle,/versionName = "4\.0\.0"/);
});
