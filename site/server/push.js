/** NEXBOTS private Android notifications. No device token is ever exposed to callers.
 * Bind a Cloudflare KV namespace as PUSH_TOKENS; configure FCM_SERVICE_ACCOUNT_JSON as a secret.
 * Message-sending permissions are checked in the existing API before invoking sendPrivatePush.
 */
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const bad=(reason,status=400)=>json({error:reason},status);
const utf8=s=>new TextEncoder().encode(s);
const b64url=buf=>{
 let s='';for(const c of new Uint8Array(buf))s+=String.fromCharCode(c);
 return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
const tokenFormat=t=>typeof t==='string'&&t.length>=40&&t.length<=4096&&/^[A-Za-z0-9_:.\-]+$/.test(t);
const deviceFormat=t=>typeof t==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(t);
const cleanText=(s,max)=>String(s||'').trim().slice(0,max);
let accessCache={key:'',token:'',until:0};
export async function fcmAccessToken(env){
 if(!env.FCM_SERVICE_ACCOUNT_JSON)throw Error('FCM غير مهيأ للخادم');
 const svc=JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON);
 if(!svc.client_email||!svc.private_key||svc.project_id!==env.FIREBASE_PROJECT_ID)throw Error('بيانات مشروع FCM غير متطابقة');
 if(accessCache.key===svc.client_email&&Date.now()<accessCache.until)return accessCache.token;
 const keyDer=Uint8Array.from(atob(svc.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),x=>x.charCodeAt(0));
 const key=await crypto.subtle.importKey('pkcs8',keyDer,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const now=Math.floor(Date.now()/1000);
 const enc=o=>b64url(utf8(JSON.stringify(o)));
 const header=enc({alg:'RS256',typ:'JWT'}),payload=enc({iss:svc.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const data=`${header}.${payload}`;
 const signature=b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,utf8(data)));
 const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${data}.${signature}`})});
 if(!res.ok)throw Error(`FCM OAuth ${res.status}`);
 const value=await res.json();if(!value.access_token)throw Error('FCM token unavailable');
 accessCache={key:svc.client_email,token:value.access_token,until:Date.now()+Math.min(3300,Number(value.expires_in||3500)-90)*1000};
 return value.access_token;
}
export async function sendFCM(env,message){
 const auth=await fcmAccessToken(env);
 const res=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/messages:send`,{method:'POST',headers:{'authorization':`Bearer ${auth}`,'content-type':'application/json'},body:JSON.stringify({message})});
 if(res.ok)return {ok:true};
 const body=await res.text();
 // Token is not included in error logs. Caller can remove invalid tokens.
 if(res.status===404||/UNREGISTERED|INVALID_ARGUMENT/.test(body))return {ok:false,unregistered:true};
 throw Error(`FCM delivery HTTP ${res.status}`);
}
const pushKey=(uid,deviceId)=>`push:${uid}:${deviceId}`;
export async function handlePush(request,env,path,method,{identityUser,isOwner,waitUntil}){
 if(path[0]!=='push')return null;
 if(!env.PUSH_TOKENS)return bad('الإشعارات غير مهيأة على الخادم بعد',503);
 const {user}=await identityUser(request,env);
 if(path[1]==='register'&&method==='POST'){
  const body=await request.json().catch(()=>null);
  if(!body||!tokenFormat(body.token)||!deviceFormat(body.deviceId))return bad('معلومات جهاز الإشعارات غير صحيحة');
  await env.PUSH_TOKENS.put(pushKey(user.uid,body.deviceId),JSON.stringify({token:body.token,uid:user.uid,updatedAt:Date.now()}),{expirationTtl:60*60*24*90});
  return json({ok:true});
 }
 if(path[1]==='unregister'&&method==='POST'){
  const body=await request.json().catch(()=>null);if(!deviceFormat(body?.deviceId))return bad('معرف الجهاز غير صالح');
  await env.PUSH_TOKENS.delete(pushKey(user.uid,body.deviceId));return json({ok:true});
 }
 if(path[1]==='announcement'&&method==='POST'){
  if(!isOwner(user))return bad('هذه الخاصية متاحة لمالك المنصة فقط',403);
  const body=await request.json().catch(()=>null);
  const title=cleanText(body?.title,80),text=cleanText(body?.body,450);
  if(title.length<3||text.length<5)return bad('اكتب عنوان الإعلان ونصه بشكل صحيح');
  if(!env.FCM_SERVICE_ACCOUNT_JSON)return bad('لم يتم إعداد FCM للخادم',503);
  const sent=await sendFCM(env,{topic:'nexbots_announcements',notification:{title,body:text},data:{path:'/',type:'announcement'},android:{priority:'high',notification:{channel_id:'nexbots_announcements'}}});
  if(!sent.ok)throw Error('تعذر إرسال الإعلان');
  return json({ok:true,info:'تم إرسال الإعلان إلى خدمة إشعارات Firebase. تسليمه إلى الأجهزة يعتمد على اتصالها وإذن الإشعارات.'});
 }
 return bad('المسار غير موجود',404);
}
export async function sendPrivatePush(env,recipientUid,senderName,threadId){
 if(!env.PUSH_TOKENS||!env.FCM_SERVICE_ACCOUNT_JSON||!recipientUid)return;
 // Bound the work per message: each member can register up to 16 devices.
 const results=await env.PUSH_TOKENS.list({prefix:`push:${recipientUid}:`,limit:16});
 for(const entry of results.keys){
  const record=await env.PUSH_TOKENS.get(entry.name,'json').catch(()=>null);
  if(!tokenFormat(record?.token)||record.uid!==recipientUid)continue;
  try{
   const sent=await sendFCM(env,{token:record.token,notification:{title:'رسالة جديدة في NEXBOTS',body:`لديك رسالة خاصة من ${cleanText(senderName,48)||'أحد الأعضاء'}`},data:{path:'/private',threadId:cleanText(threadId,80),type:'private'},android:{priority:'high',notification:{channel_id:'nexbots_messages'}}});
   if(sent.unregistered)await env.PUSH_TOKENS.delete(entry.name);
  }catch(error){console.warn('NEXBOTS push delivery failed:',error.message);}
 }
}
