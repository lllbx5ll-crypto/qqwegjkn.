import {handleFeatures} from './features.js';
import {handlePush,sendPrivatePush} from './push.js';
import {handlePayments} from './payments.js';
import {handleStoryChunks} from './story-chunks.js';
import {isSupportedProjectFile} from './project-file-types.js';
import {uploadedFileLike,imageTypeOrThrow} from './media-validation.js';
import {verifyToken} from './auth.js';
import {getDoc,setDoc,listDocs,queryDocs,removeDoc,commit,updateWrite,deleteWrite,approvedByAuthor,approvedAuthorStats} from './firestore.js';
import {defaultPlans,defaultSettings,PERMISSIONS,activePlan,can,cleanText,validLink,validInternalChatLink,MAX_IMAGE,MAX_FILE,MAX_AVATAR} from './constants.js';

const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(message,status=400)=>json({error:message},status);
const iso=()=>new Date().toISOString();
const slugOk=id=>typeof id==='string'&&/^[\w-]{1,128}$/.test(id);
const id=()=>crypto.randomUUID();
const sorted=(arr,key='createdAt')=>arr.sort((a,b)=>String(b[key]||'').localeCompare(String(a[key]||'')));
const stripInternal=v=>{if(!v)return v;const {_updateTime,...safe}=v;return safe;};
// Cloudflare's multipart parser can return a File-like Blob from a different
// runtime realm. Rely on its readable bytes and metadata, not instanceof File.
// Strings and missing form fields are still rejected.
export function isUploadedFile(file){
  return uploadedFileLike(file);
}
export function validFile(file,kind){
  if(!isUploadedFile(file))throw new Error('لم يصل الملف إلى الخادم؛ اختر الملف من جديد ثم أعد الرفع');
  if(file.size===0)throw new Error('الملف المختار حجمه صفر بايت؛ افتح الملف على جهازك وتأكد من أنه غير فارغ');
  if(kind==='projectImage'||kind==='image'){
    // MIME information from the device is unreliable. Inspect bytes in imageBytes.
    if(file.size>(kind==='projectImage'?MAX_IMAGE:MAX_AVATAR))throw new Error(kind==='projectImage'?'الصورة تتجاوز 200KB':'الصورة تتجاوز 2MB');
  }else if(file.size>MAX_FILE)throw new Error('الملف يتجاوز 3MB');
  return file;
}
async function imageBytes(file){
  const bytes=new Uint8Array(await file.arrayBuffer());
  return {bytes,mime:imageTypeOrThrow(bytes)};
}
async function putFile(env,key,file,mode){
  validFile(file,mode);
  if(mode==='file'&&!isSupportedProjectFile(file.name))throw new Error('نوع الملف غير مدعوم؛ اختر ملف كود أو أرشيفاً معروفاً حتى 3MB');
  const image=mode==='file'?null:await imageBytes(file);
  const body=mode==='file'?await file.arrayBuffer():image.bytes;
  await env.FILES.put(key,body,{httpMetadata:{contentType:mode==='file'?'application/octet-stream':image.mime},customMetadata:{originalName:file.name.slice(0,120)}});
}
async function responseFile(env,key,downloadName=null){
  const obj=await env.FILES.get(key);if(!obj)return fail('الملف غير موجود',404);
  const headers=new Headers({'x-content-type-options':'nosniff','cache-control':'public, max-age=3600'});
  if(downloadName){headers.set('content-type','application/octet-stream');headers.set('content-disposition',`attachment; filename="${downloadName.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)||'nexbots-file'}"`);headers.set('cache-control','private, no-store');}
  else headers.set('content-type',obj.httpMetadata?.contentType||'application/octet-stream');
  return new Response(obj.body,{headers});
}
async function requireIdentity(request,env){const identity=await verifyToken(request,env);if(!identity)throw Object.assign(new Error('سجّل الدخول بحساب Google أولاً'),{status:401});return identity;}
async function getOwner(env){return await getDoc(env,'config','owner');}
async function ensureUser(env,identity){
  let user=await getDoc(env,'users',identity.uid);
  const ownerEmail=env.OWNER_EMAIL?.toLowerCase()||'';
  const ownerMatch=identity.emailVerified&&identity.email.toLowerCase()===ownerEmail;
  let owner=await getOwner(env);
  if(ownerMatch&&!owner){
    // Create-once owner bootstrap; a concurrent first login cannot overwrite owner UID.
    try{await commit(env,[updateWrite(env,'config','owner',{uid:identity.uid,createdAt:iso()},{exists:false})]);}
    catch(e){if(![400,409,412].includes(e.status))throw e;}
    owner=await getOwner(env);
  }
  const isOwner=!!owner&&owner.uid===identity.uid&&ownerMatch;
  if(!user){
    user={uid:identity.uid,displayName:cleanText(identity.name||'عضو جديد',48),avatar:identity.picture||'',cover:'',bio:'',role:isOwner?'owner':'user',plan:'free',planEndsAt:null,planEndsAtMillis:null,planStartsAtMillis:null,verified:isOwner,badgeType:'auto',permissions:[],bannedUntil:null,bannedUntilMillis:null,chatMutedUntil:null,chatMutedUntilMillis:null,planStartsAt:null,createdAt:iso(),updatedAt:iso()};
    try{await commit(env,[updateWrite(env,'users',identity.uid,user,{exists:false}),updateWrite(env,'privateUsers',identity.uid,{email:identity.email,createdAt:iso()},{exists:false})]);}
    catch(e){if(![400,409,412].includes(e.status))throw e;user=await getDoc(env,'users',identity.uid);if(!user)throw e;}
  }else if(isOwner&&user.role!=='owner'){user={...stripInternal(user),role:'owner',verified:true,updatedAt:iso()};await setDoc(env,'users',identity.uid,user);}
  return stripInternal(user);
}
async function identityUser(request,env){const identity=await requireIdentity(request,env);const user=await ensureUser(env,identity);if(user.bannedUntil&&Date.parse(user.bannedUntil)>Date.now())throw Object.assign(new Error('تم حظر حسابك من المنصة. يرجى التواصل مع فريق الدعم عبر البريد lllbx5ll@gmail.com'),{status:403});return {identity,user};}
const need=(user,permission)=>{if(!can(user,permission))throw Object.assign(new Error('لا تملك هذه الصلاحية'),{status:403});};
const isOwner=user=>user?.role==='owner';
const parsed=async request=>{const data=await request.json().catch(()=>null);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('بيانات الطلب غير صحيحة');return data;};
async function settings(env){return {...defaultSettings,...stripInternal(await getDoc(env,'config','public'))};}
async function plans(env){return {...defaultPlans,...stripInternal(await getDoc(env,'config','plans'))};}
async function audit(env,by,action,target){await setDoc(env,'audit',id(),{by,action,target:cleanText(target,120),createdAt:iso()});}
function permittedTarget(actor,target,permission){need(actor,permission);if(target.role==='owner')throw Object.assign(new Error('لا يمكن تعديل حساب المالك'),{status:403});}

async function handle(request,env,waitUntil=()=>{}){
 const url=new URL(request.url);const path=url.pathname.replace(/^\/api\/?/,'').split('/').filter(Boolean);const route=path[0]||'';const method=request.method;
 if(method==='POST'&&['stories','projects','profile-upload'].includes(route)){
   const length=Number(request.headers.get('content-length'));
   if(Number.isFinite(length)&&length>(route==='stories'?14:route==='projects'?5:3)*1024*1024)
     return fail('حجم الطلب يتجاوز الحد المسموح',413);
 }
 if(method==='OPTIONS')return new Response(null,{status:204});
 const chunkResponse=await handleStoryChunks(request,env,path,method,identityUser);
 if(chunkResponse)return chunkResponse;
 if(route==='health')return json({ok:true,app:'NEXBOTS',version:'v3.1.0',r2UploadMode:'bounded-known-length-with-r2-check',projectConfigured:env.FIREBASE_PROJECT_ID==='exbots',webApiKeyConfigured:!!env.FIREBASE_WEB_API_KEY,bucketBound:!!env.FILES,authMode:'firebase-id-token-rules'});
 // Private, authenticated media channel: send each file separately as a raw
 // ReadableStream to R2, then finalize only small metadata in Firestore.
 // Never expose a public bucket URL or trust a browser-supplied filename/MIME.
 if((route==='stage'||route==='stage-status')&&path.length===4){
   const section=path[1],submissionId=path[2],slot=path[3];
   const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
   if(!uuid.test(submissionId)||!['projects','stories'].includes(section)||!(section==='projects'?['image','file'].includes(slot):slot==='media'))return fail('رقم رفع الملف غير صحيح',400);
   const {user}=await identityUser(request,env);
   const kind=section==='stories'?(request.headers.get('x-story-type')||''):slot;
   const key=section==='projects'?`projects/${submissionId}/${slot==='image'?'cover':'file'}`:`stories/${submissionId}/media`;
   if(route==='stage-status'&&method==='GET'){
     const item=await env.FILES.head(key);
     return json({received:!!(item?.customMetadata?.uploadUid===user.uid),size:item?.customMetadata?.uploadUid===user.uid?item.size:null});
   }
   if(route!=='stage'||!['POST','PUT'].includes(method))return fail('طريقة الطلب غير مدعومة',405);
   if(user.role!=='owner'){
     const level=activePlan(user),pricing=await plans(env);
     if(level==='free'||(section==='projects'&&!pricing[level]?.canUpload))return fail('رفع الملفات متاح للمشتركين فقط',403);
   }
   const previouslySaved=await getDoc(env,section,submissionId);
   if(previouslySaved){
     if((section==='projects'?previouslySaved.authorId:previouslySaved.ownerUid)!==user.uid)return fail('لا تملك صلاحية هذه العملية',403);
     return json({received:true,alreadyReceived:true});
   }
   const max=section==='projects'?(slot==='image'?MAX_IMAGE:MAX_FILE):12*1024*1024;
   const storyType=section==='stories'?kind:'';
   if(section==='stories'&&!['image','video'].includes(storyType))return fail('نوع الستوري غير صالح',400);
   const allowedMax=section==='stories'&&storyType==='image'?2*1024*1024:max;
   const claimed=Number(request.headers.get('x-file-size'));
   if(!Number.isSafeInteger(claimed)||claimed<=0||claimed>allowedMax)return fail('حجم الملف يتجاوز الحد المسموح أو فارغ',413);
   const contentLength=Number(request.headers.get('content-length'));
   if(contentLength&&contentLength!==claimed)return fail('حجم الملف لا يتطابق مع الطلب',400);
   const fileName=(()=>{try{return decodeURIComponent(request.headers.get('x-file-name')||'file').slice(0,120)}catch{return 'file'}})();
   const extension=String(fileName).toLowerCase().split('.').pop();
   if(section==='projects'&&slot==='file'&&!isSupportedProjectFile(fileName))return fail('نوع ملف المشروع غير مدعوم، اختر ملف كود أو أرشيفاً معروفاً',400);
   if(storyType==='video'&&extension!=='mp4')return fail('يجب أن يكون فيديو الستوري MP4',400);
   const isImage=slot==='image'||storyType==='image';
   let imageMime=extension==='jpg'||extension==='jpeg'?'image/jpeg':extension==='png'?'image/png':extension==='webp'?'image/webp':null;
   if(isImage&&!imageMime)return fail('اختر صورة باسم ينتهي بـ JPG أو PNG أو WebP',400);
   if(!request.body)return fail('لم يصل الملف',400);
   // Cloudflare R2 requires known-length values. TransformStream() produces an
   // unknown-length ReadableStream, even when the original Request had a known
   // Content-Length, so R2.put() rejects it in production. Small assets in this
   // platform (<= 12 MiB) are safely bounded and converted into Uint8Array.
   // Do not trust x-file-size alone: limit bytes *as they arrive* as well.
   // Pre-allocate exactly the declared (already capped) size. Copy each
   // incoming chunk only once; never build an array of chunks and copy twice.
   // This caps memory consumption even if a client lies about Content-Length.
   const bytes=new Uint8Array(claimed);
   const reader=request.body.getReader();
   let seen=0;
   try{
     for(;;){
       const {done,value}=await reader.read();
       if(done)break;
       const chunk=value instanceof Uint8Array?value:new Uint8Array(value);
       if(seen+chunk.byteLength>claimed){
         throw Object.assign(new Error('حجم الملف الذي وصل إلى الخادم أكبر من الحجم المسموح'),{status:413});
       }
       bytes.set(chunk,seen);
       seen+=chunk.byteLength;
     }
   }finally{reader.releaseLock();}
   if(seen!==claimed)return fail('حجم الملف المستلم لا يطابق حجم الملف المحدد؛ أعد اختياره وحاول مجدداً',400);
   if(isImage){
     // Android gallery/file managers sometimes rename or transcode an image
     // without updating its filename extension. The actual JPEG/PNG/WebP
     // signature is authoritative; store the matching Content-Type in R2.
     // Never trust the extension/MIME to accept unsupported or spoofed bytes.
     imageMime=imageTypeOrThrow(bytes.subarray(0,32));
   }
   // R2 accepts a Uint8Array with an explicit byte length. Its PUT promise
   // is strongly consistent. Avoid a second R2 HEAD and GET on each successful
   // upload (these extra operations previously turned successful uploads into
   // errors when a later read failed).
   let phase='write';
   try{
     const saved=await env.FILES.put(key,bytes,{httpMetadata:{contentType:isImage?imageMime:storyType==='video'?'video/mp4':'application/octet-stream'},customMetadata:{uploadUid:user.uid,submissionId,originalName:fileName,storyType:storyType||'',uploadedAt:iso()}});
     if(!saved || (Number.isFinite(saved.size)&&saved.size!==seen)){
       throw new Error('رد التخزين لم يؤكد حفظ الحجم الصحيح');
     }
     return json({received:true,size:seen,slot},201);
   }catch(error){
     console.error('NEXBOTS stage R2 error',{section,slot,bytes:seen,phase,errorName:error?.name,errorMessage:String(error?.message||'').slice(0,220)});
     // Don't blindly delete: a timed-out PUT may have committed successfully.
     // stage-status lets the owner check exact object identity before retry.
     const reported=Object.assign(new Error('فشل تخزين الملف في R2. افتح سجلات Functions في Cloudflare لمعرفة سبب الخطأ'),{status:503});
     throw reported;
   }

 }
 // After a lost upload response, confirm whether the server committed the same
 // submission ID; never blindly retry and create duplicate R2 files/records.
 if(route==='upload-status'&&method==='GET'&&path.length===3){
   const {user}=await identityUser(request,env);
   const kind=path[1],submissionId=path[2];
   if(!['projects','stories'].includes(kind)||!slugOk(submissionId))return fail('رقم عملية الرفع غير صحيح',400);
   const record=await getDoc(env,kind,submissionId);
   if(!record)return json({received:false});
   if((kind==='projects'?record.authorId:record.ownerUid)!==user.uid)return fail('ليس لديك صلاحية فحص هذه العملية',403);
   return json({received:true,id:submissionId,status:record.status||'active'});
 }
 if(route==='public'&&method==='GET'){
   if(!env.FIREBASE_PROJECT_ID||!env.FIREBASE_WEB_API_KEY)return fail('إعداد Firebase ناقص في Pages: FIREBASE_PROJECT_ID أو FIREBASE_WEB_API_KEY',503);
   const [conf,pricing]=await Promise.all([settings(env),plans(env)]);
   const {bannedWords,...visible}=conf;return json({settings:visible,plans:pricing});
 }
 const paymentResponse=await handlePayments(request,env,path,method,{identityUser});
 if(paymentResponse)return paymentResponse;
 const pushResponse=await handlePush(request,env,path,method,{identityUser,isOwner,waitUntil});
 if(pushResponse)return pushResponse;
 const featureResponse=await handleFeatures(request,env,path,method,{identityUser,need,isOwner,plans,notifyPrivate:(recipient,senderName,threadId)=>{try{waitUntil(sendPrivatePush(env,recipient,senderName,threadId));}catch(e){console.warn('Push scheduling failed');}}});
 if(featureResponse)return featureResponse;
 if(route==='media'&&method==='GET'){
   if(path[1]==='story'&&slugOk(path[2])){
     const story=await getDoc(env,'stories',path[2]);
     if(!story||!story.mediaKey||Date.parse(story.expiresAt)<=Date.now())return fail('انتهت صلاحية الستوري',404);
     const res=await responseFile(env,story.mediaKey);
     if(res.ok){const headers=new Headers(res.headers);headers.set('cache-control','no-store');return new Response(res.body,{headers});}
     return res;
   }
   if(path[1]==='brand'&&['logo','background'].includes(path[2])){const conf=await settings(env);return conf[path[2]]?responseFile(env,conf[path[2]]):fail('لا يوجد ملف',404);}
   if(path[1]==='profile'&&slugOk(path[2])&&['avatar','cover'].includes(path[3])){
     const profile=await getDoc(env,'users',path[2]);const key=profile?.[path[3]];
     if(!key||!key.startsWith('profiles/'))return fail('الصورة غير موجودة',404);
     return responseFile(env,key);
   }
   if(path[1]==='project'&&slugOk(path[2])){
     const project=await getDoc(env,'projects',path[2]);
     if(!project)return fail('المشروع غير موجود',404);
     if(project.status!=='approved'){
       const {user}=await identityUser(request,env);
       if(user.uid!==project.authorId&&!can(user,'manageProjects'))return fail('غير مصرح',403);
     }
     if(!project.imageKey)return fail('لا توجد صورة',404);
     const media=await responseFile(env,project.imageKey);if(project.status!=='approved'&&media.ok){const h=new Headers(media.headers);h.set('cache-control','private, no-store');return new Response(media.body,{status:media.status,headers:h});}return media;
   }
   return fail('الملف غير موجود',404);
 }
 if(route==='projects'&&method==='GET'&&path.length===1){
   const entries=await queryDocs(env,'projects','status','approved',150);
   return json(sorted(entries).map(stripInternal).slice(0,80).map(p=>({...p,fileKey:undefined,externalUrl:p.forSale?undefined:p.externalUrl})));
 }
 if(route==='projects'&&method==='GET'&&path.length===2){
   if(!slugOk(path[1]))return fail('معرّف غير صالح');
   const project=await getDoc(env,'projects',path[1]);if(!project)return fail('المشروع غير موجود',404);
   if(project.status!=='approved'){
     const {user}=await identityUser(request,env);
     if(user.uid!==project.authorId&&!can(user,'manageProjects'))return fail('غير مصرح',403);
   }
   const {fileKey,_updateTime,...publicProject}=project;
   if(project.forSale){
     const uid=(await verifyToken(request,env))?.uid;
     const granted=uid&&(uid===project.authorId||!!await getDoc(env,'purchaseGrants',`${project.id}_${uid}`));
     if(!granted)publicProject.externalUrl=null;
     publicProject.buyerAccess=!!granted;
   }
   // Resolve the CURRENT public author identity. Never expose private email,
   // membership permissions or Firebase credentials in project details.
   let author=null;
   try{author=await getDoc(env,'users',project.authorId);}catch(error){
     // An author card must never break the download page if profile lookup fails.
     console.warn('NEXBOTS project author lookup failed',error?.status||error?.message);
   }
   publicProject.authorProfile={
     uid:project.authorId,
     displayName:author?.displayName||project.authorName||'عضو NEXBOTS',
     avatar:author?.avatar||project.authorAvatar||'',
     verified:author?.verified===true||author?.role==='owner',badgeType:author?.badgeType||'auto',activePlan:author?activePlan(author):'free',
     role:author?.role==='owner'?'owner':'user',
     username:author?.username||''
   };
   return json(publicProject);
 }
 if(route==='profiles'&&method==='GET'&&slugOk(path[1])&&path.length===2){
   const targetId=path[1];let profile=await getDoc(env,'users',targetId);
   if(!profile){
     // Historical chat records may outlive a deleted legacy users document.
     // For signed-in chat members, show a clearly labelled read-only snapshot
     // instead of a misleading dead link; never recreate someone else's account.
     if(!env.FIRESTORE_ID_TOKEN)return fail('العضو غير موجود',404);
     const snapshot=(await queryDocs(env,'messages','uid',targetId,1))[0];
     if(!snapshot)return fail('العضو غير موجود',404);
     profile={uid:targetId,displayName:snapshot.displayName||'عضو سابق',avatar:snapshot.avatar||'',bio:'ملف قديم بحاجة لتسجيل صاحبه مجدداً',role:'user',plan:'free',legacy:true};
   }
   let projects=[],stat={approvedProjects:0,totalDownloads:0};let statsPartial=false;
   try {
     [projects,stat]=await Promise.all([approvedByAuthor(env,targetId,80),approvedAuthorStats(env,targetId)]);
   } catch(e){
     // Older projects can predate the composite index. Keep profiles usable
     // and flag sampled totals until the index is deployed.
     const sample=await queryDocs(env,'projects','status','approved',150);
     projects=sample.filter(p=>p.authorId===targetId);
     stat={approvedProjects:projects.length,totalDownloads:projects.reduce((sum,p)=>sum+(Number(p.downloads)||0),0)};
     statsPartial=sample.length===150;
   }
   const publicProjects=sorted(projects).map(p=>({id:p.id,title:p.title,category:p.category,downloads:p.downloads||0}));
   const {permissions,bannedUntil,chatMutedUntil,planEndsAt,planStartsAt,bannedUntilMillis,chatMutedUntilMillis,planEndsAtMillis,planStartsAtMillis,createdAt,updatedAt,_updateTime,id:_id,...publicUser}=profile;
   let viewer={following:false,liked:false};
   if(env.FIRESTORE_ID_TOKEN){
     const identity=await requireIdentity(request,env);
     if(identity.uid!==targetId){
       const edgeId=`${identity.uid}_${targetId}`;
       const [f,l]=await Promise.all([getDoc(env,'profileFollows',edgeId),getDoc(env,'profileLikes',edgeId)]);
       viewer={following:!!f,liked:!!l};
     }
   }
   return json({user:{...publicUser,activePlan:activePlan(profile)},projects:publicProjects,stats:{...stat,followers:Number(profile.followersCount||0),likes:Number(profile.likesCount||0),partial:statsPartial},viewer});
 }
 if(route==='profiles'&&slugOk(path[1])&&path.length===3&&['follow','like'].includes(path[2])&&['POST','DELETE'].includes(method)){
   const {user:actor}=await identityUser(request,env);const targetId=path[1];
   if(actor.uid===targetId)return fail('لا تستطيع متابعة أو إعجاب ملفك الشخصي',400);
   const isFollow=path[2]==='follow',col=isFollow?'profileFollows':'profileLikes',counter=isFollow?'followersCount':'likesCount';
   const edgeId=`${actor.uid}_${targetId}`,adding=method==='POST';
   for(let tries=0;tries<6;tries++){
     const [target,edge]=await Promise.all([getDoc(env,'users',targetId),getDoc(env,col,edgeId)]);
     if(!target)return fail('العضو غير موجود',404);
     if(adding&&edge || !adding&&!edge)return json({active:adding,count:Number(target[counter]||0)});
     const nextValue=Math.max(0,Number(target[counter]||0)+(adding?1:-1));
     const updated={...stripInternal(target),[counter]:nextValue};
     const writes=[updateWrite(env,'users',targetId,updated,{updateTime:target._updateTime})];
     if(adding)writes.push(updateWrite(env,col,edgeId,{actorUid:actor.uid,targetUid:targetId,createdAt:iso()},{exists:false}));
     else writes.push(deleteWrite(env,col,edgeId));
     try{await commit(env,writes);return json({active:adding,count:nextValue});}
     catch(e){if(![400,409,412].includes(e.status)||tries===5)throw e;}
   }
   return fail('تعذر تحديث التفاعل، حاول مجدداً',409);
 }
 if(route==='download'&&method==='GET'&&slugOk(path[1])){
   await identityUser(request,env);
   const project=await getDoc(env,'projects',path[1]);if(!project||project.status!=='approved')return fail('المشروع غير متاح',404);
   if(!project.fileKey&&!project.externalUrl)return fail('لم يحدد صاحب المشروع ملف تحميل',404);
   if(project.forSale){
     const buyer=await requireIdentity(request,env);
     if(buyer.uid!==project.authorId){const grant=await getDoc(env,'purchaseGrants',`${project.id}_${buyer.uid}`);if(!grant)return fail('هذا مشروع معروض للبيع. تواصل مع البائع، ولا يتاح التحميل حتى يمنحك الوصول بعد إتمام الاتفاق',403);}
   }
   const existing=project.fileKey?await env.FILES.get(project.fileKey):null;
   if(project.fileKey&&!existing)return fail('الملف غير موجود',404);
   // Per-user, per-project, per-day download throttle to limit abuse and costs.
   const visitor=await requireIdentity(request,env);const day=Math.floor(Date.now()/86400000),dlId=`${visitor.uid}_${project.id}_${day}`;
   let counted=false;for(let tries=0;tries<5;tries++){
     const prev=await getDoc(env,'downloadQuotas',dlId);
     if((prev?.count||0)>=30)return fail('تم تجاوز 30 طلب تحميل لهذا المشروع اليوم',429);
     const freshProject=await getDoc(env,'projects',project.id);
     if(!freshProject||freshProject.status!=='approved')return fail('المشروع غير متاح',404);
     const nextProject={...stripInternal(freshProject),downloads:(freshProject.downloads||0)+1,lastDownloadId:dlId};
     try{await commit(env,[updateWrite(env,'downloadQuotas',dlId,{uid:visitor.uid,projectId:project.id,day,count:(prev?.count||0)+1},prev?{updateTime:prev._updateTime}:{exists:false}),updateWrite(env,'projects',project.id,nextProject,{updateTime:freshProject._updateTime})]);counted=true;break;}catch(e){if(![400,409,412].includes(e.status)||tries===4)throw e;}
   }if(!counted)return fail('حاول التنزيل لاحقاً',429);
   if(project.externalUrl&&!project.fileKey)return json({externalUrl:project.externalUrl});
   const fileName=project.originalFileName||'nexbots-project.zip';
   const headers=new Headers({'content-type':'application/octet-stream','content-disposition':`attachment; filename="${fileName.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)}"`,'cache-control':'private, no-store','x-content-type-options':'nosniff'});
   return new Response(existing.body,{headers});
 }
 if(route==='me'){
   const {identity,user}=await identityUser(request,env);
   if(method==='GET')return json({user,private:{email:identity.email},activePlan:activePlan(user)});
   if(method==='PATCH'){
     const data=await parsed(request), changes={};
     if('displayName'in data){changes.displayName=cleanText(data.displayName,48);if(changes.displayName.length<2)throw new Error('اسم العرض قصير');}
     if('bio'in data)changes.bio=cleanText(data.bio,300);
     const next={...user,...changes,updatedAt:iso()};await setDoc(env,'users',user.uid,next);return json({user:next});
   }
 }
 if(route==='profile-upload'&&method==='POST'){
   const {user}=await identityUser(request,env);const form=await request.formData();const kind=String(form.get('kind')||'');
   if(!['avatar','cover'].includes(kind))throw new Error('نوع الصورة غير صحيح');
   const file=validFile(form.get('file'),'image');
   const key=`profiles/${user.uid}/${kind}-${id()}`;
   await putFile(env,key,file,'image');
   const oldKey=user[kind];
   try {
     // `setDoc` strips derived `id` and `_updateTime`; only allowed profile fields change.
     await setDoc(env,'users',user.uid,{...user,[kind]:key,updatedAt:iso()});
   } catch (error) {
     await env.FILES.delete(key).catch(()=>{}); // no abandoned image on denied write
     throw error;
   }
   if(oldKey?.startsWith(`profiles/${user.uid}/`))await env.FILES.delete(oldKey).catch(()=>{});
   return json({url:`/api/media/profile/${user.uid}/${kind}?v=${encodeURIComponent(key)}`,key});
 }
 if(route==='my-projects'&&method==='GET'){
   const {user}=await identityUser(request,env);
   const entries=await queryDocs(env,'projects','authorId',user.uid,150);
   return json(sorted(entries).map(p=>{const {fileKey,imageKey,_updateTime,...item}=p;return item;}));
 }
 if(route==='projects'&&method==='POST'&&path.length===1){
   const {user}=await identityUser(request,env);const pricing=await plans(env);const level=activePlan(user);
   if(!pricing[level]?.canUpload&&!isOwner(user))return fail('رفع المشاريع متاح للمشتركين فقط',403);
   const form=await request.formData();const title=cleanText(form.get('title'),90),description=cleanText(form.get('description'),2500);
   const category=cleanText(form.get('category'),32),language=cleanText(form.get('language'),32);
   const tags=cleanText(form.get('tags'),180).split(',').map(t=>t.trim()).filter(Boolean).slice(0,8);
   const usage=cleanText(form.get('usage'),1200);
   const validCategories=['whatsapp','telegram','python','javascript','php','tools'];
   const forSale=String(form.get('forSale')||'false')==='true',price=Number(form.get('price')||0);
   if(forSale&&(!Number.isFinite(price)||price<=0||price>10000))throw Error('حدد سعراً صالحاً للمشروع من 1 إلى 10000 دولار');
   if(title.length<5||description.length<20||!validCategories.includes(category))throw new Error('تحقق من العنوان والوصف والتصنيف');
   const staged=String(form.get('stagedAssets')||'')==='1';
   const image=staged?null:form.get('image'),file=staged?null:form.get('file');
   const imageName=staged?cleanText(form.get('imageName'),120):'',fileName=staged?cleanText(form.get('fileName'),120):'';
   const externalUrl=cleanText(form.get('externalUrl'),500);
   if(externalUrl&&!validLink(externalUrl))throw new Error('رابط التنزيل يجب أن يكون HTTPS صالحاً');
   if(!isUploadedFile(file)&&!fileName&&!externalUrl)throw new Error('أرفق ملفاً أو رابط تنزيل خارجي');
   if(isUploadedFile(image))validFile(image,'projectImage');
   else if(image!==null)throw new Error('تعذر قراءة صورة المشروع؛ اختر الصورة مرة أخرى');
   if(isUploadedFile(file))validFile(file,'file');
   else if(file!==null)throw new Error('تعذر قراءة ملف المشروع؛ اختر ملف المشروع من جديد');
   const requestedId=String(form.get('submissionId')||'');
   const projectId=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestedId)?requestedId:id();
   const imageKey=(staged?!!imageName:isUploadedFile(image))?`projects/${projectId}/cover`:null,fileKey=(staged?!!fileName:isUploadedFile(file))?`projects/${projectId}/file`:null;
   // A retried request after a lost response must not duplicate a project.
   if(requestedId){
     const prior=await getDoc(env,'projects',projectId).catch(e=>e.status===403||e.status===404?null:Promise.reject(e));
     if(prior){
       if(prior.authorId!==user.uid)return fail('معرّف رفع مستخدم مسبقاً',409);
       return json({id:projectId,status:prior.status||'pending',alreadyReceived:true});
     }
   }
   const own=(await queryDocs(env,'projects','authorId',user.uid,150)).filter(p=>p.status==='pending');
   if(own.length>=10)return fail('لديك 10 مشاريع بانتظار المراجعة، انتظر الموافقة أولاً',429);
   try {
     if(staged){
       for(const [key,limit] of [[imageKey,MAX_IMAGE],[fileKey,MAX_FILE]]){
         if(!key)continue;
         const meta=await env.FILES.head(key);
         if(!meta||meta.customMetadata?.uploadUid!==user.uid||meta.customMetadata?.submissionId!==projectId||meta.size===0||meta.size>limit)
           throw new Error('لم يكتمل نقل صورة المشروع أو ملفه. أعد إرسال الملف من الصفحة نفسها');
         if(meta.customMetadata?.originalName!==(key===imageKey?imageName:fileName))
           throw new Error('اسم الملف تغيّر أثناء الرفع. اختر الملف مجدداً');
       }
     }else{
       if(imageKey)await putFile(env,imageKey,image,'projectImage');
       if(fileKey)await putFile(env,fileKey,file,'file');
     }
     const record={title,description,category,language,tags,usage,forSale,price:forSale?price:0,currency:'USD',externalUrl:validLink(externalUrl),imageKey,fileKey,originalFileName:staged?fileName:isUploadedFile(file)?file.name.slice(0,120):'',authorId:user.uid,authorName:user.displayName,authorAvatar:user.avatar,status:'pending',reviewReason:'',downloads:0,createdAt:iso(),updatedAt:iso()};
     await commit(env,[updateWrite(env,'projects',projectId,record,{exists:false})]);return json({id:projectId,status:'pending'},201);
   } catch(e){
       const prior=await getDoc(env,'projects',projectId).catch(()=>null);
       if(prior?.authorId===user.uid)return json({id:projectId,status:prior.status||'pending',alreadyReceived:true});
       // Only remove objects from an attempt that did not successfully commit.
       if(!staged&&imageKey)await env.FILES.delete(imageKey).catch(()=>{});
       if(!staged&&fileKey)await env.FILES.delete(fileKey).catch(()=>{});
       throw e;
     }
 }
 if(route==='messages'&&method==='GET'){
   await identityUser(request,env);
   const items=sorted(await listDocs(env,'messages',150)).slice(0,100).reverse();return json(items.map(stripInternal));
 }
 if(route==='messages'&&method==='POST'){
   const {user}=await identityUser(request,env);const data=await parsed(request);
   const text=cleanText(data.text,600);if(!text||text.length>600)throw new Error('الرسالة يجب ألا تكون فارغة');
   if(user.chatMutedUntil&&Date.parse(user.chatMutedUntil)>Date.now())return fail('تم كتم حسابك في الشات حتى '+user.chatMutedUntil,403);
   const config=await settings(env),forbidden=(config.bannedWords||[]).some(w=>String(w).trim()&&text.toLowerCase().includes(String(w).trim().toLowerCase()));
   if(forbidden)return fail('الرسالة تحتوي على كلمات غير مسموحة',400);
   const price=await plans(env),level=activePlan(user),limit=isOwner(user)?100000:Math.max(0,Number(price[level]?.dailyMessages)||50);
   const day=Math.floor(Date.now()/86400000),quotaId=`${user.uid}_${day}`;
   for(let attempt=0;attempt<5;attempt++){
     const old=await getDoc(env,'quotas',quotaId);
     if((old?.count||0)>=limit)return fail(`وصلت للحد اليومي (${limit} رسالة UTC)`,429);
     const msgId=id(),now=iso();
     const quota={uid:user.uid,day,count:(old?.count||0)+1,updatedAt:now,lastMessageId:msgId};
     const message={uid:user.uid,displayName:user.displayName,avatar:user.avatar,verified:user.verified||isOwner(user),badgeType:user.badgeType||'auto',activePlan:activePlan(user),role:user.role,text,createdAt:now,deleted:false,quotaId,quotaCount:quota.count};
     try{
       await commit(env,[updateWrite(env,'quotas',quotaId,quota,old?{updateTime:old._updateTime}:{exists:false}),updateWrite(env,'messages',msgId,message,{exists:false})]);
       return json({id:msgId,...message,remaining:limit-quota.count},201);
     }catch(e){if(![400,409,412].includes(e.status)||attempt===4)throw e;}
   }
 }

 if(route==='project-edits'&&method==='GET'&&path.length===1){
   const {user}=await identityUser(request,env);need(user,'manageProjects');
   return json(sorted(await listDocs(env,'projectEdits',120)).filter(e=>e.status==='pending'));
 }
 if(route==='project-edits'&&method==='PATCH'&&slugOk(path[1])){
   const {user}=await identityUser(request,env);need(user,'manageProjects');
   const edit=await getDoc(env,'projectEdits',path[1]);if(!edit)return fail('طلب التعديل غير موجود',404);
   const body=await parsed(request);if(!['approved','rejected'].includes(body.status))throw Error('قرار غير صحيح');
   const project=await getDoc(env,'projects',edit.projectId);if(!project)return fail('المشروع الأصلي غير موجود',404);
   if(body.status==='approved'){
     // Revalidate pending changes even if their Firestore document was forged.
     const proposed=edit.changes||{},allowed=['title','description','category','language','usage','tags','externalUrl','forSale','price','currency'];
     if(Object.keys(proposed).some(k=>!allowed.includes(k)))throw Error('طلب التعديل يحتوي حقولاً غير مسموحة');
     if(proposed.title!==undefined&&(typeof proposed.title!=='string'||proposed.title.length<5||proposed.title.length>90))throw Error('عنوان غير صالح');
     if(proposed.description!==undefined&&(typeof proposed.description!=='string'||proposed.description.length<20||proposed.description.length>2500))throw Error('وصف غير صالح');
     if(proposed.category!==undefined&&!['whatsapp','telegram','python','javascript','php','tools'].includes(proposed.category))throw Error('التصنيف غير صالح');
     if(proposed.tags!==undefined&&(!Array.isArray(proposed.tags)||proposed.tags.length>8||proposed.tags.some(t=>typeof t!=='string'||t.length>35)))throw Error('الوسوم غير صالحة');
     if(proposed.externalUrl&& !validLink(proposed.externalUrl))throw Error('رابط غير آمن');
     if(proposed.forSale!==undefined&&typeof proposed.forSale!=='boolean')throw Error('نوع العرض غير صالح');
     if(proposed.price!==undefined&&(!Number.isFinite(proposed.price)||proposed.price<0||proposed.price>10000))throw Error('السعر غير صالح');
     if(proposed.currency!==undefined&&proposed.currency!=='USD')throw Error('العملة غير مدعومة');
     const merged={...stripInternal(project),...proposed,updatedAt:iso()};
     if(merged.forSale&&(!merged.price||merged.price<=0))throw Error('السعر مطلوب عند عرض مشروع للبيع');
     await setDoc(env,'projects',project.id,merged);
   }
   await setDoc(env,'projectEdits',edit.id,{...stripInternal(edit),status:body.status,reviewerUid:user.uid,reviewedAt:iso(),reason:cleanText(body.reason||'',250)});
   await audit(env,user.uid,`project-edit:${body.status}`,edit.projectId);
   return json({ok:true});
 }
 if(route==='projects'&&slugOk(path[1])&&method==='DELETE'&&path.length===2){
   const {user}=await identityUser(request,env);const project=await getDoc(env,'projects',path[1]);if(!project)return fail('المشروع غير موجود',404);
   if(project.authorId!==user.uid&&!can(user,'manageProjects'))return fail('غير مصرح',403);
   await removeDoc(env,'projects',project.id);
   for(const key of [project.fileKey,project.imageKey])if(key)await env.FILES.delete(key).catch(()=>{});
   return json({ok:true});
 }
 if(route==='projects'&&slugOk(path[1])&&method==='PATCH'&&path.length===2){
   const {user}=await identityUser(request,env);const project=await getDoc(env,'projects',path[1]);if(!project)return fail('المشروع غير موجود',404);
   if(project.authorId!==user.uid&&!can(user,'manageProjects'))return fail('غير مصرح',403);
   const body=await parsed(request);const changes={};
   for(const key of ['title','description','language','usage','tags','category'])if(key in body){
     changes[key]=key==='tags'?(Array.isArray(body.tags)?body.tags.map(x=>cleanText(x,35)).slice(0,8):[]):cleanText(body[key],key==='description'?2500:key==='usage'?1200:90);
   }
   if('forSale' in body){if(body.forSale===true&&user.role!=='owner'&&activePlan(user)==='free')return fail('بيع المشاريع للمشتركين فقط',403);changes.forSale=body.forSale===true;changes.price=changes.forSale?Number(body.price):0;changes.currency='USD';if(changes.forSale&&(!Number.isFinite(changes.price)||changes.price<=0||changes.price>10000))throw Error('السعر غير صالح');}
   if('externalUrl'in body){changes.externalUrl=validLink(cleanText(body.externalUrl,500));}
   if(!Object.keys(changes).length)throw Error('لا يوجد تغيير');
   if(can(user,'manageProjects')){
     const updated={...stripInternal(project),...changes,updatedAt:iso()};await setDoc(env,'projects',project.id,updated);return json({ok:true,direct:true});
   }
   const existing=await getDoc(env,'projectEdits',project.id);
   await setDoc(env,'projectEdits',project.id,{projectId:project.id,authorId:user.uid,authorName:user.displayName,changes,status:'pending',createdAt:iso()});
   return json({ok:true,pending:true});
 }
 if(route==='purchase-grants'&&method==='POST'&&slugOk(path[1])){
   const {user}=await identityUser(request,env);const project=await getDoc(env,'projects',path[1]);if(!project)return fail('المشروع غير موجود',404);
   if(user.uid!==project.authorId&&!can(user,'manageProjects'))return fail('غير مصرح',403);
   const body=await parsed(request),buyerUid=String(body.buyerUid||'');if(!slugOk(buyerUid)||!await getDoc(env,'users',buyerUid))throw Error('معرف المشتري غير صالح');
   await setDoc(env,'purchaseGrants',`${project.id}_${buyerUid}`,{projectId:project.id,buyerUid,sellerUid:project.authorId,grantedBy:user.uid,createdAt:iso()});
   return json({ok:true});
 }

 if(route==='admin'){
   const {user}=await identityUser(request,env);const section=path[1]||'';
   // Owner-only live R2 write/read/delete diagnostic. This deliberately
   // exercises the same Pages Function and R2 binding with binary data sent
   // from the browser. The temporary object is deleted even when validation
   // fails. No private keys or user data are returned.
   if(section==='r2-check'&&method==='POST'){
     if(!isOwner(user))return fail('هذا الفحص متاح لمالك المنصة فقط',403);
     const declared=Number(request.headers.get('x-file-size'));
     if(!Number.isInteger(declared)||declared<1||declared>131072)return fail('حجم ملف الاختبار غير صالح',413);
     if(!request.body)return fail('لم يصل طلب الاختبار',400);
     const key=`diagnostics/${id()}`;
     let step='receive';
     try{
       const buffer=await request.arrayBuffer();
       if(buffer.byteLength!==declared)return fail('مشكلة نقل المتصفح: حجم البيانات المستلمة غير متطابق',400);
       step='put';
       const stored=await env.FILES.put(key,new Uint8Array(buffer),{httpMetadata:{contentType:'application/octet-stream'}});
       if(!stored)throw Error('R2.put returned no object');
       step='head';
       const head=await env.FILES.head(key);
       if(!head||head.size!==declared)throw Error('R2 object length mismatch');
       return json({ok:true,bytes:declared,stages:['browser-to-pages','r2-put','r2-head'],message:'تم استلام البيانات وحفظها والتحقق منها في R2'});
     }catch(err){
       console.error('NEXBOTS R2 diagnostic failed',{step,errorName:err?.name,errorMessage:String(err?.message||'').slice(0,200)});
       return json({ok:false,step,error:'فشل فحص التخزين عند مرحلة '+step+'؛ افتح سجلات Cloudflare لمعرفة سبب الفشل'},503);
     }finally{
       try{await env.FILES.delete(key);}catch(err){console.error('NEXBOTS R2 diagnostic cleanup failed',{message:String(err?.message||'').slice(0,120)});}
     }
   }
   if(section==='overview'&&method==='GET'){
     if(!PERMISSIONS.some(p=>can(user,p)))return fail('ليس لديك تصريح للدخول',403);
     const [users,projects,messages]=await Promise.all([listDocs(env,'users',500),listDocs(env,'projects',500),listDocs(env,'messages',500)]);
     return json({users:users.length,projects:projects.length,pending:projects.filter(p=>p.status==='pending').length,approved:projects.filter(p=>p.status==='approved').length,messages:messages.length,countsAreSampled:users.length===500||projects.length===500||messages.length===500});
   }
   if(section==='projects'){
     need(user,'manageProjects');
     if(method==='GET')return json(sorted(await listDocs(env,'projects',150)).map(p=>{const {fileKey,imageKey,_updateTime,...rest}=p;return rest;}));
     if(method==='PATCH'&&slugOk(path[2])){
       const project=await getDoc(env,'projects',path[2]);if(!project)return fail('المشروع غير موجود',404);
       const data=await parsed(request);if(!['approved','rejected','pending'].includes(data.status))throw new Error('حالة غير معروفة');
       const next={...stripInternal(project),status:data.status,reviewReason:cleanText(data.reason,300),updatedAt:iso(),reviewedBy:user.uid};
       await setDoc(env,'projects',project.id,next);await audit(env,user.uid,`project:${data.status}`,project.id);return json({project:next});
     }
     if(method==='DELETE'&&slugOk(path[2])){
       const project=await getDoc(env,'projects',path[2]);if(!project)return fail('المشروع غير موجود',404);
       await removeDoc(env,'projects',project.id);
       if(project.fileKey)await env.FILES.delete(project.fileKey).catch(()=>{});
       if(project.imageKey)await env.FILES.delete(project.imageKey).catch(()=>{});
       await audit(env,user.uid,'project:delete',project.id);return json({ok:true});
     }
   }
   if(section==='users'){
     if(method==='GET'){if(!can(user,'manageUsers')&&!can(user,'viewEmails'))return fail('ليس لديك تصريح لعرض المستخدمين',403);
       const profiles=await listDocs(env,'users',150);const mayViewEmail=isOwner(user)||can(user,'viewEmails');const privateDocs=mayViewEmail?await listDocs(env,'privateUsers',150):[];
       const byUID=new Map(privateDocs.map(d=>[d.id,d.email]));
       return json(sorted(profiles).map(p=>({...stripInternal(p),email:mayViewEmail?byUID.get(p.uid)||'':undefined})));
     }
     if(method==='PATCH'&&slugOk(path[2])){
       need(user,'manageUsers');const target=await getDoc(env,'users',path[2]);if(!target)return fail('المستخدم غير موجود',404);
       permittedTarget(user,target,'manageUsers');const data=await parsed(request);const changes={};
       if('plan'in data){if(!['free','plus','premium','pro'].includes(data.plan))throw new Error('خطة غير معروفة');changes.plan=data.plan;
         changes.planStartsAt=data.plan==='free'?null:(data.planStartsAt&&Date.parse(data.planStartsAt)?new Date(data.planStartsAt).toISOString():iso());
         changes.planEndsAt=data.plan==='free'?null:(data.planEndsAt&&Date.parse(data.planEndsAt)>Date.now()?new Date(data.planEndsAt).toISOString():null);
         if(data.plan!=='free'&&!changes.planEndsAt)throw new Error('حدد تاريخ نهاية الاشتراك في المستقبل');
         changes.planEndsAtMillis=changes.planEndsAt?Date.parse(changes.planEndsAt):null;
         changes.planStartsAtMillis=changes.planStartsAt?Date.parse(changes.planStartsAt):null;
       }
       if('verified'in data){need(user,'manageBadges');changes.verified=data.verified===true;}
        if('badgeType'in data){need(user,'manageBadges');if(!['auto','blue','white','none'].includes(data.badgeType))throw new Error('نوع الشارة غير صالح');changes.badgeType=data.badgeType;changes.verified=data.badgeType==='blue';}
       if('bannedUntil'in data){const date=data.bannedUntil?Date.parse(data.bannedUntil):null;if(data.bannedUntil&&!Number.isFinite(date))throw new Error('تاريخ حظر غير صالح');changes.bannedUntil=date?new Date(date).toISOString():null;changes.bannedUntilMillis=date;}
       if('chatMutedUntil'in data){need(user,'manageChat');const date=data.chatMutedUntil?Date.parse(data.chatMutedUntil):null;if(data.chatMutedUntil&&!Number.isFinite(date))throw new Error('تاريخ الكتم غير صالح');changes.chatMutedUntil=date?new Date(date).toISOString():null;changes.chatMutedUntilMillis=date;}
       if('role'in data||'permissions'in data){
         if(!isOwner(user))return fail('فقط المالك يمنح أدوار المطورين',403);
         if('role'in data){if(!['developer','user'].includes(data.role))throw new Error('دور غير مسموح');changes.role=data.role;}
         if('permissions'in data){if(!Array.isArray(data.permissions)||data.permissions.some(p=>!PERMISSIONS.includes(p)))throw new Error('صلاحيات غير معروفة');changes.permissions=[...new Set(data.permissions)];}
         if(changes.role==='user')changes.permissions=[];
       }
       if(!Object.keys(changes).length)throw new Error('لا يوجد تعديل صالح');
       await setDoc(env,'users',target.uid,{...stripInternal(target),...changes,updatedAt:iso()});
       await audit(env,user.uid,'user:update',target.uid);return json({ok:true});
     }
   }
   if(section==='settings'){
     need(user,'manageSettings');if(method==='GET')return json(await settings(env));
     if(method==='PATCH'){
       const data=await parsed(request),current=await settings(env),changes={};
       for(const field of ['siteName','tagline','description','announcement'])if(field in data)changes[field]=cleanText(data[field],field==='description'?500:field==='announcement'?250:90);
       if('supportEmail'in data){const email=cleanText(data.supportEmail,150);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('البريد غير صالح');changes.supportEmail=email;}
       for(const field of ['telegram','instagram','whatsapp'])if(field in data){const val=cleanText(data[field],500);if(val&&!validLink(val,field==='whatsapp'))throw new Error('رابط التواصل يجب أن يكون HTTPS صحيحاً');changes[field]=val;}
        for(const field of ['complaintsChatUrl','verificationChatUrl'])if(field in data){const safe=validInternalChatLink(data[field]);if(safe===null)throw new Error('أدخل رابط محادثة صحيحاً داخل NEXBOTS فقط (/private?to=UID)');changes[field]=safe;}
       if('bannedWords'in data){if(!Array.isArray(data.bannedWords)||data.bannedWords.length>100)throw new Error('عدد الكلمات غير صالح');changes.bannedWords=data.bannedWords.map(s=>cleanText(s,50)).filter(Boolean);}
       await setDoc(env,'config','public',{...current,...changes});await audit(env,user.uid,'settings:update','site');return json({ok:true});
     }
   }
   if(section==='assets'&&method==='POST'){
     need(user,'manageSettings');const form=await request.formData();const kind=String(form.get('kind')||'');if(!['logo','background'].includes(kind))throw new Error('نوع الملف غير مسموح');
     const file=validFile(form.get('file'),'image');const key=`brand/${kind}-${id()}`;await putFile(env,key,file,'image');
     const current=await settings(env);await setDoc(env,'config','public',{...current,[kind]:key});
     if(current[kind]?.startsWith('brand/'))await env.FILES.delete(current[kind]).catch(()=>{});
     await audit(env,user.uid,'brand:update',kind);return json({ok:true,url:`/api/media/brand/${kind}`});
   }
   if(section==='plans'){
     need(user,'managePlans');if(method==='GET')return json(await plans(env));
     if(method==='PATCH'){
       const body=await parsed(request),current=await plans(env);
       for(const key of ['plus','premium','pro'])if(body[key]){
         const item=body[key];const num=Number(item.price),quota=Number(item.dailyMessages);
         if(!Number.isFinite(num)||num<0||num>10000||!Number.isInteger(quota)||quota<1||quota>100000)throw new Error('السعر أو حصة الرسائل غير صحيحة');
         current[key]={...current[key],price:num,dailyMessages:quota,perks:Array.isArray(item.perks)?item.perks.slice(0,16).map(s=>cleanText(s,100)).filter(Boolean):current[key].perks,canUpload:true};
       }
       // Free limit stays 50 as specified, unless future owner change through code.
       await setDoc(env,'config','plans',current);await audit(env,user.uid,'plans:update','all');return json({ok:true});
     }
   }
   if(section==='messages'){
     need(user,'manageChat');if(method==='DELETE'&&slugOk(path[2])){
       const message=await getDoc(env,'messages',path[2]);if(!message)return fail('الرسالة غير موجودة',404);
       await setDoc(env,'messages',message.id,{...stripInternal(message),text:'تم حذف الرسالة بواسطة الإدارة',deleted:true});
       await audit(env,user.uid,'message:delete',path[2]);return json({ok:true});
     }
   }
   if(section==='audit'&&method==='GET'){
     if(!isOwner(user))return fail('السجل للمالك فقط',403);
     return json(sorted(await listDocs(env,'audit',120)).map(stripInternal));
   }
 }
 return fail('المسار غير موجود',404);
}
export async function onApiRequest(context){
 try{
   if(!context.env.FILES) return fail('ربط R2 مفقود من إعدادات Cloudflare Pages',503);
   // Request-scoped token: never put user credentials in a shared module/global.
   const userToken=await verifyToken(context.request,context.env);
   const scopedEnv={...context.env,FIRESTORE_ID_TOKEN:userToken?(context.request.headers.get('Authorization')||'').slice(7):null};
   return await handle(context.request,scopedEnv,task=>context.waitUntil?.(task));
 }catch(err){
   if(!err?.status||err.status>=500)console.error('NEXBOTS API:',err?.stack||err);
   const permissionDenied=/missing or insufficient permissions|PERMISSION_DENIED|permission denied/i.test(String(err?.message||''));
   const safe=permissionDenied?'رفض Firebase العملية. تحقق من نشر قواعد Firestore المطابقة لنسخة الموقع ومن صلاحيات الحساب.':err.status?err.message:(err.message?.startsWith('أسرار خدمة')?'لم تكتمل إعدادات Firebase للخادم':err.message&&/^(ال|خطأ|تعذر|فشل|لا |سجّل|تم |مفتاح|انتهت|رمز|محتوى|حد|نوع|اسم|الصورة|الملف|رابط|الرسالة|لديك)/.test(err.message)?err.message:'حدث خطأ في الخادم، راجع الإعدادات');
   return fail(safe,err.status||(err instanceof TypeError?503:400));
 }
}
