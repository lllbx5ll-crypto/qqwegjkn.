import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyToken} from '../server/auth.js';

const b64=txt=>Buffer.from(txt).toString('base64url');
test('Forged and expired identity tokens fail validation',async()=>{
 const env={FIREBASE_PROJECT_ID:'exbots'},now=Math.floor(Date.now()/1000);
 const invalid={aud:'exbots',iss:'https://securetoken.google.com/exbots',sub:'fake',exp:now-20,iat:now-100,auth_time:now-100};
 const request=new Request('https://example.com/api/me',{headers:{Authorization:`Bearer ${b64(JSON.stringify({alg:'RS256',kid:'fake'}))}.${b64(JSON.stringify(invalid))}.fakesig`}});
 await assert.rejects(()=>verifyToken(request,env),/انتهت جلسة/);
 const fake={...invalid,exp:now+200};
 const req2=new Request('https://example.com/api/me',{headers:{Authorization:`Bearer ${b64(JSON.stringify({alg:'none',kid:'fake'}))}.${b64(JSON.stringify(fake))}.fakesig`}});
 await assert.rejects(()=>verifyToken(req2,env),/انتهت جلسة/);
});
test('Anonymous request is not an authenticated identity',async()=>assert.equal(await verifyToken(new Request('https://example.com/api/me'),{FIREBASE_PROJECT_ID:'exbots'}),null));
