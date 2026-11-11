// NEXBOTS / Al-Kuraimi manual bank transfer with owner-only confirmation.
// No bank API: a receipt is NOT proof of payment, and cannot activate a plan.
import {getDoc,setDoc,listDocs,queryDocs,commit,updateWrite} from './firestore.js';
import {imageTypeOrThrow} from './media-validation.js';

export const PAYMENT_CURRENCIES=['YER','SAR','USD'];
export const PAYMENT_PLANS=['plus','premium','pro'];
export const defaultPaymentConfig={
 accounts:{YER:'3156806675',SAR:'3107309798',USD:'3157185224'},
 // Owner must enter actual prices before bank transfer requests can be submitted.
 prices:Object.fromEntries(PAYMENT_PLANS.map(p=>[p,{YER:null,SAR:null,USD:null}])),
 unified:{enabled:false,recipientName:'',recipientNumber:''}
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const err=(message,status=400)=>json({error:message},status);
const noPrivate=v=>{if(!v)return v;const {id,_updateTime,...fields}=v;return fields;};
const notOwner=(user)=>user?.role!=='owner';
const cents=(n)=>Math.round(n*100)/100;
const safeAmount=(value)=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=100000000&&cents(value)===value;
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
async function getSettings(env){
 const data=await getDoc(env,'config','payment');
 return {accounts:{...defaultPaymentConfig.accounts,...(data?.accounts||{})},prices:Object.fromEntries(PAYMENT_PLANS.map(plan=>[plan,{...defaultPaymentConfig.prices[plan],...(data?.prices?.[plan]||{})}])),unified:{...defaultPaymentConfig.unified,...(data?.unified||{})}};
}
function checkConfig(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw Object.assign(new Error('إعدادات الدفع غير صحيحة'),{status:400});
 const accounts={},prices={};
 for(const cur of PAYMENT_CURRENCIES){
  const number=String(data.accounts?.[cur]??'').trim();
  if(!/^\d{6,22}$/.test(number))throw Object.assign(new Error('رقم حساب '+cur+' غير صالح'),{status:400});
  accounts[cur]=number;
 }
 for(const plan of PAYMENT_PLANS){
  prices[plan]={};
  for(const cur of PAYMENT_CURRENCIES){
   const raw=data.prices?.[plan]?.[cur];
   const amount=raw===null||raw===undefined||raw===''?null:Number(raw);
   if(amount!==null&&!safeAmount(amount))throw Object.assign(new Error(`سعر ${plan} بعملة ${cur} غير صحيح`),{status:400});
   prices[plan][cur]=amount;
  }
 }
 const recipientName=String(data.unified?.recipientName||'').trim();
 const recipientNumber=String(data.unified?.recipientNumber||'').trim();
 const enabled=Boolean(data.unified?.enabled);
 if(recipientName.length>100||recipientNumber.length>45)throw Object.assign(new Error('بيانات الشبكة الموحدة طويلة جداً'),{status:400});
 if(enabled&&(!recipientName||!recipientNumber))throw Object.assign(new Error('أدخل اسم ورقم مستفيد الشبكة الموحدة قبل تفعيلها'),{status:400});
 return {accounts,prices,unified:{enabled,recipientName,recipientNumber}};
}
async function getUser(request,env,helpers){return (await helpers.identityUser(request,env)).user;}
export async function handlePayments(request,env,path,method,helpers){
 const route=path[0];
 if(route!=='payments'&&route!=='payment-receipts'&&!(route==='admin'&&path[1]==='payments'))return null;
 if(route==='payments'&&path[1]==='config'&&method==='GET'&&path.length===2){
  const config=await getSettings(env);
  if(!config.unified.enabled)config.unified={enabled:false,recipientName:'',recipientNumber:''};
  return json(config);
 }
 const user=await getUser(request,env,helpers);
 if(route==='payments'&&path[1]==='my'&&method==='GET'&&path.length===2){
  const records=await queryDocs(env,'paymentRequests','userUid',user.uid,80);
  return json(records.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(({receiptKey,_updateTime,...r})=>r));
 }
 if(route==='payments'&&path[1]==='request'&&method==='POST'&&path.length===2){
  const length=Number(request.headers.get('content-length')||0);
  if(length>3*1024*1024)return err('حجم الإيصال أكبر من الحد المسموح',413);
  const form=await request.formData();
  const plan=String(form.get('plan')||''),currency=String(form.get('currency')||''),methodName=String(form.get('paymentMethod')||'kuraimi');
  if(!['kuraimi','unified'].includes(methodName))return err('طريقة الدفع غير صحيحة');
  if(!PAYMENT_PLANS.includes(plan)||!PAYMENT_CURRENCIES.includes(currency))return err('الباقة أو العملة غير صحيحة');
  const cfg=await getSettings(env),amount=cfg.prices[plan][currency],account=methodName==='unified'?cfg.unified.recipientNumber:cfg.accounts[currency];
  if(methodName==='unified'&&(!cfg.unified.enabled||!cfg.unified.recipientName||!cfg.unified.recipientNumber))return err('الدفع عبر الشبكة الموحدة غير مفعل حالياً');
  if(!safeAmount(amount)||(methodName==='kuraimi'&&!/^\d{6,22}$/.test(account))||(methodName==='unified'&&!account))return err('سعر هذه الباقة لم يحدده المالك بعد. جرّب لاحقاً');
  if(Number(form.get('amount'))!==amount||String(form.get('account'))!==account)return err('تغيّر السعر أو رقم الحساب أثناء الدفع؛ حدّث الصفحة وتحقق من المعلومات قبل التحويل',409);
  const receipt=form.get('receipt');
  if(!receipt||typeof receipt.arrayBuffer!=='function'||!receipt.size||receipt.size>2*1024*1024)return err('ارفع صورة إيصال JPG أو PNG أو WebP بحجم أقل من 2MB');
  const bytes=new Uint8Array(await receipt.arrayBuffer());
  const mime=imageTypeOrThrow(bytes);
  if(!['image/jpeg','image/png','image/webp'].includes(mime))return err('صيغة الإيصال غير مدعومة');
  const existing=await queryDocs(env,'paymentRequests','userUid',user.uid,60);
  if(existing.some(p=>p.status==='pending'))return err('لديك طلب دفع قيد المراجعة. انتظر الرد قبل إرسال طلب آخر',409);
  const requestId=crypto.randomUUID(),receiptKey=`payment-receipts/${user.uid}/${requestId}`;
  await env.FILES.put(receiptKey,bytes,{httpMetadata:{contentType:mime},customMetadata:{userUid:user.uid,requestId}});
  const doc={userUid:user.uid,userName:user.displayName||'عضو NEXBOTS',plan,currency,amount,account,paymentMethod:methodName,receiptKey,mime,status:'pending',createdAt:new Date().toISOString(),reviewedAt:null,reviewedBy:null,rejectionReason:''};
  try{await commit(env,[updateWrite(env,'paymentRequests',requestId,doc,{exists:false})]);}
  catch(e){await env.FILES.delete(receiptKey).catch(()=>{});throw e;}
  return json({id:requestId,status:'pending',plan,currency,amount,createdAt:doc.createdAt},201);
 }
 if(route==='payment-receipts'&&path.length===2&&method==='GET'&&validId(path[1])){
  const payment=await getDoc(env,'paymentRequests',path[1]);
  if(!payment)return err('الإيصال غير موجود',404);
  if(notOwner(user)&&payment.userUid!==user.uid)return err('لا يمكن عرض هذا الإيصال',403);
  if(!payment.receiptKey?.startsWith(`payment-receipts/${payment.userUid}/`))return err('مسار الإيصال غير صحيح',404);
  const object=await env.FILES.get(payment.receiptKey);
  if(!object)return err('ملف الإيصال غير متاح',404);
  return new Response(object.body,{headers:{'content-type':payment.mime||'image/jpeg','cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
 }
 if(route==='admin'&&path[1]==='payments'){
  if(notOwner(user))return err('طلبات الدفع مخصصة للمالك فقط',403);
  if(path[2]==='config'){
   if(method==='GET'&&path.length===3)return json(await getSettings(env));
   if(method==='PATCH'&&path.length===3){
    const config=checkConfig(await request.json().catch(()=>null));
    await setDoc(env,'config','payment',config);
    return json({ok:true,config});
   }
  }
  if(method==='GET'&&path.length===2){
   const docs=(await listDocs(env,'paymentRequests',150)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
   return json(docs.map(({receiptKey,_updateTime,...p})=>p));
  }
  if(method==='PATCH'&&path.length===3&&validId(path[2])){
   const body=await request.json().catch(()=>null),action=body?.action;
   if(!['approve','reject'].includes(action))return err('اختر قبول أو رفض طلب الدفع');
   const payment=await getDoc(env,'paymentRequests',path[2]);
   if(!payment)return err('طلب الدفع غير موجود',404);
   if(payment.status!=='pending')return err('سبق مراجعة هذا الطلب. لا يمكن تفعيل الدفع مرتين',409);
   if(action==='approve'){
    const receipt=await env.FILES.head(payment.receiptKey);
    if(!receipt||receipt.size<=0||receipt.size>2*1024*1024||receipt.customMetadata?.userUid!==payment.userUid||receipt.customMetadata?.requestId!==payment.id)return err('لا يوجد إيصال محفوظ موثوق لهذا الطلب؛ لا يمكن تفعيله',409);
   }
   const now=new Date(),reviewedAt=now.toISOString();
   const update={...noPrivate(payment),status:action==='approve'?'approved':'rejected',reviewedAt,reviewedBy:user.uid,rejectionReason:action==='reject'?String(body?.reason||'لم يتم تأكيد وصول التحويل').slice(0,200):''};
   const writes=[updateWrite(env,'paymentRequests',payment.id,update,{updateTime:payment._updateTime})];
   let endsAt=null;
   if(action==='approve'){
    const target=await getDoc(env,'users',payment.userUid);
    if(!target)return err('حساب صاحب الطلب غير موجود',404);
    const oldEnd=target.plan===payment.plan?Date.parse(target.planEndsAt||'')||0:0;
    const start=Math.max(now.getTime(),oldEnd);
    endsAt=new Date(start+30*86400000).toISOString();
    const updated={...noPrivate(target),plan:payment.plan,planStartsAt:reviewedAt,planStartsAtMillis:now.getTime(),planEndsAt:endsAt,planEndsAtMillis:Date.parse(endsAt),lastPaymentRequestId:payment.id,updatedAt:reviewedAt};
    writes.push(updateWrite(env,'users',target.uid,updated,{updateTime:target._updateTime}));
   }
   await commit(env,writes);
   return json({ok:true,status:update.status,plan:payment.plan,endsAt});
  }
 }
 return err('مسار الدفع غير متاح',404);
}
