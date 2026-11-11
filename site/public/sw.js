/* NEXBOTS offline shell: no private/API auth data is cached.
 * This file must be hosted at the SAME origin as the NEXBOTS web app.
 * Works in browsers/PWAs with Service Worker support; converters vary. */
const BUILD='nexbots-pwa-v3';
const SHELL=BUILD+'-shell';
const PUBLIC=BUILD+'-public';
const ASSETS=BUILD+'-assets';
const PRECACHE=['/','/offline.html','/nexbots-logo.png','/nexbots-logo.webp'];
const MAX_ASSETS=120;
self.addEventListener('install', event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(SHELL);
  await Promise.all(PRECACHE.map(async url=>{
   try { const res=await fetch(url,{cache:'reload'}); if(res.ok)await cache.put(url,res); } catch{}
  }));
  await self.skipWaiting();
 })());
});
self.addEventListener('activate', event=>{
 event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith('nexbots-pwa-') && ![SHELL,PUBLIC,ASSETS].includes(name)).map(name=>caches.delete(name)));
  await self.clients.claim();
 })());
});
function sameOrigin(url){return url.origin===self.location.origin;}
function publicData(url,request){
 // Server returns the SAME anonymous public data for these two URLs.
 // Other API endpoints are deliberately excluded, especially private threads,
 // user records, invoices, admin data, and user-uploaded media.
 return !request.headers.has('authorization') && ['/api/public','/api/projects'].includes(url.pathname) && !url.search;
}
async function prune(cache,limit){
 const keys=await cache.keys();
 if(keys.length>limit) await Promise.all(keys.slice(0,keys.length-limit).map(k=>cache.delete(k)));
}
async function networkFirst(request,cacheName,{navigation=false}={}){
 const cache=await caches.open(cacheName);
 try{
  const ctrl=new AbortController(); const timeout=setTimeout(()=>ctrl.abort(),6000);
  let response;
  try{response=await fetch(request,{signal:ctrl.signal});}finally{clearTimeout(timeout);}
  if(response.ok){
   // Only keep real successful responses. Never cache errors or redirects to signin.
   await cache.put(request,response.clone());
   return response;
  }
  const last=await cache.match(request);
  return last || response;
 }catch{
  const last=await cache.match(request);
  if(last)return last;
  if(navigation){
   const home=await cache.match('/');
   if(home)return home;
   return (await caches.match('/offline.html'))||Response.error();
  }
  return new Response(JSON.stringify({error:'أنت غير متصل بالإنترنت، ولا توجد نسخة محفوظة من هذه البيانات.'}),{status:503,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
 }
}
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(!sameOrigin(url))return;
 if(req.mode==='navigate'){
  event.respondWith(networkFirst(req,SHELL,{navigation:true}));return;
 }
 if(url.pathname.startsWith('/api/')){
  if(publicData(url,req))event.respondWith(networkFirst(req,PUBLIC));
  return;
 }
 if(url.pathname.startsWith('/assets/') || /\.(?:js|css|woff2?)$/i.test(url.pathname)){
  event.respondWith((async()=>{
   const cache=await caches.open(ASSETS),stored=await cache.match(req);
   if(stored)return stored;
   const fresh=await fetch(req);
   if(fresh.ok){await cache.put(req,fresh.clone());event.waitUntil(prune(cache,MAX_ASSETS));}
   return fresh;
  })());return;
 }
 if(['/nexbots-logo.webp','/nexbots-logo.png','/manifest.webmanifest'].includes(url.pathname)){
  event.respondWith((async()=>{
   const found=await caches.match(req);if(found)return found;
   const fresh=await fetch(req);if(fresh.ok)await (await caches.open(SHELL)).put(req,fresh.clone());return fresh;
  })());
 }
});
