import {isNativeAndroid} from './native-android.js';
/** DownloadManager fetches the authorized project endpoint, saves to Downloads and reports progress. */
export function nativeProjectDownload(projectId, filename, idToken, onProgress=()=>{}) {
 if(!isNativeAndroid())return null;
 if(!/^[\w-]{1,128}$/.test(projectId))throw Error('معرف المشروع غير صالح');
 const requestId=crypto.randomUUID();
 const url=`${window.location.origin}/api/download/${projectId}`;
 const promise=new Promise((resolve,reject)=>{
  let finished=false;
  const end=(error)=>{
   if(finished)return;finished=true;window.removeEventListener('nexbots-native-download',onEvent);
   if(error)reject(new Error(error));else resolve({requestId});
  };
  const onEvent=e=>{
   const m=e?.detail||{};
   if(m.requestId!==requestId)return;
   if(m.state==='progress')onProgress(Math.max(0,Math.min(100,Number(m.progress)||0)));
   else if(m.state==='done'){onProgress(100);end();}
   else if(m.state==='error')end(m.error||'فشل تحميل المشروع');
  };
  window.addEventListener('nexbots-native-download',onEvent);
  try{
   window.NexbotsAndroid.postMessage(JSON.stringify({action:'downloadProject',requestId,url,filename:filename||'nexbots-project.zip',idToken}));
  }catch{end('تعذر تشغيل التنزيل داخل التطبيق');}
 });
 return promise;
}
export function openNativeDownload(requestId){
 if(!isNativeAndroid()||!requestId)return false;
 window.NexbotsAndroid.postMessage(JSON.stringify({action:'openDownload',requestId}));return true;
}
