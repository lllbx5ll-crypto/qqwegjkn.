// Firestore REST wire encoding/decoding: no Firebase admin SDK bundled in Pages.
export function enc(value) {
  if (value === null || value === undefined) return {nullValue:null};
  if (value instanceof Date) return {timestampValue:value.toISOString()};
  if (typeof value === 'string') return {stringValue:value};
  if (typeof value === 'boolean') return {booleanValue:value};
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid number');
    return Number.isInteger(value) ? {integerValue:String(value)} : {doubleValue:value};
  }
  if (Array.isArray(value)) return {arrayValue:{values:value.map(enc)}};
  if (typeof value === 'object') return {mapValue:{fields:fields(value)}};
  throw new Error('Unsupported Firestore value');
}
export function fields(object) {return Object.fromEntries(Object.entries(object).filter(([,v])=>v!==undefined).map(([k,v])=>[k,enc(v)]));}
export function dec(value) {
  if (!value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values||[]).map(dec);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields||{}).map(([k,v])=>[k,dec(v)]));
  return null;
}
export function decodeDoc(doc) {if(!doc)return null;return {id:doc.name?.split('/').pop(),...Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,dec(v)])),_updateTime:doc.updateTime};}
