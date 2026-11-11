// NEXBOTS: safe, text-only link detection. Never use innerHTML for chat messages.
const CHAT_URLS = /(?:https?:\/\/|www\.)[^\s<>"'`]+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:،؛؟\)\]\}…]+$/u;

function safeWebUrl(raw) {
  try {
    const input = /^www\./i.test(raw) ? 'https://' + raw : raw;
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return '';
    if (!url.hostname.includes('.') || url.hostname.endsWith('.')) return '';
    return url.href;
  } catch { return ''; }
}

/** Return plain text and safe link tokens for React rendering. JSX escapes all message content. */
export function chatMessageParts(message) {
  const content = String(message ?? '');
  const parts = [];
  let cursor = 0;
  for (const match of content.matchAll(CHAT_URLS)) {
    const start = match.index;
    if (start > cursor) parts.push({type: 'text', text: content.slice(cursor, start)});
    const matchText = match[0];
    const cleanText = matchText.replace(TRAILING_PUNCTUATION, '');
    const href = safeWebUrl(cleanText);
    if (href) parts.push({type: 'link', text: cleanText, href});
    else parts.push({type: 'text', text: cleanText});
    if (cleanText.length < matchText.length) parts.push({type: 'text', text: matchText.slice(cleanText.length)});
    cursor = start + matchText.length;
  }
  if (cursor < content.length) parts.push({type: 'text', text: content.slice(cursor)});
  return parts;
}

function officialContactUrl(value, kind) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (kind === 'whatsapp' && /^\+?[1-9]\d{7,14}$/.test(raw)) return `https://wa.me/${raw.replace('+', '')}`;
  if (kind === 'telegram' && /^@[a-zA-Z0-9_]{5,32}$/.test(raw)) return `https://t.me/${raw.slice(1)}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const domains = kind === 'whatsapp'
      ? ['wa.me', 'api.whatsapp.com', 'web.whatsapp.com', 'chat.whatsapp.com', 'www.whatsapp.com']
      : ['t.me', 'telegram.me', 'www.t.me', 'www.telegram.me'];
    return domains.includes(url.hostname.toLowerCase()) ? url.href : '';
  } catch { return ''; }
}

/** Only configured owner channels are active; email is always offered as a fallback. */
export function subscriptionContactOptions(site, planName) {
  const plan = String(planName ?? '').slice(0, 80);
  const message = `السلام عليكم، أرغب في الاشتراك في باقة ${plan} على منصة NEXBOTS. كيف يمكنني إتمام الاشتراك؟`;
  let whatsapp = officialContactUrl(site?.whatsapp, 'whatsapp');
  if (whatsapp) {
    const parsed = new URL(whatsapp);
    const isDirect = parsed.hostname === 'wa.me' && /^\/\d{8,15}\/?$/.test(parsed.pathname);
    const isSend = ['api.whatsapp.com', 'web.whatsapp.com'].includes(parsed.hostname) && parsed.pathname.replace(/\/$/, '') === '/send';
    if (isDirect || isSend) { parsed.searchParams.set('text', message); whatsapp = parsed.href; }
  }
  const telegram = officialContactUrl(site?.telegram, 'telegram');
  const email = String(site?.supportEmail || 'lllbx5ll@gmail.com').trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const emailHref = validEmail
    ? `mailto:${email}?subject=${encodeURIComponent('طلب اشتراك ' + plan + ' — NEXBOTS')}&body=${encodeURIComponent(message)}`
    : '';
  return [
    {key: 'whatsapp', label: 'واتساب', href: whatsapp, available: !!whatsapp},
    {key: 'telegram', label: 'تيليجرام', href: telegram, available: !!telegram},
    {key: 'email', label: 'البريد الإلكتروني', href: emailHref, available: !!emailHref}
  ];
}
