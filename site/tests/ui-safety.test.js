import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const text=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const asset=p=>existsSync(new URL('../public/'+p,import.meta.url));
test('Rendering errors show a recoverable page instead of a blank viewport',()=>{
 const ui=text('src/App.jsx');
 assert.match(ui,/class CrashBoundary extends React\.Component/);
 assert.match(ui,/componentDidCatch/);
 assert.match(ui,/SafeRouteView/);
 assert.match(ui,/تعذّر عرض هذه الصفحة/);
 assert.match(ui,/إعادة المحاولة/);
});
test('Category and Google SVG marks are bundled, not susceptible to missing uploads',()=>{
 const lib=text('src/lib.js'),app=text('src/App.jsx');
 for(const name of ['whatsapp','telegram','python','javascript','php','code','google','instagram']){
  assert.ok(asset('icons/'+name+'.svg'),`Missing original SVG: ${name}`);
  assert.match(lib,new RegExp(`"${name}":"<svg`));
  assert.match(name==='google'||name==='instagram'?app:lib,new RegExp(`brandIcons\\.${name}`));
 }
 assert.match(lib,/data:image\/svg\+xml/);
 assert.match(app,/function GoogleMark/);
 assert.match(app,/src=\{brandIcons\.google\}/);
 assert.doesNotMatch(app,/src=\{c\.icon\}[^>]*href=/);
});
test('Subscription crown is golden and mobile visual effects are bounded',()=>{
 const css=text('src/styles.css');
 assert.match(css,/--gold:#ffcf68/);
 assert.match(css,/\.side-link\[href="\/plans"\]/);
 assert.match(css,/\.plan-icon svg/);
 assert.match(css,/@media \(max-width:650px\)/);
 assert.ok(asset('nexbots-logo.webp'));
});
test('Missing API results do not corrupt site config or trap profile loading',()=>{
 const app=text('src/App.jsx'),lib=text('src/lib.js');
 assert.match(app,/\.\.\.defaultSite,\.\.\.data\.settings/);
 assert.match(app,/Array\.isArray\(data\)\?data:\[\]/);
 assert.match(app,/loading\?<Loading\/>:!error\?/);
 assert.match(lib,/AbortController/);
 assert.match(lib,/انتهت مهلة الاتصال/);
});

test('Avatar updates no longer persist Firestore metadata fields',()=>{
 const fs=text('server/firestore.js');
 assert.match(fs,/function cleanForWrite/);
 assert.match(fs,/const \{id, _updateTime, \.\.\.documentFields\}/);
 assert.match(fs,/fields\(cleanForWrite\(value\)\)/);
 const api=text('server/api.js');
 assert.match(api,/await env\.FILES\.delete\(key\)/);
});
test('Modern Arabic typography, premiums and mobile controls are present',()=>{
 const css=text('src/styles.css'),html=text('index.html'),lib=text('src/lib.js'),app=text('src/App.jsx');
 assert.match(html,/Readex\+Pro/);
 assert.match(html,/Tajawal/);
 assert.match(css,/plan-feature-count/);
 assert.match(app,/plan-feature-count/);
 assert.match(lib,/مميزات الحساب المجاني/);
});
