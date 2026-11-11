/* NEXBOTS community features. No service account secrets: every Firestore
   operation uses the caller's Firebase ID token and must pass security rules. */
import {getDoc,setDoc,removeDoc,queryDocs,listDocs,commit,updateWrite,deleteWrite,cleanForWrite} from './firestore.js';
import {activePlan,cleanText} from './constants.js';
import {imageTypeOrThrow} from './media-validation.js';

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const bad=(reason,status=400)=>json({error:reason},status);
const iso=()=>new Date().toISOString();
const newId=()=>crypto.randomUUID();
const goodId=x=>typeof x==='string'&&/^[\w-]{1,128}$/.test(x);
const short=s=>cleanText(s,600);
const readJson=async r=>{const x=await r.json().catch(()=>null);if(!x||typeof x!=='object'||Array.isArray(x))throw Error('بيانات غير صحيحة');return x;};
const conflict=[400,409,412];
const cleanDoc=d=>{if(!d)return d;const {id,_updateTime,...fields}=d;return fields;};
const allowedHandle=s=>/^[a-z0-9_]{3,24}$/.test(s);
const blockId=(a,b)=>`${a}_${b}`;
async function checkUnblocked(env,a,b){
  if(a===b)throw Error('لا يمكن مراسلة حسابك');
  const [ab,ba]=await Promise.all([getDoc(env,'userBlocks',blockId(a,b)),getDoc(env,'userBlocks',blockId(b,a))]);
  if(ab||ba)throw Object.assign(new Error('المراسلة غير متاحة بسبب الحظر بين الحسابين'),{status:403});
}
async function threadIdFor(a,b){const parts=[a,b].sort();const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(parts.join(':')));return [...new Uint8Array(h)].slice(0,20).map(n=>n.toString(16).padStart(2,'0')).join('');}
const userPublic=u=>({uid:u.uid,displayName:u.displayName,avatar:u.avatar||'',username:u.username||'',verified:!!u.verified||u.role==='owner',badgeType:u.badgeType||'auto',activePlan:activePlan(u)});
async function verifyThread(env,tid,uid){if(!goodId(tid))throw Error('معرّف محادثة غير صالح');const thread=await getDoc(env,'dmThreads',tid);if(!thread||!thread.members?.includes(uid))throw Object.assign(new Error('المحادثة غير موجودة'),{status:404});const recipient=thread.members.find(x=>x!==uid);return {thread,recipient};}

// Conservative MP4 mvhd parser: only accept files whose actual container declares
// a movie duration of 0 < duration <= 15 seconds. We do not trust browser duration.
export function mp4DurationSeconds(bytes){
 const b=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let cursor=0,seenFtyp=false;
 while(cursor+8<=bytes.length){
  let size=b.getUint32(cursor),type=String.fromCharCode(...bytes.subarray(cursor+4,cursor+8));
  if(size===1){if(cursor+16>bytes.length)return null;const hi=b.getUint32(cursor+8),lo=b.getUint32(cursor+12);if(hi!==0)return null;size=lo;}
  if(size<8||cursor+size>bytes.length)return null;
  if(type==='ftyp')seenFtyp=true;
  if(type==='moov'){
   let pos=cursor+8,end=cursor+size;
   while(pos+8<=end){
    const sz=b.getUint32(pos),typ=String.fromCharCode(...bytes.subarray(pos+4,pos+8));
    if(sz<8||pos+sz>end)return null;
    if(typ==='mvhd'){
     if(!seenFtyp||sz<32)return null;
     const v=b.getUint8(pos+8),base=pos+(v===1?28:20);
     if(base+8>pos+sz)return null;
     const rate=b.getUint32(base);if(!rate)return null;
     let duration;
     if(v===1){if(base+8>pos+sz)return null;duration=b.getBigUint64(base+4);if(duration>BigInt(Number.MAX_SAFE_INTEGER))return null;duration=Number(duration);}
     else duration=b.getUint32(base+4);
     const seconds=duration/rate;
     return Number.isFinite(seconds)&&seconds>0?seconds:null;
    }
    pos+=sz;
   }
  }
  cursor+=size;
 }
 return null;
}

export async function handleFeatures(request,env,path,method,helpers){
 const route=path[0]||'';
 if(!['username','directory','private','dm','blocks','reports','stories','story-media'].includes(route))return null;
 const {identityUser,need,isOwner}=helpers;
 const {user}=await identityUser(request,env);

 if(route==='username'&&method==='POST'){
  const data=await readJson(request),name=String(data.username||'').replace(/^@/,'').trim().toLowerCase();
  if(!allowedHandle(name))return bad('اسم المستخدم: 3 إلى 24 حرفاً إنجليزياً صغيراً أو رقماً أو _');
  if(user.username===name)return json({username:name});
  for(let n=0;n<4;n++){
   const old=await getDoc(env,'users',user.uid);
   const existing=await getDoc(env,'usernames',name);
   if(existing&&existing.uid!==user.uid)return bad('اسم المستخدم محجوز',409);
   const writes=[updateWrite(env,'users',user.uid,{...cleanDoc(old),username:name,updatedAt:iso()},{updateTime:old._updateTime})];
   if(!existing)writes.push(updateWrite(env,'usernames',name,{uid:user.uid,handle:name,createdAt:iso()},{exists:false}));
   if(old.username&&old.username!==name)writes.push(deleteWrite(env,'usernames',old.username));
   try{await commit(env,writes);return json({username:name});}catch(e){if(!conflict.includes(e.status)||n===3)throw e;}
  }
 }
 if(route==='directory'&&method==='GET'){
  const name=String(new URL(request.url).searchParams.get('q')||'').replace(/^@/,'').trim().toLowerCase();
  if(name.length<3)return json([]);
  // Exact handles are O(1), avoiding public enumeration of private email data.
  if(!allowedHandle(name))return json([]);
  const record=await getDoc(env,'usernames',name);
  if(!record)return json([]);
  const profile=await getDoc(env,'users',record.uid);
  return json(profile?[userPublic(profile)]:[]);
 }
 if(route==='blocks'&&goodId(path[1])){
  const other=path[1];if(other===user.uid)return bad('لا تستطيع حظر نفسك');
  const key=blockId(user.uid,other);
  if(method==='GET')return json({blocked:!!await getDoc(env,'userBlocks',key)});
  if(method==='POST'){
   if(!await getDoc(env,'users',other))return bad('العضو غير موجود',404);
   if(!await getDoc(env,'userBlocks',key))try{await commit(env,[updateWrite(env,'userBlocks',key,{actorUid:user.uid,targetUid:other,createdAt:iso()},{exists:false})]);}catch(e){if(!conflict.includes(e.status))throw e;}
   return json({blocked:true});
  }
  if(method==='DELETE'){if(await getDoc(env,'userBlocks',key))await removeDoc(env,'userBlocks',key);return json({blocked:false});}
 }
 if(route==='reports'&&method==='POST'){
  const body=await readJson(request),targetUid=String(body.targetUid||''),reason=cleanText(body.reason,400);
  if(!goodId(targetUid)||targetUid===user.uid||reason.length<10)return bad('حدد العضو وسبب البلاغ بوضوح (10 أحرف على الأقل)');
  const target=await getDoc(env,'users',targetUid);if(!target)return bad('العضو غير موجود',404);
  const rid=newId();await commit(env,[updateWrite(env,'reports',rid,{reporterUid:user.uid,reporterName:user.displayName,targetUid,targetName:target.displayName,reason,status:'open',createdAt:iso()},{exists:false})]);
  return json({ok:true},201);
 }
 if(route==='reports'&&method==='GET'){
  need(user,'manageUsers');return json((await listDocs(env,'reports',200)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))));
 }
 if(route==='reports'&&goodId(path[1])&&method==='PATCH'){
  need(user,'manageUsers');const report=await getDoc(env,'reports',path[1]);if(!report)return bad('البلاغ غير موجود',404);
  const body=await readJson(request);if(!['open','resolved','dismissed'].includes(body.status))return bad('حالة غير معروفة');
  await setDoc(env,'reports',path[1],{...cleanDoc(report),status:body.status,reviewerUid:user.uid,reviewedAt:iso()});return json({ok:true});
 }
 if(route==='private'){
  // A dedicated conversation page must resolve a verified thread from the server,
  // never rely on stale/incomplete records from the directory screen.
  if(path[1]==='threads'&&goodId(path[2])&&path.length===3&&method==='GET'){
   const {thread,recipient}=await verifyThread(env,path[2],user.uid);
   const profile=await getDoc(env,'users',recipient);
   return json({...cleanDoc(thread),id:thread.id,other:profile?userPublic(profile):{uid:recipient,displayName:'عضو سابق',avatar:'',username:''}});
  }
  if(path[1]==='threads'&&method==='GET'&&path.length===2){
   const all=await import('./firestore.js').then(x=>x.queryDocsOp(env,'dmThreads','members','ARRAY_CONTAINS',user.uid,100));
   const data=all.sort((a,b)=>String(b.lastMessageAt||b.createdAt).localeCompare(String(a.lastMessageAt||a.createdAt)));
   const visible=[];
   for(const t of data){
    if(!goodId(t.id)||!Array.isArray(t.members)||!t.members.includes(user.uid)||t.members.length!==2)continue;
    const other=t.members.find(x=>x!==user.uid);if(!goodId(other))continue;
    const partner=await getDoc(env,'users',other);
    visible.push({...t,other:partner?userPublic(partner):{uid:other,displayName:'عضو سابق',avatar:'',username:''}});
   }
   return json(visible);
  }
  if(path[1]==='threads'&&path.length===2&&method==='POST'){
   const body=await readJson(request);
   let targetUid=String(body.targetUid||'').trim();
   // Accept a username as an alternative to a Firebase UID, without exposing emails.
   if(targetUid.startsWith('@')){
    const username=targetUid.slice(1).toLowerCase();
    if(!allowedHandle(username))return bad('اسم المستخدم غير صحيح');
    const record=await getDoc(env,'usernames',username);
    if(!record)return bad('اسم المستخدم غير موجود',404);
    targetUid=record.uid;
   }
   if(!goodId(targetUid))return bad('تعذّر تحديد الحساب المقصود؛ ابحث عنه مجدداً',400);
   if(targetUid===user.uid)return bad('لا يمكنك مراسلة نفسك',400);
   const other=await getDoc(env,'users',targetUid);if(!other)return bad('العضو غير موجود',404);
   await checkUnblocked(env,user.uid,targetUid);
   const tid=await threadIdFor(user.uid,targetUid);
   // A nonexistent thread has no members, so Firestore rules cannot authorize
   // reading it first. Create atomically, then reuse the existing one on conflict.
   try{
     await commit(env,[updateWrite(env,'dmThreads',tid,{members:[user.uid,targetUid].sort(),createdBy:user.uid,createdAt:iso(),lastText:'',lastMessageAt:iso(),lastMessageId:'',unreadCounts:{[user.uid]:0,[targetUid]:0}},{exists:false})]);
   }catch(e){
     if(!conflict.includes(e.status))throw e;
     const existing=await getDoc(env,'dmThreads',tid);
     if(!existing?.members?.includes(user.uid)||!existing.members.includes(targetUid))throw e;
   }
   return json({id:tid,other:userPublic(other)});
  }
  if(path[1]==='threads'&&goodId(path[2])&&path[3]==='messages'){
   const {thread,recipient}=await verifyThread(env,path[2],user.uid);
   if(method==='GET'){
    const entries=await queryDocs(env,'dmMessages','threadId',thread.id,120);
    return json(entries.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))));
   }
   if(method==='POST'){
    await checkUnblocked(env,user.uid,recipient);
    const body=await readJson(request),text=short(body.text);if(!text)return bad('اكتب رسالتك');
    const friend=await getDoc(env,'users',recipient);if(!friend)return bad('العضو غير موجود',404);
    // Reuse the daily messages quota (public chat + private messages combined).
    const pricing=helpers.plans?await helpers.plans(env):null;
    const plan=activePlan(user);const limit=user.role==='owner'?100000:plan==='free'?50:(pricing?.[plan]?.dailyMessages||150);
    const day=Math.floor(Date.now()/86400000),qid=`${user.uid}_${day}`;
    for(let i=0;i<5;i++){
     const quota=await getDoc(env,'quotas',qid),t=await getDoc(env,'dmThreads',thread.id);if(!t)return bad('المحادثة غير موجودة',404);
     if((quota?.count||0)>=limit)return bad('انتهت حصة الرسائل اليومية',429);
     const mid=newId(),now=iso(),nextCount=(quota?.count||0)+1;
     const msg={threadId:thread.id,uid:user.uid,recipientUid:recipient,text,createdAt:now,readAt:null,quotaId:qid,quotaCount:nextCount};
     // Per-recipient counter lives in the thread document; no expensive scan
     // of every message is needed to paint an unread badge in the chat list.
     const oldCounts=t.unreadCounts&&typeof t.unreadCounts==='object'?t.unreadCounts:{};
     const nextCounts={[user.uid]:Math.max(0,Number(oldCounts[user.uid]||0)),[recipient]:Math.max(0,Number(oldCounts[recipient]||0))+1};
     const nextThread={...cleanDoc(t),lastText:text.slice(0,100),lastMessageAt:now,lastMessageId:mid,unreadCounts:nextCounts};
     const nextQuota={uid:user.uid,day,count:nextCount,updatedAt:now,lastMessageId:mid};
     try{await commit(env,[updateWrite(env,'dmMessages',mid,msg,{exists:false}),updateWrite(env,'quotas',qid,nextQuota,quota?{updateTime:quota._updateTime}:{exists:false}),updateWrite(env,'dmThreads',thread.id,nextThread,{updateTime:t._updateTime})]);helpers.notifyPrivate?.(recipient,user.displayName,thread.id);return json({id:mid,...msg},201);}
     catch(e){if(!conflict.includes(e.status)||i===4)throw e;}
    }
   }
  }
  if(path[1]==='threads'&&goodId(path[2])&&path[3]==='read'&&method==='POST'){
   const {thread}=await verifyThread(env,path[2],user.uid);
   const entries=await queryDocs(env,'dmMessages','threadId',thread.id,120);
   const unread=entries.filter(x=>x.recipientUid===user.uid&&!x.readAt).slice(0,30);
   if(unread.length){
     const now=iso();
     const {patchFields}=await import('./firestore.js');
     await Promise.all(unread.map(x=>patchFields(env,'dmMessages',x.id,{readAt:now})));
   }
   // A compare-and-swap prevents wiping out a new unread message that
   // arrived at the same instant this viewer opened the conversation.
   for(let attempt=0;attempt<4;attempt++){
     const fresh=await getDoc(env,'dmThreads',thread.id);if(!fresh)break;
     const previous=fresh.unreadCounts&&typeof fresh.unreadCounts==='object'?fresh.unreadCounts:{};
     const current=Math.max(0,Number(previous[user.uid]||0));
     if(!current)break;
     const other=fresh.members.find(uid=>uid!==user.uid);
     const unreadCounts={
       [user.uid]:Math.max(0,current-unread.length),
       [other]:Math.max(0,Number(previous[other]||0))
     };
     if(current===unreadCounts[user.uid])break;
     try{
       await commit(env,[updateWrite(env,'dmThreads',thread.id,{...cleanDoc(fresh),unreadCounts},{updateTime:fresh._updateTime})]);
       break;
     }catch(e){if(!conflict.includes(e.status)||attempt===3)throw e;}
   }
   return json({read:unread.length});
  }
 }
 if(route==='stories'){
  if(method==='GET'&&path.length===1){
   const data=(await import('./firestore.js').then(f=>f.queryDocsOp(env,'stories','expiresAt','GREATER_THAN',new Date(Date.now()+10000),100))).filter(x=>Date.parse(x.expiresAt)>Date.now());
   const own=data.filter(x=>x.ownerUid===user.uid).map(x=>x.id);
   const views=own.length?await queryDocs(env,'storyViews','ownerUid',user.uid,500):[];
   const likes=own.length?await queryDocs(env,'storyLikes','ownerUid',user.uid,500):[];
   const out=await Promise.all(data.map(async story=>{
    const liked=await getDoc(env,'storyLikes',blockId(user.uid,story.id));
    const profile=await getDoc(env,'users',story.ownerUid);
    return {...story,owner:profile?userPublic(profile):{uid:story.ownerUid,displayName:'عضو'},viewerLiked:!!liked,viewsCount:story.ownerUid===user.uid?views.filter(v=>v.storyId===story.id).length:null,likesCount:story.ownerUid===user.uid?likes.filter(v=>v.storyId===story.id).length:null};
   }));return json(out.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))));
  }
  if(method==='POST'&&path.length===1){
   if(user.role!=='owner'&&activePlan(user)==='free')return bad('نشر الستوري متاح للمشتركين فقط',403);
   const form=await request.formData(),kind=String(form.get('type')||'text'),text=cleanText(form.get('text'),600);
   if(!['text','image','video'].includes(kind))return bad('نوع الستوري غير مدعوم');
   const staged=String(form.get('stagedAssets')||'')==='1';
   const file=staged?null:form.get('file');if(kind==='text'&&!text)return bad('اكتب نص الستوري');
   if(kind!=='text'&&!staged&&(!file||typeof file.arrayBuffer!=='function'||!file.size))return bad('اختر صورة أو فيديو');
   let data=null,mime='',key='';
   const requestedId=String(form.get('submissionId')||'');
   const storyId=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestedId)?requestedId:newId();
   if(requestedId){
     const previous=await getDoc(env,'stories',storyId).catch(e=>[403,404].includes(e.status)?null:Promise.reject(e));
     if(previous){if(previous.ownerUid!==user.uid)return bad('معرّف القصة مستخدم',409);return json({id:storyId,...previous,alreadyReceived:true},200);}
   }
   const activeOwn=(await import('./firestore.js').then(f=>f.queryDocsOp(env,'stories','ownerUid','EQUAL',user.uid,20))).filter(s=>Date.parse(s.expiresAt)>Date.now());
   if(activeOwn.length>=5)return bad('يمكن نشر خمس ستوريات نشطة فقط؛ احذف واحدة أو انتظر انتهاء مدتها',429);
   if(staged&&kind!=='text'){
    key=`stories/${storyId}/media`;
    const item=await env.FILES.head(key);
    const max=kind==='video'?12*1024*1024:2*1024*1024;
    if(!item||item.size<=0||item.size>max||item.customMetadata?.uploadUid!==user.uid||item.customMetadata?.submissionId!==storyId||item.customMetadata?.storyType!==kind)
      return bad('لم يكتمل رفع الوسائط؛ أعد إرسال الصورة أو الفيديو من نفس النافذة');
    if(kind==='video'){
      // Browser metadata can fail on Android; inspect the actual MP4 on the server.
      const object=await env.FILES.get(key);
      const bytes=new Uint8Array(await object.arrayBuffer());
      const duration=mp4DurationSeconds(bytes);
      if(duration===null){await env.FILES.delete(key).catch(()=>{});return bad('تعذر قراءة مدة MP4 من الملف نفسه. جرّب تحويله إلى MP4 H.264/AAC ثم أعد رفعه');}
      if(duration>15){await env.FILES.delete(key).catch(()=>{});return bad('مدة فيديو الستوري لا تتجاوز 15 ثانية');}
      mime='video/mp4';
    }else{
      const object=await env.FILES.get(key,{range:{offset:0,length:32}});
      mime=imageTypeOrThrow(new Uint8Array(await object.arrayBuffer()));
    }
   }else{
    if(kind==='image'){
      if(file.size>2*1024*1024)return bad('صورة الستوري تتجاوز 2MB');
      data=new Uint8Array(await file.arrayBuffer());mime=imageTypeOrThrow(data);
    }
    if(kind==='video'){
      if((file.type!=='video/mp4'&&!/\.mp4$/i.test(file.name))||file.size>12*1024*1024)return bad('فيديو الستوري بصيغة MP4 فقط وبحجم لا يتجاوز 12MB');
      data=new Uint8Array(await file.arrayBuffer());const length=mp4DurationSeconds(data);
      if(length===null||length>15)return bad('الفيديو يجب أن يكون MP4 صالحاً ومدته لا تتجاوز 15 ثانية');mime='video/mp4';
    }
    if(data){key=`stories/${storyId}/media`;await env.FILES.put(key,data,{httpMetadata:{contentType:mime}});}
   }
   const now=Date.now(),expiresAt=new Date(now+86400000);
   const entry={ownerUid:user.uid,type:kind,text,mediaKey:key,mime,createdAt:new Date(now).toISOString(),expiresAt};
   try{await commit(env,[updateWrite(env,'stories',storyId,entry,{exists:false})]);}catch(error){
     const previous=await getDoc(env,'stories',storyId).catch(()=>null);
     if(previous?.ownerUid===user.uid)return json({id:storyId,...previous,alreadyReceived:true});
     if(key&&!staged)await env.FILES.delete(key).catch(()=>{});
     throw error;
   }
   return json({id:storyId,...entry,expiresAt:expiresAt.toISOString()},201);
  }
  if(goodId(path[1])&&method==='DELETE'&&path.length===2){
   const story=await getDoc(env,'stories',path[1]);if(!story)return bad('الستوري غير موجودة',404);
   if(story.ownerUid!==user.uid&&user.role!=='owner')return bad('لا تملك إذن الحذف',403);
   // Never mark a story as permanently removed while its R2 media still exists.
   if(story.mediaKey)await env.FILES.delete(story.mediaKey);
   await removeDoc(env,'stories',path[1]);
   return json({ok:true});
  }
  if(goodId(path[1])&&['view','like'].includes(path[2])&&['POST','DELETE'].includes(method)){
   const story=await getDoc(env,'stories',path[1]);if(!story||Date.parse(story.expiresAt)<=Date.now())return bad('انتهت صلاحية الستوري',404);
   const col=path[2]==='view'?'storyViews':'storyLikes',key=blockId(user.uid,story.id);
   if(method==='POST'){
    if(!await getDoc(env,col,key))try{await commit(env,[updateWrite(env,col,key,{actorUid:user.uid,ownerUid:story.ownerUid,storyId:story.id,expiresAt:new Date(story.expiresAt),createdAt:iso()},{exists:false})]);}catch(e){if(!conflict.includes(e.status))throw e;}
    return json({active:true});
   }
   if(method==='DELETE'&&col==='storyLikes'){
    if(await getDoc(env,col,key))await removeDoc(env,col,key);return json({active:false});
   }
  }
 }
 return bad('المسار غير مدعوم',404);
}
