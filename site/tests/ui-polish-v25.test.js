import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Project author card links to the profile and renders current identity with blue verified mark',()=>{
 const app=src('src/App.jsx'),api=src('server/api.js'),css=src('src/styles.css');
 assert.match(app,/className="detail-panel author-panel"/);
 assert.match(app,/<Avatar user=\{p\.authorProfile\|\|/);
 assert.match(app,/<Verified user=\{p\.authorProfile\}/);
 assert.match(api,/publicProject\.authorProfile/);
 assert.match(api,/verified:author\?\.verified===true\|\|author\?\.role==='owner'/);
 assert.match(css,/\.detail-sidebar \.author-panel\{display:block/);
 assert.match(css,/\.author-panel \.author-summary\{display:grid/);
});
test('Project cover images are not cropped, and categories/support show two columns on mobile',()=>{
 const css=src('src/styles.css');
 assert.match(css,/\.project-visual > img,\.detail-image > img\{object-fit:contain/);
 assert.match(css,/\.categories-grid,\.support-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
test('Stories, member search, and chats retain order; unread count is real, not hardcoded',()=>{
 const jsx=src('src/Community.jsx'),server=src('server/features.js'),rules=src('firestore.rules');
 const story=jsx.indexOf('className="panel stories-section"');
 const search=jsx.indexOf('className="panel community-directory community-directory-full community-search-section"');
 const thread=jsx.indexOf('community-conversation-list');
 assert.ok(story>=0&&search>story&&thread>search);
 assert.doesNotMatch(jsx,/<h3><AtSign size=\{20\}\/> ابحث عن عضو<\/h3>/);
 assert.match(jsx,/unreadCounts\?\.\[me\.uid\]/);
 assert.match(jsx,/onSnapshot\(feed,snapshot/);
 assert.match(jsx,/dm-unread-count/);
 assert.match(server,/unreadCounts:nextCounts/);
 assert.match(rules,/allow update: if inThread\(threadId\)/);
 assert.match(rules,/request\.resource\.data\.unreadCounts/);
});
