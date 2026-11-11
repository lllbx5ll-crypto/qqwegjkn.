/**
 * NEXBOTS automated story cleanup; runs every 15 minutes via Cron Triggers.
 * Uses Firestore Security Rules to read/delete EXPIRED records only, so there
 * are no Firebase admin keys, OAuth user passwords, or elevated credentials.
 * R2 binding deletes media first; Firestore records second. Errors leave items
 * for the next scheduled attempt. Never touch projects/ or profiles/ objects.
 */
const root=env=>`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const getURL=(env,path)=>`${root(env)}${path}?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function expired(env,col){
  const url=`${root(env)}:runQuery?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`;
  const body={structuredQuery:{from:[{collectionId:col}],where:{fieldFilter:{field:{fieldPath:'expiresAt'},op:'LESS_THAN_OR_EQUAL',value:{timestampValue:new Date(Date.now()-10000).toISOString()}}},limit:90}};
  const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)throw Error(`Firestore cleanup query ${col}: ${response.status} ${await response.text()}`);
  const list=await response.json();return (Array.isArray(list)?list:[]).filter(x=>x.document).map(x=>x.document);
}
async function remove(env,doc){
  const name=doc.name;
  if(!name?.startsWith(`projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/`))throw Error('Bad document path');
  // Delete media before deleting its DB pointer; never delete objects in other prefixes.
  const field=doc.fields?.mediaKey?.stringValue;
  if(field&&field.startsWith('stories/')&&field.endsWith('/media')){
    await env.FILES.delete(field);
  }
  const url=`https://firestore.googleapis.com/v1/${name}?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`;
  const response=await fetch(url,{method:'DELETE'});
  if(!response.ok&&response.status!==404)throw Error(`${name}: ${response.status} ${await response.text()}`);
}
export async function cleanupExpired(env){
 let successes=0,failures=0;
 for(const col of ['storyViews','storyLikes','stories']){
   for(let batch=0;batch<2;batch++){
     const docs=await expired(env,col);if(!docs.length)break;
     // Throttle concurrency to avoid accidental free-tier request bursts.
     for(let n=0;n<docs.length;n+=10){
       const result=await Promise.allSettled(docs.slice(n,n+10).map(d=>remove(env,d)));
       successes+=result.filter(r=>r.status==='fulfilled').length;
       for(const item of result.filter(r=>r.status==='rejected')){failures++;console.error('NEXBOTS cleanup',item.reason);}
     }
     if(docs.length<90)break;
   }
 }
 return {successes,failures};
}
export default {
 async scheduled(event,env,ctx){ctx.waitUntil(cleanupExpired(env).then(report=>console.log('NEXBOTS story cleanup',report)));},
};
