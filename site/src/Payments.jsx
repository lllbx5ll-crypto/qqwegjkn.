import React,{useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {Banknote,CheckCircle2,AlertCircle,Crown,Copy,ImageUp,Clock3,X,Check,RefreshCw,ExternalLink,ShieldCheck,Wallet,ArrowLeft} from 'lucide-react';
import {api,planName} from './lib.js';

export const CURRENCIES=[{id:'YER',ar:'الريال اليمني',en:'Yemeni Rial',unit:'ر.ي'},{id:'SAR',ar:'الريال السعودي',en:'Saudi Riyal',unit:'ر.س'},{id:'USD',ar:'الدولار الأمريكي',en:'US Dollar',unit:'$'}];
const PLANS=['plus','premium','pro'];
const defaultConfig={accounts:{YER:'3156806675',SAR:'3107309798',USD:'3157185224'},prices:Object.fromEntries(PLANS.map(p=>[p,{YER:null,SAR:null,USD:null}])),unified:{enabled:false,recipientName:'',recipientNumber:''}};
const currencyById=id=>CURRENCIES.find(c=>c.id===id)||CURRENCIES[0];
const money=(price,currency)=>price===null||price===undefined||price===''?'غير محدد بعد':`${Number(price).toLocaleString('en-US',{maximumFractionDigits:2})} ${currencyById(currency).unit}`;
const logoUrl='https://alharf28.com/UploadControl/UploadImages_News/picture/2021/12/A12T_29_12_2021_11_37_47.jpg';
export function KuraimiLogo({size=56}){
 const [failed,setFailed]=useState(false);
 return <span className="kuraimi-logo" style={{width:size,height:size}}>{!failed?<img src={logoUrl} width={size} height={size} alt="شعار بنك الكريمي" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<Banknote size={Math.round(size*.49)} aria-label="بنك الكريمي"/>}</span>;
}
const formatDate=value=>{try{return new Date(value).toLocaleString('ar-YE',{dateStyle:'medium',timeStyle:'short'});}catch{return value||'—';}};
export function usePaymentConfig(){
 const [config,setConfig]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;api('payments/config').then(data=>{if(active){setConfig(data);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
 return {config:config||defaultConfig,error};
}
export function PaymentDialog({plan,config,app,onClose,onRequest,paymentMethod="kuraimi"}){
 const [currency,setCurrency]=useState('YER'),[file,setFile]=useState(null),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
 const isUnified=paymentMethod==='unified',account=String(isUnified?config.unified?.recipientNumber||'':config.accounts?.[currency]||''),price=config.prices?.[plan.key]?.[currency],available=typeof price==='number'&&price>0&&(isUnified?Boolean(config.unified?.enabled&&config.unified?.recipientName&&account):/^\d{6,22}$/.test(account));
 useEffect(()=>{if(!file){setPreview(null);return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
 useEffect(()=>{const key=e=>{if(e.key==='Escape'&&!busy)onClose();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[busy,onClose]);
 const copy=async()=>{try{await navigator.clipboard.writeText(account);app.toast('تم نسخ رقم الحساب');}catch{window.prompt('انسخ رقم الحساب',account);}};
 const submit=async e=>{
  e.preventDefault();setError('');
  if(!app.me){app.signIn();return;}
  if(!available){setError('لم يحدد المالك سعر هذه الباقة بهذه العملة بعد');return;}
  if(!file||file.size>2*1024*1024||(file.type&&!['image/jpeg','image/png','image/webp'].includes(file.type))){setError('اختر صورة إيصال JPG أو PNG أو WebP بحجم أقل من 2MB');return;}
  try{setBusy(true);const form=new FormData();form.append('paymentMethod',paymentMethod);form.append('plan',plan.key);form.append('currency',currency);form.append('amount',String(price));form.append('account',account);form.append('receipt',file);await api('payments/request',{method:'POST',body:form});setDone(true);await onRequest();}
  catch(ex){setError(ex.message||'تعذّر إرسال الطلب');}finally{setBusy(false);}
 };
 return <div className="modal-backdrop" onMouseDown={e=>e.currentTarget===e.target&&!busy&&onClose()}><div className="panel modal kuraimi-dialog" role="dialog" aria-modal="true" aria-label={'الدفع عبر '+(isUnified?'الشبكة الموحدة':'الكريمي')+' - '+plan.name}>
  <header className="kuraimi-heading"><button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="إغلاق"><X size={19}/></button><div className="kuraimi-brand"><div><span className="eyebrow">SECURE MANUAL TRANSFER</span><h2>{isUnified?'الدفع عبر الشبكة الموحدة':'الدفع عبر الكريمي'}</h2><small>اشتراك {plan.name} لمدة 30 يوماً</small></div>{isUnified?<span className="unified-mark">الشبكة الموحدة</span>:<KuraimiLogo size={64}/>}</div></header>
  {done?<div className="kuraimi-done"><CheckCircle2 size={50}/><h3>تم إرسال طلب الاشتراك بنجاح</h3><p>طلبك الآن قيد المراجعة. يُرجى الانتظار، وتستغرق المراجعة عادةً من 3 إلى 5 ساعات. سيُفعّل الاشتراك بعد تأكيد المالك وصول المبلغ.</p><button type="button" className="btn btn-primary full" onClick={onClose}>حسناً، متابعة</button></div>:
  <form onSubmit={submit} className="kuraimi-form">
   <div className="payment-step"><span>01</span><strong>اختر عملة الدفع <small>Select currency</small></strong></div>
   <div className="currency-options" role="radiogroup" aria-label="عملة الدفع">{CURRENCIES.map(c=><button type="button" key={c.id} role="radio" aria-checked={currency===c.id} className={'currency-choice '+(currency===c.id?'selected':'')} onClick={()=>{setCurrency(c.id);setError('');}}><strong>{c.id}</strong><span>{c.ar}</span><small>{c.en}</small></button>)}</div>
   <div className="transfer-ticket"><div><span>المبلغ المطلوب</span><strong className="transfer-amount">{money(price,currency)}</strong></div><div className="transfer-account"><span>{isUnified?'رقم التحويل عبر الشبكة الموحدة':'رقم حساب الكريمي'} — {currency}</span><div><strong dir="ltr">{account||'غير متاح'}</strong><button type="button" onClick={copy} disabled={!account} title="نسخ رقم الحساب"><Copy size={17}/> نسخ</button></div></div>{isUnified&&<small>اسم المستفيد: {config.unified?.recipientName}</small>}<small>حوّل المبلغ إلى بيانات التحويل المعروضة فقط.</small></div>
   <div className="payment-step"><span>02</span><strong>أرفق صورة إيصال التحويل <small>Upload receipt</small></strong></div>
   <label className="receipt-zone"><ImageUp size={26}/><strong>{file?file.name:'اختر صورة الإيصال من جهازك'}</strong><small>JPG / PNG / WebP — حتى 2MB</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setFile(e.target.files?.[0]||null)} aria-label="صورة إيصال التحويل"/></label>
   {preview&&<img className="receipt-preview" src={preview} alt="معاينة الإيصال"/>}
   {error&&<p className="payment-error" role="alert"><AlertCircle size={16}/>{error}</p>}
   <p className="kuraimi-disclaimer"><ShieldCheck size={16}/> ستتم مراجعة طلبك يدوياً بعد التحقق من وصول التحويل. الإيصال وحده لا يفعّل الاشتراك، وقد يُظهر تطبيق البنك اسم المستفيد.</p>
   <button type="submit" className="btn btn-primary full kuraimi-submit" disabled={busy||!available||!file}>{busy?'جارٍ إرسال الطلب...':'إرسال طلب الاشتراك'} <ArrowLeft size={17}/></button>
  </form>}
 </div></div>;
}
export function PaymentHistory({app,refreshSignal=0}){
 const [items,setItems]=useState([]),[error,setError]=useState(''),[everLoaded,setEverLoaded]=useState(false);
 const statusRef=useRef({});
 useEffect(()=>{
  if(!app.me)return;
  let active=true;
  const load=async()=>{
   try{const data=await api('payments/my');if(!active)return;
    const rows=Array.isArray(data)?data:[];
    const previous=statusRef.current;
    if(Object.keys(previous).length&&rows.some(r=>r.status==='approved'&&previous[r.id]==='pending')){
     app.toast('تم تأكيد الدفع وتفعيل اشتراكك بنجاح!');app.refreshMe();
    }
    statusRef.current=Object.fromEntries(rows.map(r=>[r.id,r.status]));setItems(rows);setError('');setEverLoaded(true);
   }catch(e){if(active)setError(e.message);}
  };
  load();const timer=setInterval(()=>{if(!document.hidden)load();},25000);
  return()=>{active=false;clearInterval(timer);};
 },[app.me?.uid,refreshSignal]);
 if(!app.me)return null;
 return <section className="panel payment-history"><div className="panel-head"><h3>طلبات اشتراكاتي</h3><Clock3 size={19}/></div>{error&&<p className="payment-error">{error}</p>}{everLoaded&&!items.length&&<p className="subtle">لم تُرسل أي طلب دفع بعد.</p>}{items.slice(0,8).map(r=><div className="payment-history-row" key={r.id}><div><strong>{planName(r.plan)} — {money(r.amount,r.currency)}</strong><small>{formatDate(r.createdAt)}</small></div><span className={'payment-status '+r.status}>{r.status==='approved'?'تم تأكيد الدفع وتفعيل الاشتراك':r.status==='rejected'?'مرفوض': 'قيد المراجعة (عادةً 3–5 ساعات)'}</span>{r.status==='rejected'&&r.rejectionReason&&<small>{r.rejectionReason}</small>}</div>)}</section>;
}
function ReceiptViewer({id}){
 const [src,setSrc]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>()=>{if(src)URL.revokeObjectURL(src);},[src]);
 const open=async()=>{try{setBusy(true);setError('');const response=await api('payment-receipts/'+id,{raw:true});if(!response.ok)throw Error('تعذّر عرض الإيصال');const blob=await response.blob();setSrc(URL.createObjectURL(blob));}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <div className="receipt-viewer">{!src?<button type="button" className="mini-btn" onClick={open} disabled={busy}><ImageUp size={16}/>{busy?'يفتح...':'عرض الإيصال'}</button>:<img src={src} alt="صورة إيصال التحويل المرفوع" onClick={()=>window.open(src,'_blank','noopener,noreferrer')}/>} {error&&<span className="payment-error">{error}</span>}</div>;
}
export function AdminPaymentPanel({app}){
 const [config,setConfig]=useState(null),[items,setItems]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[filter,setFilter]=useState('pending');
 const load=async()=>{try{const [cfg,data]=await Promise.all([api('admin/payments/config'),api('admin/payments')]);setConfig(cfg);setItems(data);setError('');}catch(e){setError(e.message);}};
 useEffect(()=>{load();},[]);
 const setUnified=(key,value)=>setConfig(p=>({...p,unified:{...p.unified,[key]:value}}));
 const setAccount=(cur,value)=>setConfig(p=>({...p,accounts:{...p.accounts,[cur]:value}}));
 const setPrice=(plan,cur,value)=>setConfig(p=>({...p,prices:{...p.prices,[plan]:{...p.prices[plan],[cur]:value===''?null:Number(value)}}}));
 const save=async()=>{try{setBusy(true);await api('admin/payments/config',{method:'PATCH',body:config});app.toast('تم حفظ أسعار العملات وأرقام حسابات الكريمي');await load();}catch(e){app.toast(e.message,'error')}finally{setBusy(false);}};
 const review=async(r,action)=>{const accept=action==='approve';if(accept&&!window.confirm(`هل تحققت من وصول ${money(r.amount,r.currency)} فعلياً إلى حسابك؟\nلا تعتمد على صورة الإيصال وحدها.`))return;
  let reason='';if(!accept){const answer=window.prompt('سبب رفض الطلب:', 'لم يتم تأكيد وصول التحويل');if(answer===null)return;reason=answer;}
  try{setBusy(true);await api('admin/payments/'+r.id,{method:'PATCH',body:{action,reason}});app.toast(accept?'تم تأكيد الدفع وتفعيل الاشتراك':'تم رفض الطلب');await load();}catch(e){app.toast(e.message,'error')}finally{setBusy(false);}};
 return <div className="payment-admin" dir="rtl"><div className="panel form-panel"><div className="panel-head"><h3>الدفع عبر بنك الكريمي</h3><KuraimiLogo size={54}/></div><p className="subtle">كل عملة لها رقم حساب وسعر مستقل لكل باقة. لن يُقبل الدفع بالعملات التي لم تحدد سعرها. اسم صاحب الحساب لا يظهر للمستخدمين.</p>
 {config&&<><div className="panel unified-admin"><h4>الدفع عبر الشبكة الموحدة</h4><p className="subtle">جهزنا وسيلة الدفع، وستظل مخفية عن المستخدمين حتى تدخل بيانات المستفيد وتفعّلها. لا نعرض شعاراً غير موثق.</p><label className="field"><span>اسم المستفيد</span><input value={config.unified?.recipientName||''} maxLength={100} onChange={e=>setUnified('recipientName',e.target.value)} placeholder="اسم المستفيد كما في الحوالة"/></label><label className="field"><span>رقم التحويل / الهاتف</span><input dir="ltr" value={config.unified?.recipientNumber||''} maxLength={45} onChange={e=>setUnified('recipientNumber',e.target.value)} placeholder="أدخل الرقم لاحقاً"/></label><label className="unified-enable"><input type="checkbox" checked={Boolean(config.unified?.enabled)} onChange={e=>setUnified('enabled',e.target.checked)}/> تفعيل الشبكة الموحدة للمستخدمين</label></div><div className="kuraimi-admin-accounts">{CURRENCIES.map(c=><label className="field" key={c.id}><span>حساب {c.ar} ({c.id})</span><input dir="ltr" inputMode="numeric" value={config.accounts[c.id]||''} onChange={e=>setAccount(c.id,e.target.value)}/></label>)}</div><div className="payment-admin-prices"><h4>أسعار الاشتراك الشهري — حدّد كل مبلغ بنفسك</h4><div className="payment-price-rows">{PLANS.map(p=><div key={p} className="payment-price-row"><strong>{planName(p)}</strong>{CURRENCIES.map(c=><label key={c.id} className="field"><span>{c.id} ({c.unit})</span><input type="number" min="0.01" max="100000000" step="0.01" placeholder="غير محدد" value={config.prices?.[p]?.[c.id]??''} onChange={e=>setPrice(p,c.id,e.target.value)}/></label>)}</div>)}</div></div><button type="button" className="btn btn-primary" disabled={busy} onClick={save}><Check size={17}/> {busy?'يحفظ...':'حفظ إعدادات الدفع والأسعار'}</button></>}
 </div><section className="panel admin-list"><div className="panel-head"><h3>طلبات الاشتراكات والتحويلات</h3><div className="item-actions"><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="pending">قيد المراجعة</option><option value="approved">المقبولة</option><option value="rejected">المرفوضة</option><option value="all">جميع الطلبات</option></select><button className="mini-btn" onClick={load}><RefreshCw size={15}/> تحديث</button></div></div>{error&&<p className="payment-error">{error}</p>}{!items.filter(r=>filter==='all'||r.status===filter).length&&<p className="subtle">لا توجد طلبات في هذا القسم.</p>}{items.filter(r=>filter==='all'||r.status===filter).map(r=><div className="admin-item payment-admin-item" key={r.id}><div className="item-info"><strong><Link to={'/u/'+r.userUid}>{r.userName||'عضو NEXBOTS'}</Link> — {planName(r.plan)}</strong><p><b>{money(r.amount,r.currency)}</b> · {r.paymentMethod==='unified'?'الشبكة الموحدة':'الكريمي'} · الحساب <span dir="ltr">{r.account}</span></p><small>{formatDate(r.createdAt)} · {r.status==='pending'?'قيد المراجعة':r.status==='approved'?'تم التفعيل':'مرفوض'}</small>{r.rejectionReason&&<small>سبب الرفض: {r.rejectionReason}</small>}<ReceiptViewer id={r.id}/></div><div className="item-actions">{r.status==='pending'&&<><button type="button" className="mini-btn success" disabled={busy} onClick={()=>review(r,'approve')}><Check size={16}/> تأكيد الدفع</button><button type="button" className="mini-btn danger" disabled={busy} onClick={()=>review(r,'reject')}><X size={16}/> رفض</button></>}</div></div>)}</section></div>;
}
