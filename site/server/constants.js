export const defaultPlans={"free":{"name":"مجاني","price":0,"dailyMessages":50,"canUpload":false,"perks":["استكشاف جميع التصنيفات","البحث وفرز المشاريع","مشاهدة تفاصيل المشاريع","تحميل المشاريع المعتمدة","حساب Google مجاني","بروفايل عام قابل للمشاركة","تعديل الاسم والصورة والغلاف","المشاركة في الشات العام","50 رسالة يومياً"]},"plus":{"name":"Plus","price":3,"dailyMessages":150,"canUpload":true,"perks":["جميع مميزات الحساب المجاني","رفع مشاريع البوتات والسكربتات","إرفاق ملفات حتى 3MB","إضافة صور وعناوين ووسوم","إضافة روابط تنزيل خارجية","متابعة حالة مراجعة المشاريع","مشاركة روابط المشاريع","لوحة لمشاريعك المرفوعة","150 رسالة يومياً"]},"premium":{"name":"Premium","price":6,"dailyMessages":400,"canUpload":true,"perks":["جميع مميزات Plus","رفع ومشاركة المشاريع بعد مراجعتها","إضافة وصف وطريقة استخدام مفصلة","صور مشاريع بصيغ PNG / JPG / WebP","مشاركة ملفك الشخصي","عرض عدد تحميلات المشاريع","استخدام التصنيفات والبحث المتقدم","متابعة قبول أو رفض المشاريع","400 رسالة يومياً"]},"pro":{"name":"Pro","price":10,"dailyMessages":1000,"canUpload":true,"perks":["جميع مميزات Premium","رفع مشاريع واتساب وتيليجرام","نشر أدوات Python وJavaScript وPHP","إضافة ملفات أو روابط خارجية","إدارة مشاريعك من حسابك","مشاريع قابلة للمشاركة والتحميل","استخدام كل مجالات المجتمع","حصة الشات الأعلى بين الباقات","1000 رسالة يومياً"]}};
export const defaultSettings={siteName:'NEXBOTS',tagline:'مجتمع البوتات والأدوات البرمجية',description:'عالمك العربي للبوتات والأوامر والسكربتات. اكتشف، تعلّم، وشارك إبداعاتك.',supportEmail:'lllbx5ll@gmail.com',telegram:'',whatsapp:'',instagram:'',complaintsChatUrl:'',verificationChatUrl:'',logo:'',background:'',bannedWords:[],announcement:''};
export const PERMISSIONS=['manageProjects','manageChat','manageUsers','managePlans','manageSettings','manageBadges','viewEmails'];
export const MAX_IMAGE=200*1024, MAX_FILE=3*1024*1024, MAX_AVATAR=2*1024*1024;
export function activePlan(user){const now=Date.now();return user?.plan && user.plan!=='free' && user.planEndsAt && Date.parse(user.planEndsAt)>now && (!user.planStartsAt||Date.parse(user.planStartsAt)<=now)?user.plan:'free';}
export function can(user,permission){return !!user && (user.role==='owner'||(user.role==='developer'&&user.permissions?.includes(permission)));}
export function cleanText(value,max=200){return String(value??'').trim().slice(0,max);}
export function validLink(s,whatsapp=false){if(!s)return '';try{const u=new URL(s);if(u.protocol!=='https:')return '';if(whatsapp&&!['wa.me','api.whatsapp.com'].includes(u.hostname))return '';return u.toString();}catch{return '';}}

/** Only same-platform direct-message links are allowed; never send users to arbitrary domains. */
export function validInternalChatLink(raw) {
 const value=String(raw||'').trim();if(!value)return '';
 if(value.length>500 || value.includes('\\') || value.includes('\r') || value.includes('\n') || value.startsWith('//'))return null;
 let url;
 try { url=new URL(value,'https://nexbots.pages.dev'); } catch {return null;}
 if(url.protocol!=='https:'||url.hostname!=='nexbots.pages.dev'||url.port||url.username||url.password||url.hash)return null;
 let uid='';
 if(url.pathname==='/private' && url.searchParams.size===1)uid=url.searchParams.get('to')||'';
 else if(/^\/u\/[\w-]+\/?$/.test(url.pathname) && !url.search)uid=url.pathname.split('/')[2]||'';
 if(!/^[\w-]{1,128}$/.test(uid))return null;
 return '/private?to='+encodeURIComponent(uid);
}
