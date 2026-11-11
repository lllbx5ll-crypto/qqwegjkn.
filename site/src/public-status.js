// No credentials, private messages or upload bodies are cached here.
const KEY='nexbots.public-settings.cache.v1';
export const OFFLINE_MESSAGE='لا يتوفر اتصال بالإنترنت حالياً. يرجى تشغيل الإنترنت والمحاولة من جديد.';
export const TEMP_MESSAGE='تعذّر الاتصال بالمنصة مؤقتاً. يرجى المحاولة بعد قليل.';
export function publicStatus(error,online=true){
  if(!online||error?.code==='OFFLINE') return {title:'لا يوجد اتصال بالإنترنت',message:OFFLINE_MESSAGE};
  if(['NETWORK'].includes(error?.code)||error?.name==='AbortError'||/غير متصل|الإنترنت|Failed to fetch|NetworkError|تعذّر الوصول/i.test(String(error?.message||'')))
    return {title:'تعذّر الاتصال حالياً',message:'تحقّق من اتصال الإنترنت ثم حاول مرة أخرى.'};
  return {title:'المنصة غير متاحة مؤقتاً',message:TEMP_MESSAGE};
}
export function cachePublicSettings(data){
  if(!data||typeof data!=='object')return;
  try{localStorage.setItem(KEY,JSON.stringify({settings:data.settings||{},plans:data.plans||{},savedAt:Date.now()}));}catch{}
}
export function readPublicSettings(){
  try{const raw=localStorage.getItem(KEY);if(!raw)return null;
    const parsed=JSON.parse(raw);
    return parsed&&typeof parsed.settings==='object'&&typeof parsed.plans==='object'?parsed:null;
  }catch{return null;}
}
