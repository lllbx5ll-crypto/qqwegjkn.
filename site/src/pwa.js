// Registers the same-origin offline shell in browsers with Service Workers.
// No forced reload while a user is typing or uploading; updates apply on next opening.
if(typeof window!=='undefined'&&'serviceWorker' in navigator){
 window.addEventListener('load',()=>{
  navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'})
   .then(reg=>{
    window.addEventListener('online',()=>reg.update().catch(()=>{}));
    document.addEventListener('visibilitychange',()=>{
     if(document.visibilityState==='visible' && navigator.onLine)reg.update().catch(()=>{});
    });
   }).catch(error=>console.warn('NEXBOTS PWA unavailable:',error));
 });
}
