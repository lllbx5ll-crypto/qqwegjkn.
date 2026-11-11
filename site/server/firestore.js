// Firestore REST uses the verified visitor Firebase ID token. Security Rules
// are the authority, including for calls originating from Pages Functions.
// This deliberately avoids a powerful long-lived Firebase service-account key.
import {fields,decodeDoc} from './codec.js';
export const fullName=(env,collection,id)=>`projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${id}`;
export const docUrl=(env,col,id)=>`https://firestore.googleapis.com/v1/${fullName(env,col,id)}`;
const base=(env)=>`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
async function req(env,url,options={}){
  const headers={...(options.body?{'content-type':'application/json'}:{}),...(options.headers||{})};
  if(env.FIRESTORE_ID_TOKEN)headers.Authorization=`Bearer ${env.FIRESTORE_ID_TOKEN}`;
  // Public reads are evaluated as an anonymous user against Security Rules.
  // The Web API key is a public project identifier, not an admin credential.
  const endpoint=new URL(url);
  if(!env.FIRESTORE_ID_TOKEN && env.FIREBASE_WEB_API_KEY)endpoint.searchParams.set('key',env.FIREBASE_WEB_API_KEY);
  // Queries and document reads can be retried after a short transient outage.
  // Never automatically retry writes: a committed request can lose its response.
  const method=(options.method||'GET').toUpperCase();
  const safeRead=method==='GET'||endpoint.pathname.endsWith(':runQuery')||endpoint.pathname.endsWith(':runAggregationQuery');
  const attempts=safeRead?2:1;
  let response;
  for(let attempt=0;attempt<attempts;attempt++){
    try{response=await fetch(endpoint.toString(),{...options,headers});}
    catch(error){
      if(attempt+1<attempts){await new Promise(done=>setTimeout(done,180));continue;}
      throw Object.assign(new Error('تعذر الاتصال بقاعدة بيانات Firebase مؤقتاً. أعد المحاولة'),{status:503,cause:error});
    }
    if(attempt+1<attempts&&[429,502,503,504].includes(response.status)){
      await new Promise(done=>setTimeout(done,180));continue;
    }
    break;
  }
  const raw=await response.text();let value={};try{value=raw?JSON.parse(raw):{};}catch{}
  if(!response.ok){if(response.status===404)return null;const e=new Error(value.error?.message||`Firestore ${response.status}`);e.status=response.status;throw e;}
  return value;
}
export async function getDoc(env,col,id){const obj=await req(env,docUrl(env,col,id));return decodeDoc(obj);}
// `decodeDoc` adds `id` and `_updateTime` for UI/concurrency purposes.
// They are NOT Firestore document fields. Persisting them breaks the security
// rules for self-service avatar, cover and profile updates (and admin edits).
export function cleanForWrite(value) {
  const {id, _updateTime, ...documentFields} = value;
  return documentFields;
}
export async function setDoc(env,col,id,value){const obj=await req(env,docUrl(env,col,id),{method:'PATCH',body:JSON.stringify({fields:fields(cleanForWrite(value))})});return decodeDoc(obj);}
export async function removeDoc(env,col,id){return req(env,docUrl(env,col,id),{method:'DELETE'});}
export async function listDocs(env,col,max=120){let out=[],next='';do{
  const url=new URL(base(env)+`/${col}`);url.searchParams.set('pageSize',String(Math.min(max-out.length,100)));
  if(next)url.searchParams.set('pageToken',next);
  const data=await req(env,url.toString());if(!data)break;
  out.push(...(data.documents||[]).map(decodeDoc));next=data.nextPageToken||'';
}while(next&&out.length<max);return out;}
// Firestore Rules are not filters. Non-admin queries must state the exact
// constraint that the security rule permits (approved OR own projects).
export async function queryDocs(env,col,field,value,max=150){
  const data=await req(env,base(env)+':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:col}],where:{fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:fields({v:value}).v}},limit:max}})});
  return (Array.isArray(data)?data:[]).filter(x=>x.document).map(x=>decodeDoc(x.document));
}
export async function commit(env,writes){return req(env,base(env)+':commit',{method:'POST',body:JSON.stringify({writes})});}
export function updateWrite(env,col,id,value,precondition){return {update:{name:fullName(env,col,id),fields:fields(cleanForWrite(value))},...(precondition?{currentDocument:precondition}:{})};}
// Compound equality query for a member's public approved projects. Never returns pending projects.
export async function approvedByAuthor(env,uid,max=80){
  const where={compositeFilter:{op:'AND',filters:[
    {fieldFilter:{field:{fieldPath:'authorId'},op:'EQUAL',value:fields({v:uid}).v}},
    {fieldFilter:{field:{fieldPath:'status'},op:'EQUAL',value:fields({v:'approved'}).v}}
  ]}};
  const data=await req(env,base(env)+':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:'projects'}],where,limit:max}})});
  return (Array.isArray(data)?data:[]).filter(x=>x.document).map(x=>decodeDoc(x.document));
}
export async function approvedAuthorStats(env,uid){
  const where={compositeFilter:{op:'AND',filters:[
    {fieldFilter:{field:{fieldPath:'authorId'},op:'EQUAL',value:fields({v:uid}).v}},
    {fieldFilter:{field:{fieldPath:'status'},op:'EQUAL',value:fields({v:'approved'}).v}}
  ]}};
  const data=await req(env,base(env)+':runAggregationQuery',{method:'POST',body:JSON.stringify({structuredAggregationQuery:{structuredQuery:{from:[{collectionId:'projects'}],where},aggregations:[{alias:'approvedProjects',count:{}},{alias:'totalDownloads',sum:{field:{fieldPath:'downloads'}}}]}})});
  const metrics=(Array.isArray(data)?data:[]).find(x=>x.result)?.result?.aggregateFields||{};
  return {approvedProjects:Number(metrics.approvedProjects?.integerValue||0),totalDownloads:Number(metrics.totalDownloads?.integerValue||metrics.totalDownloads?.doubleValue||0)};
}
export function deleteWrite(env,col,id){return {delete:fullName(env,col,id),currentDocument:{exists:true}};}
export function incrWrite(env,col,id,key,amount=1){return {transform:{document:fullName(env,col,id),fieldTransforms:[{fieldPath:key,increment:{integerValue:String(amount)}}]}};}

// One-field filtered queries used by conversations and usernames.
export async function queryDocsOp(env,col,field,op,value,max=100){
 const data=await req(env,base(env)+':runQuery',{method:'POST',body:JSON.stringify({structuredQuery:{from:[{collectionId:col}],where:{fieldFilter:{field:{fieldPath:field},op,value:fields({v:value}).v}},limit:max}})});
 return (Array.isArray(data)?data:[]).filter(x=>x.document).map(x=>decodeDoc(x.document));
}
export async function patchFields(env,col,id,updates){
 const url=new URL(docUrl(env,col,id));for(const name of Object.keys(updates))url.searchParams.append('updateMask.fieldPaths',name);
 const response=await req(env,url.toString(),{method:'PATCH',body:JSON.stringify({fields:fields(updates)})});return decodeDoc(response);
}
