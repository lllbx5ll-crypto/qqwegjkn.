/** Trust file signatures, not browser-supplied MIME types or extensions.
 * Some Android/WebView pickers attach generic or incorrect MIME metadata to
 * genuine JPG/PNG/WebP files. Only the three formats supported by NEXBOTS
 * are accepted; unsupported or disguised data is rejected.
 */
export function detectImageMime(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10') return 'image/png';
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === 'RIFF' && webp === 'WEBP') return 'image/webp';
  return null;
}
export function imageTypeOrThrow(bytes) {
  const mime = detectImageMime(bytes);
  if (!mime) throw new Error('تعذر قراءة الصورة: اختر ملف JPG أو PNG أو WebP حقيقي. صور HEIC تحتاج تحويل إلى JPG أولاً');
  return mime;
}
export function uploadedFileLike(value) {
  return !!value && typeof value === 'object' &&
    typeof value.arrayBuffer === 'function' &&
    Number.isSafeInteger(value.size) && value.size >= 0 &&
    typeof value.name === 'string';
}
