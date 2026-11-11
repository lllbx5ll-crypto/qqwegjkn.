// Mobile-friendly, bounded 1MiB story video chunks. PROJECT uploads are untouched.
import {getDoc} from './firestore.js';
import {activePlan} from './constants.js';
const fail=(error,status=400)=>new Response(JSON.stringify({error}),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const done=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const MiB=1024*1024,MAX=12*MiB;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function handleStoryChunks(request,env,path,method,identityUser){
 const route=path[0];
 if(!['stage-story-chunk','stage-story-complete'].includes(route))return null;
 const submissionId=path[1];
 if(!uuid.test(submissionId))return fail('رقم الستوري غير صحيح');
 const {user}=await identityUser(request,env);
 if(user.role!=='owner'&&activePlan(user)==='free')return fail('الستوري للمشتركين فقط',403);
 const published=await getDoc(env,'stories',submissionId);
 if(published){return published.ownerUid===user.uid?done({received:true,alreadyReceived:true}):fail('هذه القصة ليست لك',403);}
 const mediaKey=`stories/${submissionId}/media`;
 if(route==='stage-story-chunk'&&path.length===3){
  const index=Number(path[2]);
  if(!Number.isSafeInteger(index)||index<0||index>=12)return fail('رقم جزء الفيديو غير صالح');
  const key=`stories/${submissionId}/chunks/${index}`;
  if(method==='GET'){
   const meta=await env.FILES.head(key);
   return done({received:!!meta&&meta.customMetadata?.uploadUid===user.uid,size:meta?.customMetadata?.uploadUid===user.uid?meta.size:0});
  }
  if(method!=='POST')return fail('الطريقة غير مدعومة',405);
  const total=Number(request.headers.get('x-file-total-size')),
        parts=Number(request.headers.get('x-total-parts')),
        size=Number(request.headers.get('x-file-size'));
  if(!Number.isSafeInteger(total)||total<=0||total>MAX||parts!==Math.ceil(total/MiB)||index>=parts||!Number.isSafeInteger(size)||size!==Math.min(MiB,total-index*MiB))return fail('حجم الفيديو أو جزئه غير صحيح',413);
  if(!request.body)return fail('لم يصل جزء الفيديو');
  const bytes=new Uint8Array(size),reader=request.body.getReader();let seen=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;if(seen+value.byteLength>size)return fail('جزء الفيديو أكبر من المعلن',413);bytes.set(value,seen);seen+=value.byteLength;}}finally{reader.releaseLock();}
  if(seen!==size)return fail('الجزء لم يصل كاملاً؛ أعد المحاولة');
  await env.FILES.put(key,bytes,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{uploadUid:user.uid,submissionId,total:String(total),parts:String(parts),index:String(index),storedAt:new Date().toISOString()}});
  return done({received:true,size:seen,index},201);
 }
 if(route==='stage-story-complete'&&path.length===2&&method==='POST'){
  const body=await request.json().catch(()=>null),total=Number(body?.size);
  if(!Number.isSafeInteger(total)||total<=0||total>MAX)return fail('حجم الفيديو غير صالح');
  const parts=Math.ceil(total/MiB);
  const saved=await env.FILES.head(mediaKey);
  if(saved&&saved.customMetadata?.uploadUid===user.uid&&saved.customMetadata?.storyType==='video'&&saved.size===total)return done({received:true,size:total,recovered:true});
  if(saved)return fail('يوجد ملف مختلف لهذه القصة، ابدأ ستوري جديدة',409);
  const bytes=new Uint8Array(total);let offset=0;
  for(let i=0;i<parts;i++){
   const key=`stories/${submissionId}/chunks/${i}`,obj=await env.FILES.get(key),expected=Math.min(MiB,total-i*MiB);
   if(!obj||obj.size!==expected||obj.customMetadata?.uploadUid!==user.uid||obj.customMetadata?.submissionId!==submissionId||Number(obj.customMetadata?.total)!==total||Number(obj.customMetadata?.parts)!==parts)
     return fail(`الجزء ${i+1} من الفيديو لم يكتمل. أعد المحاولة`,409);
   const segment=new Uint8Array(await obj.arrayBuffer());
   if(segment.byteLength!==expected)return fail(`الجزء ${i+1} غير مكتمل`,409);
   bytes.set(segment,offset);offset+=segment.byteLength;
  }
  const result=await env.FILES.put(mediaKey,bytes,{httpMetadata:{contentType:'video/mp4'},customMetadata:{uploadUid:user.uid,submissionId,originalName:'video.mp4',storyType:'video',uploadedAt:new Date().toISOString()}});
  if(!result||result.size!==total)return fail('لم يتم تأكيد تجميع الفيديو في التخزين',503);
  // Failed cleanup is harmless; the canonical media object is already committed.
  await Promise.all(Array.from({length:parts},(_,i)=>env.FILES.delete(`stories/${submissionId}/chunks/${i}`).catch(()=>{})));
  return done({received:true,size:total});
 }
 return fail('مسار فيديو الستوري غير موجود',404);
}
