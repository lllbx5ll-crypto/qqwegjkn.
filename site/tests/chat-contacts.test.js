import test from 'node:test';
import assert from 'node:assert/strict';
import {chatMessageParts,subscriptionContactOptions} from '../src/chat-links.js';

const links=text=>chatMessageParts(text).filter(part=>part.type==='link');
test('chat makes https and www URLs clickable and preserves surrounding text',()=>{
 const items=chatMessageParts('شوف https://nexbots.pages.dev/chat، وهذه www.example.com!');
 assert.equal(items.filter(i=>i.type==='link').length,2);
 assert.equal(items.find(i=>i.type==='link').href,'https://nexbots.pages.dev/chat');
 assert.equal(items.filter(i=>i.type==='link')[1].href,'https://www.example.com/');
 assert.equal(items.map(i=>i.text).join(''),'شوف https://nexbots.pages.dev/chat، وهذه www.example.com!');
});
test('chat ignores unsafe or malformed schemes; HTML is never emitted',()=>{
 assert.equal(links('javascript:alert(1) data:text/html,hi').length,0);
 assert.equal(links('https://user:pass@example.com/').length,0);
 assert.deepEqual(chatMessageParts('<script>alert(1)</script>'),[{type:'text',text:'<script>alert(1)</script>'}]);
 assert.equal(links('https://www.').length,0);
});
test('chat handles Arabic punctuation and line breaks',()=>{
 const items=chatMessageParts('الأول:\nhttps://t.me/nexbots؛ التالي.');
 assert.equal(items.filter(i=>i.type==='link')[0].href,'https://t.me/nexbots');
 assert.equal(items.map(i=>i.text).join(''),'الأول:\nhttps://t.me/nexbots؛ التالي.');
});
test('subscription choices remain disabled until owner sets channel links',()=>{
 const options=subscriptionContactOptions({supportEmail:'owner@example.com',telegram:'',whatsapp:''},'Premium');
 assert.deepEqual(options.map(o=>o.available),[false,false,true]);
 assert.match(options[2].href,/^mailto:owner@example\.com\?subject=/);
 assert.match(decodeURIComponent(options[2].href),/Premium/);
});
test('WhatsApp request prefill, Telegram deep link, invalid schemes rejected',()=>{
 const options=subscriptionContactOptions({supportEmail:'owner@example.com',whatsapp:'https://wa.me/967712345678',telegram:'https://t.me/nexbots_support'},'Pro');
 assert.deepEqual(options.map(o=>o.available),[true,true,true]);
 assert.match(new URL(options[0].href).searchParams.get('text'),/Pro/);
 assert.equal(options[1].href,'https://t.me/nexbots_support');
 const malicious=subscriptionContactOptions({telegram:'javascript:alert(1)',whatsapp:'https://evil.example/steal',supportEmail:'owner@example.com'},'Plus');
 assert.deepEqual(malicious.map(o=>o.available),[false,false,true]);
});
test('links, Kuraimi payment chooser, and upload notice are wired to the rendered app',async()=>{
 const {readFileSync}=await import('node:fs');
 const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
 assert.match(app,/chatMessageParts\(msg\.text\)/);
 assert.match(app,/target="_blank" rel="noopener noreferrer nofollow ugc"/);
 assert.match(app,/<PaymentDialog plan=\{requestedPlan\}/);
 assert.match(app,/الدفع عبر الكريمي/);
 assert.doesNotMatch(app,/subscriptionContactOptions\(site,requestedPlan\.name\)/);
 assert.doesNotMatch(app,/الملفات تُخزن في Cloudflare R2 ولا تظهر/);
});
