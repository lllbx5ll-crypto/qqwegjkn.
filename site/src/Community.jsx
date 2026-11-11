import React,{useEffect,useState,useRef,useCallback}from 'react';
import {Link,useLocation,useNavigate}from 'react-router-dom';
import {Search,Send,ShieldBan,Flag,Heart,Eye,Trash2,Plus,AtSign,MessageCircle,Check,CheckCheck,ArrowRight,ArrowLeft,ImagePlus,Video,Type,X,Crown,RefreshCw,LockKeyhole,BadgeCheck} from 'lucide-react';
import {api,uploadFile,stageAsset,stageStoryVideo,db} from './lib.js';
import {collection,query,where,limit,onSnapshot} from 'firebase/firestore';
import {chatMessageParts} from './chat-links.js';
import {badgeKind} from './badges.js';

function MessageText({text}){return <span dir="auto" className="chat-message-text">{chatMessageParts(text||'').map((p,i)=>p.type==='link'?<a key={i} className="chat-external-link" href={p.href} rel="nofollow noopener noreferrer ugc" target="_blank">{p.text}</a>:<React.Fragment key={i}>{p.text}</React.Fragment>)}</span>;}
function VerifiedBadge({user}){const kind=badgeKind(user);return kind?<BadgeCheck className={'nx-verified '+(kind==='white'?'nx-verified-white':'nx-verified-blue')} size={17} aria-label={kind==='blue'?'حساب موثق بالعلامة الزرقاء':'شارة العضوية البيضاء'}/>:null;}
function avatarFor(user){if(!user?.avatar)return '/nexbots-logo.webp';if(user.avatar.startsWith('profiles/'))return `/api/media/profile/${encodeURIComponent(user.uid)}/avatar`;return user.avatar;}
function StoryCircle({user,seen,open}){return <button type="button" className={'story-bubble '+(seen?'story-seen':'')} onClick={open}><span className="story-ring"><img src={avatarFor(user)} alt=""/></span><small className="story-owner-name">{user?.username?'@'+user.username:user?.displayName||'عضو'} <VerifiedBadge user={user}/></small></button>}
function StoryComposer({me,toast,onCreated,close}){const[type,setType]=useState('text'),[text,setText]=useState(''),[file,setFile]=useState(null),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0);
 const submissionId=useRef(crypto.randomUUID());const submit=async e=>{e.preventDefault();if(type!=='text'&&!file)return toast('اختر الوسائط أولاً','error');try{setBusy(true);if(type==='video'){if(file.type!=='video/mp4'&&!/\.mp4$/i.test(file.name))throw Error('اختر فيديو MP4');if(file.size>12*1024*1024)throw Error('حجم الفيديو لا يتجاوز 12MB');}const form=new FormData();form.append('submissionId',submissionId.current);form.append('type',type);form.append('text',text);if(file){if(type==='video')await stageStoryVideo(submissionId.current,file,setProgress);else await stageAsset('stories',submissionId.current,'media',file,{storyType:type});form.append('stagedAssets','1');form.append('mediaName',file.name);}await uploadFile('stories',form);toast('تم نشر الستوري لمدة 24 ساعة');await onCreated();close();}catch(e){toast(e.message,'error');}finally{setBusy(false);}};
 return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><form onSubmit={submit} className="panel modal community-dialog" role="dialog" aria-label="إضافة ستوري"><div className="panel-head"><h3>إضافة ستوري جديدة</h3><button className="icon-button" type="button" onClick={close}><X size={20}/></button></div><div className="story-format">{[['text','نص',Type],['image','صورة',ImagePlus],['video','فيديو',Video]].map(([k,l,I])=><button type="button" key={k} className={type===k?'selected':''} onClick={()=>{setType(k);setFile(null);setProgress(0);submissionId.current=crypto.randomUUID()}}><I size={17}/>{l}</button>)}</div><label className="field"><span>النص أو الوصف</span><textarea value={text} maxLength={600} rows={3} placeholder="شارك فكرة أو لحظة..." onChange={e=>setText(e.target.value)}/></label>{type!=='text'&&<label className="field"><span>{type==='video'?'فيديو MP4 حتى 15 ثانية و12MB':'صورة حتى 2MB'}</span><input type="file" accept={type==='video'?'video/mp4':'image/png,image/jpeg,image/webp'} onChange={e=>{setFile(e.target.files?.[0]||null);setProgress(0);submissionId.current=crypto.randomUUID();}}/></label>}{busy&&type==='video'&&<p className="story-upload-progress" role="status">{progress<100?`جاري رفع الفيديو بأمان... ${progress}%`:'تم رفع الفيديو، جارٍ نشر الستوري...'}</p>}<button className="btn btn-primary full" disabled={busy}>{busy?'ينشر...':'نشر لمدة 24 ساعة'}</button></form></div>;
}
function StoryViewer({stories,selected,me,toast,close,reload}){const [index,setIndex]=useState(selected),[busy,setBusy]=useState(false);const story=stories[index];
 useEffect(()=>{if(story?.id)api(`stories/${story.id}/view`,{method:'POST'}).catch(()=>{});},[story?.id]);
 useEffect(()=>{if(!story)return;const remaining=Date.parse(story.expiresAt)-Date.now();if(remaining<=0){close();return;}const timer=setTimeout(close,remaining);return()=>clearTimeout(timer);},[story?.id]);
 if(!story)return null;
 const likes=async()=>{try{setBusy(true);await api(`stories/${story.id}/like`,{method:story.viewerLiked?'DELETE':'POST'});await reload();toast(story.viewerLiked?'تم إلغاء الإعجاب':'أعجبتك القصة');}catch(e){toast(e.message,'error');}finally{setBusy(false);}};
 const remove=async()=>{if(!confirm('حذف هذه الستوري نهائياً؟'))return;try{await api(`stories/${story.id}`,{method:'DELETE'});await reload();close();toast('تم حذف الستوري ووسائطها');}catch(e){toast(e.message,'error');}};
 return <div className="modal-backdrop story-viewer-backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="story-viewer panel" role="dialog" aria-label="عرض ستوري"><div className="story-viewer-top"><img src={avatarFor(story.owner)} alt=""/><strong className="verified-name">{story.owner?.displayName} <VerifiedBadge user={story.owner}/></strong><small>{Math.max(0,Math.ceil((Date.parse(story.expiresAt)-Date.now())/3600000))} ساعة متبقية</small><button type="button" onClick={close} className="icon-button" aria-label="إغلاق"><X size={19}/></button></div><div className="story-content">{story.type==='image'?<img src={`/api/media/story/${story.id}`} alt="ستوري"/>:story.type==='video'?<video src={`/api/media/story/${story.id}`} controls playsInline autoPlay preload="metadata"/>:<div className="story-text-only">{story.text}</div>}{story.type!=='text'&&story.text&&<p>{story.text}</p>}</div><div className="story-viewer-actions"><button className={'btn btn-sm '+(story.viewerLiked?'btn-liked':'btn-outline')} disabled={busy} onClick={likes}><Heart size={17} fill={story.viewerLiked?'currentColor':'none'}/> {story.viewerLiked?'أعجبني':'إعجاب'}</button>{story.ownerUid===me.uid&&<><span className="story-stat"><Eye size={16}/>{story.viewsCount||0} مشاهدة</span><span className="story-stat"><Heart size={16}/>{story.likesCount||0} إعجاب</span><button className="btn btn-outline btn-sm" onClick={remove}><Trash2 size={15}/> حذف</button></>}</div><div className="story-viewer-switch"><button onClick={()=>setIndex(Math.max(0,index-1))} disabled={index===0}><ArrowRight size={20}/> السابق</button><button onClick={()=>setIndex(Math.min(stories.length-1,index+1))} disabled={index===stories.length-1}>التالي <ArrowLeft size={20}/></button></div></div></div>
}
const validDocId = value => typeof value==='string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function verifiedThread(value){
 if(!value || typeof value!=='object')return null;
 const id=String(value.id||value.threadId||'').trim();
 const other=value.other;
 if(!validDocId(id)||!validDocId(other?.uid))return null;
 return {...value,id,other:{...other,displayName:other.displayName||other.username||'عضو NEXBOTS'}};
}
function DmConversation({thread,me,toast,onBack}){
 const [items,setItems]=useState([]),[text,setText]=useState(''),[busy,setBusy]=useState(false),
       [error,setError]=useState(''),[blocked,setBlocked]=useState(false),[report,setReport]=useState(false),[reason,setReason]=useState('');
 const ref=useRef(null);
 const valid=validDocId(thread?.id)&&validDocId(thread?.other?.uid);
 const reload=useCallback(async()=>{
  if(!valid)return;
  try{
   const r=await api(`private/threads/${encodeURIComponent(thread.id)}/messages`);
   setItems(Array.isArray(r)?r.filter(x=>x && typeof x.id==='string'):[]);
   setError('');
   api(`private/threads/${encodeURIComponent(thread.id)}/read`,{method:'POST'}).catch(()=>{});
  }catch(e){setError(e.message||'تعذر تحديث المحادثة');}
 },[thread.id,valid]);
 useEffect(()=>{
  if(!valid)return;
  let active=true;
  api(`blocks/${encodeURIComponent(thread.other.uid)}`).then(r=>{if(active)setBlocked(!!r?.blocked)}).catch(()=>{});
  return ()=>{active=false};
 },[thread.other.uid,valid]);
 useEffect(()=>{
  if(!valid)return;
  reload();const timer=setInterval(()=>{if(!document.hidden)reload()},8500);
  return ()=>clearInterval(timer);
 },[reload,valid]);
 useEffect(()=>{if(ref.current)ref.current.scrollTop=ref.current.scrollHeight},[items.length]);
 const send=async e=>{
  e.preventDefault();const message=text.trim();if(!message||blocked||busy||!valid)return;
  try{
   setBusy(true);await api(`private/threads/${encodeURIComponent(thread.id)}/messages`,{method:'POST',body:{text:message}});
   setText('');await reload();
  }catch(e){toast(e.message||'تعذّر إرسال الرسالة','error');await reload();}
  finally{setBusy(false)}
 };
 const toggleBlock=async()=>{
  if(!valid)return;
  if(!blocked&&!confirm(`حظر ${thread.other.displayName}؟ لن تتمكنا من تبادل رسائل جديدة حتى إلغاء الحظر.`))return;
  try{await api(`blocks/${encodeURIComponent(thread.other.uid)}`,{method:blocked?'DELETE':'POST'});setBlocked(!blocked);toast(blocked?'تم إلغاء الحظر':'تم حظر العضو')}
  catch(e){toast(e.message,'error')}
 };
 const sendReport=async()=>{
  if(!valid)return;
  try{await api('reports',{method:'POST',body:{targetUid:thread.other.uid,reason}});setReport(false);setReason('');toast('وصل البلاغ إلى لوحة الإدارة')}
  catch(e){toast(e.message,'error')}
 };
 if(!valid)return <div className="panel community-conversation-error"><p role="alert">تعذّر قراءة معرّف المحادثة. ارجع إلى قائمة المحادثات وافتح الشخص مرة أخرى.</p><button className="btn btn-outline" onClick={onBack}><ArrowRight size={18}/> العودة إلى الخاص</button></div>;
 return <div className="panel dm-shell dm-conversation-screen">
  <div className="dm-heading">
   <button type="button" className="icon-button dm-back" onClick={onBack} aria-label="العودة إلى المحادثات"><ArrowRight size={21}/></button>
   <Link to={'/u/'+encodeURIComponent(thread.other.uid)} className="dm-person"><img src={avatarFor(thread.other)} alt=""/><span><span className="verified-name">{thread.other.displayName} <VerifiedBadge user={thread.other}/></span><small>{thread.other.username?'@'+thread.other.username:'محادثة خاصة'}</small></span></Link>
   <button type="button" className="btn btn-outline btn-sm" onClick={toggleBlock}><ShieldBan size={17}/>{blocked?'إلغاء الحظر':'حظر'}</button>
   <button type="button" title="إبلاغ عن هذا الحساب" className="btn btn-outline btn-sm" onClick={()=>setReport(v=>!v)}><Flag size={16}/></button>
  </div>
  {report&&<div className="dm-report"><label className="field"><span>سبب الإبلاغ (10 أحرف على الأقل)</span><textarea value={reason} maxLength={400} onChange={e=>setReason(e.target.value)} placeholder="صف المخالفة..."/></label><button type="button" className="btn btn-primary btn-sm" disabled={reason.trim().length<10} onClick={sendReport}>إرسال البلاغ للإدارة</button></div>}
  {blocked&&<p className="notice">المراسلة متوقفة مع هذا الحساب حتى إلغاء الحظر.</p>}
  {error&&<div role="alert" className="notice error dm-inline-error"><span>{error}</span><button className="mini-btn" onClick={reload}><RefreshCw size={14}/> إعادة المحاولة</button></div>}
  <div className="dm-messages" ref={ref}>
   {items.length===0?<div className="dm-placeholder"><MessageCircle size={38}/><p>ابدأ محادثة خاصة مع {thread.other.displayName}</p></div>:items.map(m=>
    <div key={m.id} className={'dm-message '+(m.uid===me.uid?'sent':'received')}>
     <MessageText text={m.text}/><small>{Number.isFinite(Date.parse(m.createdAt))?new Date(m.createdAt).toLocaleTimeString('ar',{hour:'2-digit',minute:'2-digit'}):''} {m.uid===me.uid&&(m.readAt?<><CheckCheck size={14}/> تمت القراءة</>:<><Check size={14}/> لم تُقرأ</>)}</small>
    </div>)}
  </div>
  <form onSubmit={send} className="dm-compose"><input value={text} maxLength={600} disabled={blocked||busy} onChange={e=>setText(e.target.value)} placeholder={blocked?'المراسلة معطلة بسبب الحظر':'اكتب رسالة خاصة...'}/><button type="submit" className="btn btn-primary" disabled={!text.trim()||busy||blocked}><Send size={19}/>{busy?'يرسل...':'إرسال'}</button></form>
 </div>;
}
export function CommunityHub({app}){
 const {me,toast}=app;
 const loc=useLocation(),navigate=useNavigate();
 const threadRoute=loc.pathname.match(/^\/private\/t\/([A-Za-z0-9_-]{1,128})$/);
 const activeId=threadRoute?.[1]||'';
 const [stories,setStories]=useState([]),[storyOpen,setStoryOpen]=useState(null),[createStory,setCreateStory]=useState(false),
       [threads,setThreads]=useState([]),[q,setQ]=useState(''),[results,setResults]=useState([]),
       [chosen,setChosen]=useState(null),[busy,setBusy]=useState(false),[opening,setOpening]=useState(false),[error,setError]=useState('');
 const refreshStories=useCallback(async()=>{
  try{const result=await api('stories');setStories(Array.isArray(result)?result.filter(s=>s&&typeof s.id==='string'&&typeof s.ownerUid==='string'):[])}
  catch(e){setError(e.message)}
 },[]);
 const knownThreadIds=useRef(new Set());
 const refreshThreads=useCallback(async()=>{
  try{
   const result=await api('private/threads');
   const list=Array.isArray(result)?result.map(verifiedThread).filter(Boolean):[];
   knownThreadIds.current=new Set(list.map(thread=>thread.id));
   setThreads(list);
  }catch(e){setError(e.message)}
 },[]);
 useEffect(()=>{if(!activeId){refreshStories();refreshThreads()}},[activeId,refreshStories,refreshThreads]);
 useEffect(()=>{
  if(activeId)return;
  const onVisible=()=>{if(!document.hidden)refreshThreads()};
  document.addEventListener('visibilitychange',onVisible);
  return()=>document.removeEventListener('visibilitychange',onVisible);
 },[activeId,refreshThreads]);
 useEffect(()=>{
  if(activeId||!me?.uid)return;
  // The only live listener is the 100 latest thread headers, NOT all messages.
  // Firebase bills changes, not an endless polling loop.
  const feed=query(collection(db,'dmThreads'),where('members','array-contains',me.uid),limit(100));
  return onSnapshot(feed,snapshot=>{
   const live=new Map(snapshot.docs.map(d=>[d.id,d.data()]));
   if([...live.keys()].some(id=>!knownThreadIds.current.has(id))){
    refreshThreads(); // New conversation: resolve its current public partner profile once.
    return;
   }
   setThreads(previous=>previous.map(t=>{
    const update=live.get(t.id);return update?{
     ...t,lastText:update.lastText??t.lastText,
     lastMessageAt:update.lastMessageAt??t.lastMessageAt,
     unreadCounts:update.unreadCounts??{}
    }:t;
   }).sort((a,b)=>String(b.lastMessageAt||'').localeCompare(String(a.lastMessageAt||''))));
  },error=>console.warn('NEXBOTS live DM update unavailable',error?.code||error?.message));
 },[activeId,me?.uid,refreshThreads]);
 useEffect(()=>{
  if(!activeId){setChosen(null);setOpening(false);return;}
  let alive=true;setOpening(true);setError('');setChosen(null);
  api(`private/threads/${encodeURIComponent(activeId)}`).then(data=>{
   if(!alive)return;
   const thread=verifiedThread(data);
   if(!thread){setError('المحادثة غير متاحة أو بياناتها غير مكتملة');return;}
   setChosen(thread);
  }).catch(e=>{if(alive)setError(e.message||'تعذّر فتح المحادثة')}).finally(()=>{if(alive)setOpening(false)});
  return ()=>{alive=false};
 },[activeId,loc.search]);
 useEffect(()=>{
  // When a visitor clicks "مراسلة" on a public profile, open that account's
  // dedicated chat screen; do not select a partial thread object in memory.
  if(loc.pathname!=='/private')return;
  const target=new URLSearchParams(loc.search).get('to');
  if(!validDocId(target)||target===me.uid)return;
  let cancelled=false;
  api('private/threads',{method:'POST',body:{targetUid:target}}).then(t=>{
   if(cancelled)return;
   const thread=verifiedThread(t);
   if(thread)navigate('/private/t/'+encodeURIComponent(thread.id),{replace:true});
   else setError('تعذّر فتح المحادثة؛ أعد البحث عن العضو');
  }).catch(e=>{if(!cancelled)setError(e.message)});
  return ()=>{cancelled=true};
 },[loc.pathname,loc.search,me.uid,navigate]);
 const search=async e=>{
  e.preventDefault();const name=q.trim().replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9_]{3,24}$/.test(name))return toast('اكتب اسم مستخدم صحيحاً من 3 أحرف أو أكثر','error');
  try{setBusy(true);setResults((await api('directory?q='+encodeURIComponent(name)))||[])}
  catch(e){toast(e.message,'error')}finally{setBusy(false)}
 };
 const begin=async uid=>{
  if(!validDocId(uid)||uid===me.uid)return toast('تعذّر تحديد العضو، حدّث البحث','error');
  try{setBusy(true);
   const result=await api('private/threads',{method:'POST',body:{targetUid:uid}});
   const thread=verifiedThread(result);
   if(!thread)throw new Error('تعذّر تحديد المحادثة؛ حدّث قائمة الأعضاء');
   navigate('/private/t/'+encodeURIComponent(thread.id));
  }catch(e){toast(e.message,'error')}finally{setBusy(false)}
 };
 if(activeId)return <div className="page-content community-page community-conversation-page">
  {opening?<div className="panel dm-loading"><RefreshCw size={24} className="spin"/> جارٍ فتح المحادثة...</div>:chosen?
   <DmConversation key={chosen.id} thread={chosen} me={me} toast={toast} onBack={()=>navigate('/private')}/>:
   <div className="panel community-conversation-error"><p role="alert">{error||'تعذّر عرض المحادثة'}</p><button className="btn btn-outline" onClick={()=>navigate('/private')}><ArrowRight size={17}/> العودة إلى الرسائل</button><button className="btn btn-outline" onClick={()=>navigate('/private/t/'+activeId+'?retry='+Date.now(),{replace:true})}><RefreshCw size={17}/> إعادة المحاولة</button></div>}
 </div>;
 const unique=[...new Map([...stories].reverse().map(s=>[s.ownerUid,s])).values()];
 const canStory=me?.role==='owner'||me?.activePlan!=='free';
 return <div className="page-content community-page community-home-page">
  <section className="panel stories-section">
   <div className="section-headline"><strong>ستوريات المجتمع</strong><small>تختفي بعد 24 ساعة</small></div>
   <div className="stories-row">
    {canStory&&<button type="button" className="story-bubble story-add" onClick={()=>setCreateStory(true)}><span className="story-ring"><Plus size={28}/></span><small>قصتي</small></button>}
    {unique.map(s=><StoryCircle key={s.ownerUid} user={s.owner} open={()=>setStoryOpen(stories.findIndex(x=>x.ownerUid===s.ownerUid))}/>)}
    {!unique.length&&<p className="subtle">لا توجد ستوريات نشطة بعد.</p>}
   </div>
   {!canStory&&<p className="story-subscribe"><Crown size={15}/> نشر الستوري للمشتركين فقط. <Link to="/plans">العضويات</Link></p>}
  </section>
  <section className="panel community-directory community-directory-full community-search-section">
   <form className="community-search" role="search" aria-label="البحث عن عضو" onSubmit={search}><input aria-label="اسم المستخدم" placeholder="ابحث عن عضو بواسطة @username" value={q} onChange={e=>setQ(e.target.value)}/><button type="submit" className="btn btn-primary" disabled={busy||q.replace(/^@/,'').trim().length<3}><Search size={17}/> {busy?'يبحث...':'بحث'}</button></form>
   {results.map(u=><div className="community-user" key={u.uid}><img src={avatarFor(u)} alt=""/><div><strong className="verified-name">{u.displayName||'عضو'} <VerifiedBadge user={u}/></strong><small>@{u.username||'عضو'}</small></div><button type="button" className="btn btn-outline btn-sm" onClick={()=>begin(u.uid)}><MessageCircle size={16}/> مراسلة</button></div>)}
  </section>
  <section className="panel community-directory community-directory-full community-conversation-list">
   <div className="section-headline"><strong>المحادثات الخاصة</strong><button type="button" className="mini-btn" onClick={refreshThreads}><RefreshCw size={15}/> تحديث</button></div>
   {threads.length===0?<div className="dm-list-empty"><MessageCircle size={31}/><p>لا توجد محادثات بعد. ابحث عن عضو وابدأ المراسلة.</p></div>:
    <div className="dm-thread-list">{threads.map(t=>{const unread=Math.max(0,Number(t.unreadCounts?.[me.uid]||0));return <button type="button" key={t.id} className={'dm-thread'+(unread?' has-unread':'')} onClick={()=>navigate('/private/t/'+encodeURIComponent(t.id))}><img src={avatarFor(t.other)} alt=""/><span className="dm-thread-content"><strong className="verified-name">{t.other.displayName} <VerifiedBadge user={t.other}/></strong><small>{t.lastText||'ابدأ الحديث...'}</small></span><span className="dm-thread-side">{Number.isFinite(Date.parse(t.lastMessageAt))&&<time dateTime={t.lastMessageAt}>{new Date(t.lastMessageAt).toLocaleTimeString('ar',{hour:'2-digit',minute:'2-digit'})}</time>}{unread>0?<span className="dm-unread-count" aria-label={`${unread} رسائل غير مقروءة`}>{unread>99?'99+':unread}</span>:<ArrowLeft size={17}/>}</span></button>})}</div>}
  </section>
  {error&&<div className="notice error" role="alert"><span>{error}</span><button type="button" className="mini-btn" onClick={()=>{setError('');refreshStories();refreshThreads()}}><RefreshCw size={14}/> إعادة المحاولة</button></div>}
  {createStory&&<StoryComposer me={me} toast={toast} onCreated={refreshStories} close={()=>setCreateStory(false)}/>}
  {storyOpen!==null&&<StoryViewer stories={stories} selected={storyOpen} me={me} toast={toast} reload={refreshStories} close={()=>setStoryOpen(null)}/>}
 </div>;
}
export function UsernameEditor({app}){const{me,refreshMe,toast}=app;const[name,setName]=useState(me.username||''),[busy,setBusy]=useState(false);const save=async e=>{e.preventDefault();try{setBusy(true);await api('username',{method:'POST',body:{username:name}});await refreshMe();toast('تم اعتماد اسم المستخدم @'+name.toLowerCase());}catch(e){toast(e.message,'error')}finally{setBusy(false)}};return <form className="panel username-editor" onSubmit={save}><h3><AtSign size={20}/> اسم المستخدم الفريد</h3><p>اختر 3–24 حرفاً إنجليزياً أو رقماً أو شرطة سفلية؛ لا يمكن تكراره.</p><div className="username-controls"><span>@</span><input value={name} minLength={3} maxLength={24} pattern="[a-z0-9_]{3,24}" onChange={e=>setName(e.target.value.toLowerCase())} placeholder="your_username"/><button className="btn btn-primary" disabled={busy||!/^[a-z0-9_]{3,24}$/.test(name)}>{busy?'يحفظ...':'حفظ'}</button></div></form>}
export function AdminReports({app}){const {toast}=app,[data,setData]=useState([]),[error,setError]=useState('');const load=()=>api('reports').then(setData).catch(e=>setError(e.message));useEffect(load,[]);const action=async(r,status)=>{try{await api(`reports/${r.id}`,{method:'PATCH',body:{status}});toast('تم تحديث حالة البلاغ');load()}catch(e){toast(e.message,'error')}};const ban=async(r,banState)=>{const text=banState?'حظر الحساب من المنصة؟':'رفع الحظر عن الحساب؟';if(!confirm(text))return;try{await api(`admin/users/${r.targetUid}`,{method:'PATCH',body:{bannedUntil:banState?'2100-01-01T00:00:00.000Z':null}});await action(r,'resolved');toast(banState?'تم حظر الحساب':'تم إعادة تنشيط الحساب')}catch(e){toast(e.message,'error')}};return <div className="panel admin-list"><h3>بلاغات الأعضاء</h3>{error&&<p className="error-inline">{error}</p>}{!data.length&&<p className="subtle">لا توجد بلاغات</p>}{data.map(r=><div className="admin-item" key={r.id}><div className="item-info"><strong><Link to={`/u/${r.reporterUid}`}>{r.reporterName}</Link> أبلغ عن <Link to={`/u/${r.targetUid}`}>{r.targetName}</Link></strong><p>{r.reason}</p><small>{r.status} · {r.createdAt?.slice(0,10)}</small></div><div className="item-actions"><button className="mini-btn danger" onClick={()=>ban(r,true)}>إيقاف الحساب</button><button className="mini-btn success" onClick={()=>ban(r,false)}>رفع الحظر</button><button className="mini-btn" onClick={()=>action(r,'dismissed')}>رفض البلاغ</button></div></div>)}</div>}
export function MyProjectManager({app}){const{toast}=app,[projects,setProjects]=useState([]),[editing,setEditing]=useState(null),[changes,setChanges]=useState({}),[buyer,setBuyer]=useState('');const reload=()=>api('my-projects').then(setProjects).catch(()=>{});useEffect(reload,[]);const edit=p=>{setEditing(p);setChanges({title:p.title,description:p.description,forSale:p.forSale||false,price:p.price||0})};const save=async()=>{try{const r=await api(`projects/${editing.id}`,{method:'PATCH',body:changes});toast(r.pending?'أُرسل طلب التعديل إلى المالك':'تم التعديل');setEditing(null);reload()}catch(e){toast(e.message,'error')}};const remove=async p=>{if(!confirm(`حذف مشروع «${p.title}» وملفاته نهائياً؟`))return;try{await api(`projects/${p.id}`,{method:'DELETE'});toast('تم حذف المشروع');reload()}catch(e){toast(e.message,'error')}};const grant=async p=>{const input=prompt('بعد التأكد من إتمام الدفع، أدخل @username المشتري أو معرّفه UID:');if(!input)return;try{let buyerUid=input.trim();if(buyerUid.startsWith('@')){const found=await api('directory?q='+encodeURIComponent(buyerUid));if(!found?.length)throw Error('اسم المستخدم غير موجود');buyerUid=found[0].uid;}await api(`purchase-grants/${p.id}`,{method:'POST',body:{buyerUid}});toast('تم منح إذن التحميل للمشتري')}catch(e){toast(e.message,'error')}};
 return <section className="panel project-manager"><h3>إدارة مشاريعي</h3><p className="subtle">يمكنك حذف مشاريعك، وتُرسل طلبات التعديل إلى الإدارة للموافقة. البيع يتم بالاتفاق المباشر، ولا توجد بوابة دفع آلية.</p>{!projects.length?<p className="subtle">لم تضف مشروعاً بعد</p>:projects.map(p=><div className="admin-item" key={p.id}><div className="item-info"><strong>{p.title}</strong><small>{p.status==='approved'?'معتمد':p.status==='pending'?'بانتظار المراجعة':'مرفوض'} {p.forSale?'· للبيع $'+p.price:''}</small></div><div className="item-actions"><button className="mini-btn" onClick={()=>edit(p)}>طلب تعديل</button>{p.forSale&&<button className="mini-btn" onClick={()=>grant(p)}>تسليم للمشتري</button>}<button className="mini-btn danger" onClick={()=>remove(p)}>حذف</button></div></div>)}{editing&&<div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&setEditing(null)}><div className="panel modal project-edit-modal"><div className="panel-head"><h3>طلب تعديل المشروع</h3><button className="icon-button" onClick={()=>setEditing(null)}><X size={18}/></button></div><label className="field">العنوان<input value={changes.title||''} onChange={e=>setChanges(c=>({...c,title:e.target.value}))}/></label><label className="field">الوصف<textarea rows={4} value={changes.description||''} onChange={e=>setChanges(c=>({...c,description:e.target.value}))}/></label><label className="check-line"><input type="checkbox" checked={!!changes.forSale} onChange={e=>setChanges(c=>({...c,forSale:e.target.checked}))}/>عرض المشروع للبيع</label>{changes.forSale&&<label className="field">السعر بالدولار<input type="number" min="1" max="10000" value={changes.price||''} onChange={e=>setChanges(c=>({...c,price:Number(e.target.value)}))}/></label>}<button className="btn btn-primary full" onClick={save}>إرسال للمراجعة</button></div></div>}</section>;
}
export function AdminProjectEdits({app}){const{toast}=app,[data,setData]=useState([]),[error,setError]=useState('');const reload=()=>api('project-edits').then(setData).catch(e=>setError(e.message));useEffect(reload,[]);const review=async(e,status)=>{try{let reason='';if(status==='rejected')reason=prompt('سبب الرفض:')||'';await api(`project-edits/${e.id}`,{method:'PATCH',body:{status,reason}});toast('تمت مراجعة طلب التعديل');reload()}catch(err){toast(err.message,'error')}};return <div className="panel admin-list"><h3>طلبات تعديل المشاريع</h3>{error&&<p className="error-inline">{error}</p>}{!data.length?<p className="subtle">لا توجد طلبات انتظار</p>:data.map(e=><div className="admin-item" key={e.id}><div className="item-info"><strong>{e.authorName} طلب تعديل مشروع</strong><p>العنوان المقترح: {e.changes.title||'بدون تغيير'} {e.changes.forSale?' · عرض للبيع':''}</p><Link to={`/project/${e.projectId}`}>عرض المشروع</Link></div><div className="item-actions"><button className="mini-btn success" onClick={()=>review(e,'approved')}>قبول التعديل</button><button className="mini-btn danger" onClick={()=>review(e,'rejected')}>رفض</button></div></div>)}</div>}
