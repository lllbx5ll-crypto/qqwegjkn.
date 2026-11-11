// RFC 7519 RS256 Firebase ID-token verification. No service-account key.
// Never trust just the user-supplied email; verify JWT signature and claims.
const unbase = (s) => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const jwkUrl='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwks=null, jwksUntil=0;
export async function verifyToken(request, env) {
  const header=request.headers.get('Authorization')||'';
  const match=header.match(/^Bearer (\S+)$/);
  if(!match)return null;
  const jwt=match[1], parts=jwt.split('.');
  if(parts.length!==3)throw new Error('رمز تسجيل الدخول غير صالح');
  let head, payload;
  try {head=JSON.parse(new TextDecoder().decode(unbase(parts[0])));payload=JSON.parse(new TextDecoder().decode(unbase(parts[1])));} catch {throw new Error('رمز تسجيل الدخول تالف');}
  const now=Math.floor(Date.now()/1000), pid=env.FIREBASE_PROJECT_ID;
  if(head.alg!=='RS256'||!head.kid||payload.aud!==pid||payload.iss!==`https://securetoken.google.com/${pid}`||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>128||payload.exp<=now||payload.iat>now+30||payload.auth_time>now+30||!payload.exp||!payload.iat||!payload.auth_time)throw new Error('انتهت جلسة الدخول أو لم يتم التحقق منها');
  if(!jwks||Date.now()>jwksUntil){const res=await fetch(jwkUrl);if(!res.ok)throw new Error('تعذر التحقق من هوية المستخدم');jwks=await res.json();jwksUntil=Date.now()+3600_000;}
  let jwk=jwks.keys.find(k=>k.kid===head.kid);
  if(!jwk){const r=await fetch(jwkUrl);if(!r.ok)throw new Error('تعذر تحديث مفاتيح Google');jwks=await r.json();jwksUntil=Date.now()+3600_000;jwk=jwks.keys.find(k=>k.kid===head.kid);}
  if(!jwk)throw new Error('مفتاح المصادقة غير موجود');
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,unbase(parts[2]),new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if(!valid)throw new Error('توقيع تسجيل الدخول غير صالح');
  return {uid:payload.sub,email:payload.email||'',emailVerified:payload.email_verified===true,name:payload.name||'',picture:payload.picture||''};
}
