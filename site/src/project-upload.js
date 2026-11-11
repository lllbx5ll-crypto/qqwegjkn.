/**
 * Project upload has two compatible server-supported paths:
 * 1. R2 staged uploads, then a metadata-only Firestore commit.
 * 2. Legacy/direct multipart upload to /api/projects, only when staging fails
 *    with a genuine transport or transient upstream error.
 *
 * Both paths use the SAME immutable submissionId, so a lost response cannot
 * create a second project. Never fall back after a validation/permissions error.
 */
const RETRYABLE_HTTP = new Set([408, 429, 502, 503, 504, 520, 521, 522, 523, 524]);

export function canTryDirectProjectUpload(error) {
  return error?.code === 'NETWORK' || error?.kind === 'INVALID_RESPONSE' || RETRYABLE_HTTP.has(error?.status);
}

function projectForm(fields, submissionId) {
  const body = new FormData();
  body.append('submissionId', submissionId);
  for (const [key, value] of Object.entries(fields)) body.append(key, String(value ?? ''));
  return body;
}

const shortError = (error) => String(error?.message || 'خطأ غير معروف').slice(0, 240);

export async function submitProjectWithFallback({
  fields, submissionId, image, file, stageAsset, uploadFile, onPhase = () => {}
}) {
  if (!submissionId || !fields || typeof stageAsset !== 'function' || typeof uploadFile !== 'function') {
    throw new Error('بيانات رفع المشروع غير مكتملة');
  }
  try {
    if (image) {
      onPhase('رفع صورة المشروع...');
      await stageAsset('projects', submissionId, 'image', image);
    }
    if (file) {
      onPhase('رفع ملف المشروع...');
      await stageAsset('projects', submissionId, 'file', file);
    }
  } catch (stageError) {
    if (!canTryDirectProjectUpload(stageError)) throw stageError;
    // Only an upstream/transport error activates the second upload method.
    // The original image and file are sent, not paths or unverified receipts.
    onPhase('المسار الأول تعذّر؛ تجربة رفع بديل آمن...');
    const body = projectForm(fields, submissionId);
    if (image) body.append('image', image, image.name || 'cover.jpg');
    if (file) body.append('file', file, file.name || 'source.zip');
    try {
      return await uploadFile('projects', body);
    } catch (directError) {
      const msg = `تعذر رفع المشروع بالطريقتين. النقل المنفصل: ${shortError(stageError)}. الرفع المباشر: ${shortError(directError)}. افتح سجل Cloudflare لطلب الرفع.`;
      const combined = new Error(msg);
      combined.cause = directError;
      combined.stageError = stageError;
      throw combined;
    }
  }

  onPhase('حفظ المشروع للمراجعة...');
  const body = projectForm(fields, submissionId);
  body.append('stagedAssets', '1');
  if (image) body.append('imageName', image.name);
  if (file) body.append('fileName', file.name);
  return uploadFile('projects', body);
}
