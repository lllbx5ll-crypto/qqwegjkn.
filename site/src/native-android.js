/** Secure opt-in bridge: injected by the native NEXBOTS Android WebView only. */
export function isNativeAndroid(){
  return typeof window!=='undefined' && window.location.origin==='https://nexbots.pages.dev'
    && typeof window.NexbotsAndroid?.postMessage==='function';
}
export function isEmbeddedWithoutBridge(){
  return typeof navigator!=='undefined' && /; wv\)|\bwv\b|Version\/4\.0.*Chrome\//i.test(navigator.userAgent||'') && !isNativeAndroid();
}
export function openExternalInAndroid(url){
  if(!isNativeAndroid())return false;
  try{
    const u=new URL(url);
    if(!['https:','mailto:','tel:'].includes(u.protocol))return false;
    window.NexbotsAndroid.postMessage(JSON.stringify({action:'openExternal',url:u.href}));
    return true;
  }catch{return false;}
}
export async function getNativeGoogleIdToken(){
  if(!isNativeAndroid())return null;
  const requestId=(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,token)=>{if(settled)return;settled=true;clearTimeout(timer);
      window.removeEventListener('nexbots-native-google-response',onResponse);
      if(error)reject(new Error(error)); else resolve(token);
    };
    const onResponse=(event)=>{
      const data=event?.detail||{};
      if(data.requestId!==requestId)return;
      if(data.idToken && typeof data.idToken==='string')finish('',data.idToken);
      else finish(data.error||'لم يكتمل تسجيل الدخول إلى Google. حاول مرة أخرى.');
    };
    const timer=setTimeout(()=>finish('انتهت مهلة اختيار حساب Google، حاول مرة أخرى.'),120000);
    window.addEventListener('nexbots-native-google-response',onResponse);
    try{window.NexbotsAndroid.postMessage(JSON.stringify({action:'googleSignIn',requestId}));}
    catch{finish('تعذّر تشغيل اختيار حساب Google على هذا الجهاز.');}
  });
}
