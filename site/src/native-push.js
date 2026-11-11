import {auth,api,onAuthStateChanged} from './lib.js';
import {isNativeAndroid} from './native-android.js';
// Device-bound registration: never register to a Firebase UID based only on JS input.
// The Cloudflare API verifies the logged-in user's Firebase ID token on every call.
let device=null,previousUid='',previousDevice='',timer=null;
function sendBind(){
 if(!isNativeAndroid()||!device||!auth.currentUser)return;
 const uid=auth.currentUser.uid;
 if(previousUid===uid&&previousDevice===device.deviceId)return;
 if(timer)clearTimeout(timer);
 timer=setTimeout(async()=>{
  try{
   if(previousUid&&previousUid!==uid)await api('push/unregister',{method:'POST',body:{deviceId:device.deviceId}}).catch(()=>{});
   await api('push/register',{method:'POST',body:device});
   previousUid=uid;previousDevice=device.deviceId;
  }catch(err){console.warn('NEXBOTS Android notifications are not configured yet',err?.message);}
 },750);
}
if(typeof window!=='undefined'){
 window.nexbotsUnregisterPush=async()=>{
  if(device && previousUid && auth.currentUser?.uid===previousUid){
   try{await api('push/unregister',{method:'POST',body:{deviceId:device.deviceId}});}catch(err){console.warn('Unable to unregister Android push',err?.message);}
  }
  previousUid='';previousDevice='';
 };
 // Ask native side again after the web script has started listening for events.
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{try{if(isNativeAndroid())window.NexbotsAndroid.postMessage(JSON.stringify({action:'requestPushToken'}));}catch{}},{once:true});
 else queueMicrotask(()=>{try{if(isNativeAndroid())window.NexbotsAndroid.postMessage(JSON.stringify({action:'requestPushToken'}));}catch{}});
 window.addEventListener('nexbots-native-push-token',ev=>{
  const data=ev.detail;
  if(typeof data?.token!=='string'||typeof data?.deviceId!=='string')return;
  device={token:data.token,deviceId:data.deviceId};previousDevice='';sendBind();
 });
 onAuthStateChanged(auth,async user=>{
  if(!user){
   const oldUid=previousUid;previousUid='';previousDevice='';
   // Unregister must be requested by the sign-out caller while still authenticated;
   // without it KV tokens expire automatically and carry only generic message previews.
   if(oldUid)console.info('NEXBOTS push token will be rebound on next sign-in');
  }else sendBind();
 });
 window.addEventListener('focus',()=>{
  try{if(isNativeAndroid())window.NexbotsAndroid.postMessage(JSON.stringify({action:'requestPushToken'}));}catch{}
 });
}
