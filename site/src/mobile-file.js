/**
 * Make an independent, bounded in-memory copy of a user-selected file.
 *
 * Some Android/Chromium file pickers hand the page a temporary File whose
 * backing content URI can fail when fetch/FormData later reads it. Copy the
 * selected bytes immediately, before inspecting File.size or submitting.
 * Files are capped at the application's existing image/ZIP limits, so a large
 * selection cannot exhaust the mobile browser's memory.
 */
export async function snapshotUploadFile(source, maxBytes) {
  if (!source || typeof source.stream !== 'function') {
    throw new Error('تعذر قراءة الملف. افتحه من تطبيق الملفات في التخزين الداخلي ثم اختره مرة أخرى.');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error('حد حجم الملف غير صالح');
  let reader;
  const parts = [];
  let length = 0;
  try {
    reader = source.stream().getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('بيانات الملف غير صالحة');
      length += value.byteLength;
      if (length > maxBytes) {
        throw Object.assign(new Error('الملف يتجاوز الحد المسموح'), { code: 'FILE_TOO_LARGE' });
      }
      // Copy bytes rather than retaining slices backed by a temporary URI.
      parts.push(value.slice());
    }
  } catch (error) {
    if (error?.code === 'FILE_TOO_LARGE') throw error;
    throw new Error('تعذرت قراءة محتوى الملف من جهازك. انسخه إلى التخزين الداخلي > Download ثم اختره من تطبيق الملفات.');
  } finally {
    if (reader) {
      try { await reader.cancel(); } catch {}
      reader.releaseLock();
    }
  }
  if (!length) throw new Error('الملف المختار فارغ، اختر ملفاً آخر');
  const name = typeof source.name === 'string' && source.name ? source.name : 'upload.bin';
  const type = typeof source.type === 'string' ? source.type : 'application/octet-stream';
  const lastModified = Number.isFinite(source.lastModified) ? source.lastModified : Date.now();
  if (typeof File === 'function') return new File(parts, name, { type, lastModified });
  const blob = new Blob(parts, { type });
  Object.defineProperty(blob, 'name', { value: name });
  return blob;
}
