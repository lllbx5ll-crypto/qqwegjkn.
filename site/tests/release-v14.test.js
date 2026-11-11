import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('release identifiable internally but hidden from public UI',()=>{
  assert.match(read('src/App.jsx'),/const RELEASE='v3.1.0'/);
  assert.match(read('index.html'),/name="nexbots-release" content="v3.1.0"/);
  assert.match(read('server/api.js'),/version:'v3.1.0'/);
});
test('unverified stat claims replaced by honest content',()=>{
  const app=read('src/App.jsx');
  assert.doesNotMatch(app,/<strong>05\+<\/strong>/);
  assert.doesNotMatch(app,/<strong>100%<\/strong>/);
  assert.doesNotMatch(app,/<strong>24\/7<\/strong>/);
  assert.match(app,/<strong>\{categories.length\}<\/strong>/);
  assert.match(app,/strong>يدوية<\/strong>/);
});
test('Tajawal and Readex loaded, styled and caching safe',()=>{
  assert.match(read('index.html'),/Readex\+Pro/);
  assert.match(read('index.html'),/Tajawal/);
  assert.match(read('src/styles.css'),/--nx-font: 'Tajawal'/);
  assert.match(read('public/_headers'),/Cache-Control: no-cache/);
});
test('settings API can report a missing Firebase configuration',()=>{
  assert.match(read('server/api.js'),/webApiKeyConfigured/);
  assert.match(read('server/api.js'),/إعداد Firebase ناقص في Pages/);
  assert.match(read('src/App.jsx'),/serviceError.title/);
  assert.doesNotMatch(read('src/App.jsx'),/افحص اتصال الخادم عبر \/api\/health/);
});
