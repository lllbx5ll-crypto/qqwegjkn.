import {initializeApp} from 'firebase/app';
import {getFirestore} from 'firebase/firestore';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithRedirect,signInWithCredential,signOut,onAuthStateChanged,setPersistence,browserLocalPersistence} from 'firebase/auth';
const config={
 apiKey:import.meta.env.VITE_FIREBASE_API_KEY||'AIzaSyCRXKLCjTyTfwxDWN4qGvDVaFyw3xGFS0I',
 authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN||'exbots.firebaseapp.com',
 projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID||'exbots',
 appId:import.meta.env.VITE_FIREBASE_APP_ID||'1:933662316539:web:60582d9625f601f1395d5e'
};
const firebaseApp=initializeApp(config);
export const auth=getAuth(firebaseApp);
export const db=getFirestore(firebaseApp);
import {getNativeGoogleIdToken} from './native-android.js';
const provider=new GoogleAuthProvider();
provider.setCustomParameters({prompt:'select_account'});
export const login=async()=>{
  // One sign-in per app installation/browser profile: preserve the Firebase session
  // when the WebView is closed or Android recreates the Activity. Both the website
  // and Android resolve the same Firebase UID (but keep separate local sessions).
  // Explicitly apply LOCAL before accepting the Google credential.
  await setPersistence(auth,browserLocalPersistence);
  // Native Android uses Credential Manager's account picker; never open Google OAuth
  // inside an embedded WebView (which Google does not support).
  const nativeToken=await getNativeGoogleIdToken();
  if(nativeToken){await signInWithCredential(auth,GoogleAuthProvider.credential(nativeToken));return;}
  try{await signInWithPopup(auth,provider);}
  catch(e){
    if(['auth/popup-blocked','auth/operation-not-supported-in-this-environment'].includes(e.code)){
      // Web redirect on phones/regular browsers only. Generic HTML-to-APK WebViews
      // cannot guarantee Google Sign-in without native support.
      if(/; wv\)|\bwv\b/i.test(navigator.userAgent||''))
        throw new Error('تسجيل Google داخل هذا التطبيق يحتاج دعماً من تطبيق أندرويد. استخدم التطبيق المتوافق أو افتح NEXBOTS في Chrome.');
      await signInWithRedirect(auth,provider);return;
    }
    throw e;
  }
};
export const logout=async()=>{try{await window.nexbotsUnregisterPush?.();}catch{}return signOut(auth);};
export {onAuthStateChanged};
export function isConnectivityFailure(error){
 return !!error && (error.name==='AbortError'||error instanceof TypeError||error.code==='NETWORK');
}
export async function api(path,options={}){
 const user=auth.currentUser;
 const headers={...(options.headers||{})};
 const publicRead=(options.method||'GET').toUpperCase()==='GET'&&/^(?:public|projects)$/.test(path.replace(/^\//,'').split('?')[0]);
 if(user&&!publicRead)headers.Authorization=`Bearer ${await user.getIdToken()}`;
 const body=options.body;
 let requestBody=body;
 if(body!==undefined&&!(body instanceof FormData)&&!(body instanceof Blob)&&typeof body!=='string'){
  headers['content-type']='application/json';requestBody=JSON.stringify(body);
 }
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),body instanceof Blob?600000:body instanceof FormData?120000:30000);
 try {
  const url=`/api/${path.replace(/^\//,'')}`;
  const method=(options.method||'GET').toUpperCase();
  if(method!=='GET' && typeof navigator!=='undefined' && !navigator.onLine)throw Object.assign(new Error('لا يمكن الإرسال أو الدفع أو الرفع دون اتصال بالإنترنت.'),{code:'OFFLINE'});
  let r;
  for(let attempt=0;attempt<(method==='GET'?3:1);attempt++){
   try{r=await fetch(url,{...options,body:requestBody,headers,signal:options.signal||controller.signal});}
   catch(err){
    if(method==='GET'&&attempt<2&&err instanceof TypeError){await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));continue;}
    throw err;
   }
   if(method==='GET'&&attempt<2&&[502,503,504].includes(r.status)){
    await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));continue;
   }
   break;
  }
  if(options.raw)return r;
  const raw=await r.text();let data=null;
  try{data=raw?JSON.parse(raw):null;}catch{}
  // Cloudflare 1101/1102/403 error pages are HTML, not JSON. Previously
  // these were reported as generic "network disconnected", obscuring the
  // real cause and prompting pointless retries.
  if(data===null){
    const errorCode=raw.match(/\b(?:Error|error|status)\s*[:#]?\s*(1\d{3}|4\d{2}|5\d{2})\b/)?.[1]||'';
    const ray=r.headers.get('cf-ray')||'';
    const trace=r.headers.get('x-nexbots-request-id')||'';
    const info=[`HTTP ${r.status}`,errorCode?`Cloudflare ${errorCode}`:'',ray?`Ray ${ray}`:'',trace?`Trace ${trace}`:''].filter(Boolean).join(' · ');
    throw Object.assign(new Error(`الخادم أعاد استجابة غير متوقعة (${info}). افتح سجلات Cloudflare لهذه المحاولة.`),{status:r.status||502,kind:'INVALID_RESPONSE'});
  }
  if(!r.ok){
    const trace=r.headers.get('x-nexbots-request-id')||'';
    const error=new Error((data?.error || (r.status>=500?'حدث خلل مؤقت في الخادم':`فشل الطلب (${r.status})`))+(trace?` [Trace ${trace}]`:''));
    error.status=r.status;throw error;
  }
  return data;
 }catch(error){
  if(error?.name==='AbortError')throw Object.assign(new Error('انتهت مهلة الاتصال؛ سنفحص إن كان الطلب قد حُفظ قبل إعادة إرساله'),{code:'NETWORK'});
  if(error instanceof TypeError)throw Object.assign(new Error('تعذّر الوصول للخادم مؤقتاً. تحقق من الاتصال ولا تكرر الرفع قبل فحص حالته'),{code:'NETWORK'});
  throw error;
 }finally{clearTimeout(timeout);}
}
// Transfer media independently of Firestore writes. Streaming the Blob avoids
// buffering a large multipart body inside Pages Functions (particularly on Free).
// A lost PUT response is verified against R2 before retrying, not guessed.
export async function stageAsset(section,submissionId,slot,file,{storyType}={}){
 if(!(file instanceof Blob)||!file.size)throw new Error('اختر ملفاً غير فارغ');
 if(!/^[a-f0-9]{8}-[a-f0-9-]{27,}$/i.test(submissionId))throw new Error('معرّف عملية الرفع غير صحيح');
 const endpoint=`stage/${section}/${submissionId}/${slot}`;
 try{
  return await api(endpoint,{method:'POST',body:file,headers:{'content-type':'application/octet-stream','x-file-name':encodeURIComponent(file.name||'file'),'x-file-size':String(file.size),'x-story-type':storyType||''}});
 }catch(error){
  if(error?.code==='NETWORK'){
   try{
    const status=await api(`stage-status/${section}/${submissionId}/${slot}`);
    if(status.received&&status.size===file.size)return {...status,recovered:true};
   }catch{}
   throw Object.assign(new Error('انقطع الاتصال أثناء نقل الملف إلى التخزين. لم يتم تأكيد رفعه؛ أعد المحاولة من نفس الصفحة بعد التأكد من الشبكة.'),{code:'NETWORK'});
  }
  throw error;
 }
}
// Upload MP4 story videos in independently retryable 1MiB pieces.
// Never use this helper for /projects: its existing stable upload flow stays intact.
export async function stageStoryVideo(submissionId,file,onProgress=()=>{}){
 if(!(file instanceof Blob)||!file.size||file.size>12*1024*1024)throw Error('فيديو الستوري لا يتجاوز 12MB');
 const partSize=1024*1024,total=Math.ceil(file.size/partSize);
 for(let index=0;index<total;index++){
  const chunk=file.slice(index*partSize,Math.min(file.size,(index+1)*partSize));
  let completed=false,lastError=null;
  for(let attempt=0;attempt<4&&!completed;attempt++){
   try{
    await api(`stage-story-chunk/${submissionId}/${index}`,{method:'POST',body:chunk,headers:{'content-type':'application/octet-stream','x-file-size':String(chunk.size),'x-file-total-size':String(file.size),'x-total-parts':String(total)}});
    completed=true;
   }catch(error){
    lastError=error;
    if(error?.status&&![429,502,503,504].includes(error.status))throw error;
    try{const check=await api(`stage-story-chunk/${submissionId}/${index}`);if(check.received&&check.size===chunk.size)completed=true;}catch{}
    if(!completed&&attempt<3)await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
   }
  }
  if(!completed)throw Object.assign(new Error(`تعذّر رفع جزء الفيديو ${index+1} من ${total}. ${lastError?.message||'تحقق من الشبكة وأعد المحاولة.'}`),{code:lastError?.code||'UPLOAD'});
  onProgress(Math.round(((index+1)/total)*95));
 }
 try{
  const result=await api(`stage-story-complete/${submissionId}`,{method:'POST',body:{size:file.size}});
  onProgress(100);return result;
 }catch(error){
  if(error?.code==='NETWORK'){
   try{const status=await api(`stage-status/stories/${submissionId}/media`);if(status.received&&status.size===file.size){onProgress(100);return {...status,recovered:true};}}catch{}
  }
  throw error;
 }
}
export async function uploadFile(path,form){
 const submissionId=String(form.get('submissionId')||'');
 try{return await api(path,{method:'POST',body:form});}
 catch(error){
  if(error?.code==='NETWORK' && submissionId && (path==='projects'||path==='stories')){
   try{
    const saved=await api(`upload-status/${path}/${encodeURIComponent(submissionId)}`);
    if(saved?.received)return {...saved,alreadyReceived:true,recovered:true};
   }catch{} // A failed status probe must never claim that the upload succeeded.
   throw Object.assign(new Error('لم نستطع تأكيد استلام الملف بسبب الاتصال. تحقق من مشاريعي أو الستوريات قبل إعادة المحاولة؛ لا تغلق الصفحة أثناء الرفع.'),{code:'NETWORK'});
  }
  throw error;
 }
}
export const niceDate=(iso)=>{if(!iso)return '—';try{return new Date(iso).toLocaleDateString('ar',{year:'numeric',month:'short',day:'numeric'});}catch{return '—';}};
// Versioned, build-bundled SVG data URIs: never show broken images when the
// public/icons folder is missed during a mobile GitHub upload.
const SVG_SOURCES = {"whatsapp":"<svg xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-label=\"whatsapp\" viewBox=\"0 0 448 512\" width=\"448\" height=\"512\"><title>whatsapp</title><path fill=\"#25D366\" d=\"M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z\"/></svg>","telegram":"<svg xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-label=\"telegram\" viewBox=\"0 0 496 512\" width=\"496\" height=\"512\"><title>telegram</title><path fill=\"#2AABEE\" d=\"M248,8C111.033,8,0,119.033,0,256S111.033,504,248,504,496,392.967,496,256,384.967,8,248,8ZM362.952,176.66c-3.732,39.215-19.881,134.378-28.1,178.3-3.476,18.584-10.322,24.816-16.948,25.425-14.4,1.326-25.338-9.517-39.287-18.661-21.827-14.308-34.158-23.215-55.346-37.177-24.485-16.135-8.612-25,5.342-39.5,3.652-3.793,67.107-61.51,68.335-66.746.153-.655.3-3.1-1.154-4.384s-3.59-.849-5.135-.5q-3.283.746-104.608,69.142-14.845,10.194-26.894,9.934c-8.855-.191-25.888-5.006-38.551-9.123-15.531-5.048-27.875-7.717-26.8-16.291q.84-6.7,18.45-13.7,108.446-47.248,144.628-62.3c68.872-28.647,83.183-33.623,92.511-33.789,2.052-.034,6.639.474,9.61,2.885a10.452,10.452,0,0,1,3.53,6.716A43.765,43.765,0,0,1,362.952,176.66Z\"/></svg>","python":"<svg xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-label=\"python\" viewBox=\"0 0 448 512\" width=\"448\" height=\"512\"><title>python</title><path fill=\"#F4C542\" d=\"M439.8 200.5c-7.7-30.9-22.3-54.2-53.4-54.2h-40.1v47.4c0 36.8-31.2 67.8-66.8 67.8H172.7c-29.2 0-53.4 25-53.4 54.3v101.8c0 29 25.2 46 53.4 54.3 33.8 9.9 66.3 11.7 106.8 0 26.9-7.8 53.4-23.5 53.4-54.3v-40.7H226.2v-13.6h160.2c31.1 0 42.6-21.7 53.4-54.2 11.2-33.5 10.7-65.7 0-108.6zM286.2 404c11.1 0 20.1 9.1 20.1 20.3 0 11.3-9 20.4-20.1 20.4-11 0-20.1-9.2-20.1-20.4.1-11.3 9.1-20.3 20.1-20.3zM167.8 248.1h106.8c29.7 0 53.4-24.5 53.4-54.3V91.9c0-29-24.4-50.7-53.4-55.6-35.8-5.9-74.7-5.6-106.8.1-45.2 8-53.4 24.7-53.4 55.6v40.7h106.9v13.6h-147c-31.1 0-58.3 18.7-66.8 54.2-9.8 40.7-10.2 66.1 0 108.6 7.6 31.6 25.7 54.2 56.8 54.2H101v-48.8c0-35.3 30.5-66.4 66.8-66.4zm-6.7-142.6c-11.1 0-20.1-9.1-20.1-20.3.1-11.3 9-20.4 20.1-20.4 11 0 20.1 9.2 20.1 20.4s-9 20.3-20.1 20.3z\"/></svg>","javascript":"<svg xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-label=\"javascript\" viewBox=\"0 0 448 512\" width=\"448\" height=\"512\"><title>javascript</title><path fill=\"#F7DF1E\" d=\"M0 32v448h448V32H0zm243.8 349.4c0 43.6-25.6 63.5-62.9 63.5-33.7 0-53.2-17.4-63.2-38.5l34.3-20.7c6.6 11.7 12.6 21.6 27.1 21.6 13.8 0 22.6-5.4 22.6-26.5V237.7h42.1v143.7zm99.6 63.5c-39.1 0-64.4-18.6-76.7-43l34.3-19.8c9 14.7 20.8 25.6 41.5 25.6 17.4 0 28.6-8.7 28.6-20.8 0-14.4-11.4-19.5-30.7-28l-10.5-4.5c-30.4-12.9-50.5-29.2-50.5-63.5 0-31.6 24.1-55.6 61.6-55.6 26.8 0 46 9.3 59.8 33.7L368 290c-7.2-12.9-15-18-27.1-18-12.3 0-20.1 7.8-20.1 18 0 12.6 7.8 17.7 25.9 25.6l10.5 4.5c35.8 15.3 55.9 31 55.9 66.2 0 37.8-29.8 58.6-69.7 58.6z\"/></svg>","php":"<svg xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-label=\"php\" viewBox=\"0 0 640 512\" width=\"640\" height=\"512\"><title>php</title><path fill=\"#8993be\" d=\"M320 104.5c171.4 0 303.2 72.2 303.2 151.5S491.3 407.5 320 407.5c-171.4 0-303.2-72.2-303.2-151.5S148.7 104.5 320 104.5m0-16.8C143.3 87.7 0 163 0 256s143.3 168.3 320 168.3S640 349 640 256 496.7 87.7 320 87.7zM218.2 242.5c-7.9 40.5-35.8 36.3-70.1 36.3l13.7-70.6c38 0 63.8-4.1 56.4 34.3zM97.4 350.3h36.7l8.7-44.8c41.1 0 66.6 3 90.2-19.1 26.1-24 32.9-66.7 14.3-88.1-9.7-11.2-25.3-16.7-46.5-16.7h-70.7L97.4 350.3zm185.7-213.6h36.5l-8.7 44.8c31.5 0 60.7-2.3 74.8 10.7 14.8 13.6 7.7 31-8.3 113.1h-37c15.4-79.4 18.3-86 12.7-92-5.4-5.8-17.7-4.6-47.4-4.6l-18.8 96.6h-36.5l32.7-168.6zM505 242.5c-8 41.1-36.7 36.3-70.1 36.3l13.7-70.6c38.2 0 63.8-4.1 56.4 34.3zM384.2 350.3H421l8.7-44.8c43.2 0 67.1 2.5 90.2-19.1 26.1-24 32.9-66.7 14.3-88.1-9.7-11.2-25.3-16.7-46.5-16.7H417l-32.8 168.7z\"/></svg>","code":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"64\" fill=\"none\" viewBox=\"0 0 64 64\" role=\"img\" aria-label=\"Programming tools\"><path d=\"m24 19-12 13 12 13M40 19l12 13-12 13M35 12 29 52\" stroke=\"#C993FF\" stroke-width=\"5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><circle cx=\"32\" cy=\"32\" r=\"28\" stroke=\"#8D54C9\" stroke-opacity=\".3\" stroke-width=\"2\"/></svg>","instagram":"<svg xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-label=\"instagram\" viewBox=\"0 0 448 512\" width=\"448\" height=\"512\"><title>instagram</title><path fill=\"#EB5096\" d=\"M224.1 141c-63.6 0-114.9 51.3-114.9 114.9s51.3 114.9 114.9 114.9S339 319.5 339 255.9 287.7 141 224.1 141zm0 189.6c-41.1 0-74.7-33.5-74.7-74.7s33.5-74.7 74.7-74.7 74.7 33.5 74.7 74.7-33.6 74.7-74.7 74.7zm146.4-194.3c0 14.9-12 26.8-26.8 26.8-14.9 0-26.8-12-26.8-26.8s12-26.8 26.8-26.8 26.8 12 26.8 26.8zm76.1 27.2c-1.7-35.9-9.9-67.7-36.2-93.9-26.2-26.2-58-34.4-93.9-36.2-37-2.1-147.9-2.1-184.9 0-35.8 1.7-67.6 9.9-93.9 36.1s-34.4 58-36.2 93.9c-2.1 37-2.1 147.9 0 184.9 1.7 35.9 9.9 67.7 36.2 93.9s58 34.4 93.9 36.2c37 2.1 147.9 2.1 184.9 0 35.9-1.7 67.7-9.9 93.9-36.2 26.2-26.2 34.4-58 36.2-93.9 2.1-37 2.1-147.8 0-184.8zM398.8 388c-7.8 19.6-22.9 34.7-42.6 42.6-29.5 11.7-99.5 9-132.1 9s-102.7 2.6-132.1-9c-19.6-7.8-34.7-22.9-42.6-42.6-11.7-29.5-9-99.5-9-132.1s-2.6-102.7 9-132.1c7.8-19.6 22.9-34.7 42.6-42.6 29.5-11.7 99.5-9 132.1-9s102.7-2.6 132.1 9c19.6 7.8 34.7 22.9 42.6 42.6 11.7 29.5 9 99.5 9 132.1s2.7 102.7-9 132.1z\"/></svg>","google":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 48 48\" width=\"48\" height=\"48\" role=\"img\" aria-label=\"Google\"><path fill=\"#EA4335\" d=\"M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z\"/><path fill=\"#4285F4\" d=\"M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.25 5.48-4.76 7.18l7.73 6C44.42 38.03 46.98 31.88 46.98 24.55z\"/><path fill=\"#FBBC05\" d=\"M10.53 28.59A14.46 14.46 0 0 1 9.75 24c0-1.59.27-3.13.78-4.59l-7.98-6.19A24 24 0 0 0 0 24c0 3.87.93 7.53 2.55 10.78l7.98-6.19z\"/><path fill=\"#34A853\" d=\"M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.14 1.44-4.88 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z\"/><path fill=\"none\" d=\"M0 0h48v48H0z\"/></svg>"};
export const brandIcons = Object.fromEntries(Object.entries(SVG_SOURCES).map(([name,svg])=>[name,'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)]));
export const categories=[{value:'whatsapp',name:'بوتات واتساب',icon:brandIcons.whatsapp},{value:'telegram',name:'بوتات تيليجرام',icon:brandIcons.telegram},{value:'python',name:'Python',icon:brandIcons.python},{value:'javascript',name:'JavaScript',icon:brandIcons.javascript},{value:'php',name:'PHP',icon:brandIcons.php},{value:'tools',name:'أدوات برمجية',icon:brandIcons.code}];
export const categoryName=(key)=>categories.find(x=>x.value===key)?.name||'مشروع';
export const planName=k=>({free:'مجاني',plus:'Plus',premium:'Premium',pro:'Pro'})[k]||'مجاني';
export const permit=(user,name)=>!!user&&(user.role==='owner'||(user.role==='developer'&&user.permissions?.includes(name)));
export const defaultSite={siteName:'NEXBOTS',tagline:'مجتمع البوتات والأدوات البرمجية',description:'اكتشف أفضل البوتات والأوامر والسكربتات العربية، وشارك أدواتك مع مجتمع المطورين.',supportEmail:'lllbx5ll@gmail.com',telegram:'',whatsapp:'',instagram:'',complaintsChatUrl:'',verificationChatUrl:'',logo:'',background:'',bannedWords:[],announcement:''};
export const defaultPlans={"free":{"name":"مجاني","price":0,"dailyMessages":50,"canUpload":false,"perks":["استكشاف جميع التصنيفات","البحث وفرز المشاريع","مشاهدة تفاصيل المشاريع","تحميل المشاريع المعتمدة","حساب Google مجاني","بروفايل عام قابل للمشاركة","تعديل الاسم والصورة والغلاف","المشاركة في الشات العام","50 رسالة يومياً"]},"plus":{"name":"Plus","price":3,"dailyMessages":150,"canUpload":true,"perks":["جميع مميزات الحساب المجاني","رفع مشاريع البوتات والسكربتات","إرفاق ملفات حتى 3MB","إضافة صور وعناوين ووسوم","إضافة روابط تنزيل خارجية","متابعة حالة مراجعة المشاريع","مشاركة روابط المشاريع","لوحة لمشاريعك المرفوعة","150 رسالة يومياً"]},"premium":{"name":"Premium","price":6,"dailyMessages":400,"canUpload":true,"perks":["جميع مميزات Plus","رفع ومشاركة المشاريع بعد مراجعتها","إضافة وصف وطريقة استخدام مفصلة","صور مشاريع بصيغ PNG / JPG / WebP","مشاركة ملفك الشخصي","عرض عدد تحميلات المشاريع","استخدام التصنيفات والبحث المتقدم","متابعة قبول أو رفض المشاريع","400 رسالة يومياً"]},"pro":{"name":"Pro","price":10,"dailyMessages":1000,"canUpload":true,"perks":["جميع مميزات Premium","رفع مشاريع واتساب وتيليجرام","نشر أدوات Python وJavaScript وPHP","إضافة ملفات أو روابط خارجية","إدارة مشاريعك من حسابك","مشاريع قابلة للمشاركة والتحميل","استخدام كل مجالات المجتمع","حصة الشات الأعلى بين الباقات","1000 رسالة يومياً"]}};
export const asset=(s)=>s?.startsWith('profiles/')?null:s;
