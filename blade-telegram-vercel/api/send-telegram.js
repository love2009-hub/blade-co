// Vercel serverless function: POST /api/send-telegram
// IMPORTANT: insert a freshly regenerated bot token here. Never put it in client files.
const BOT_TOKEN = '8915636720:AAE_4F6yyEHTVqqdsO0a5bmcAJ8gpS8Ospo';
const CHAT_ID = '7196676689';

const MAX_BODY_BYTES = 12 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 5;
const recentRequests = new Map();

function json(res, status, body) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function clean(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function getClientKey(req) {
  // Vercel supplies this header; it is used only for a lightweight per-instance limit.
  return String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim().slice(0, 80);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, error: 'Method not allowed' });
  }

  // Reject cross-origin browser submissions. Requests without Origin (e.g. server tests) are allowed.
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return json(res, 403, { ok: false, error: 'Forbidden' });
    } catch (_) {
      return json(res, 403, { ok: false, error: 'Forbidden' });
    }
  }

  let rawBody = '';
  if (typeof req.body === 'string') rawBody = req.body;
  else if (req.body && typeof req.body === 'object') rawBody = JSON.stringify(req.body);
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return json(res, 413, { ok: false, error: 'Request too large' });
  }

  let body;
  try {
    body = req.body && typeof req.body === 'object'
      ? req.body
      : JSON.parse(rawBody || '{}');
  } catch (_) {
    return json(res, 400, { ok: false, error: 'Invalid JSON' });
  }

  // Honeypot: quietly accept bot submissions without forwarding them.
  if (clean(body.website, 200)) return json(res, 200, { ok: true });

  const name = clean(body.name, 100);
  const phone = clean(body.phone, 40);
  const service = clean(body.service, 120);
  const comment = clean(body.comment, 1000);
  if (!name || !phone || !service) {
    return json(res, 400, { ok: false, error: 'Заполните обязательные поля' });
  }
  if (!/[0-9+()\-\s]{6,40}/.test(phone) || phone.replace(/\D/g, '').length < 6) {
    return json(res, 400, { ok: false, error: 'Проверьте номер телефона' });
  }

  const now = Date.now();
  const key = getClientKey(req);
  const timestamps = (recentRequests.get(key) || []).filter((time) => now - time < RATE_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT) {
    return json(res, 429, { ok: false, error: 'Слишком много заявок. Попробуйте позже.' });
  }
  timestamps.push(now);
  recentRequests.set(key, timestamps);
  // Keep the in-memory map bounded on warm serverless instances.
  if (recentRequests.size > 500) {
    for (const [ip, times] of recentRequests) {
      if (!times.length || now - times[times.length - 1] >= RATE_WINDOW_MS) recentRequests.delete(ip);
    }
  }

  if (!BOT_TOKEN || BOT_TOKEN.includes('ВСТАВЬТЕ_НОВЫЙ_ТОКЕН')) {
    return json(res, 500, { ok: false, error: 'Сервер ещё не настроен: добавьте токен Telegram-бота' });
  }

  const date = new Date().toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const message = [
    '<b>💈 Новая заявка — BLADE &amp; CO.</b>',
    '',
    `<b>👤 Имя:</b> ${escapeHtml(name)}`,
    `<b>📱 Телефон:</b> ${escapeHtml(phone)}`,
    `<b>✂️ Услуга:</b> ${escapeHtml(service)}`,
    `<b>💬 Комментарий:</b> ${comment ? escapeHtml(comment) : '—'}`,
    '',
    `<i>🕐 ${escapeHtml(date)}</i>`
  ].join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const telegramResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML' }),
      signal: controller.signal
    });
    const telegramData = await telegramResponse.json().catch(() => null);
    if (!telegramResponse.ok || !telegramData || !telegramData.ok) {
      // Do not return Telegram's raw response: it may contain implementation details.
      return json(res, 502, { ok: false, error: 'Telegram не принял заявку. Попробуйте позже.' });
    }
    return json(res, 200, { ok: true });
  } catch (_) {
    return json(res, 502, { ok: false, error: 'Не удалось связаться с Telegram. Попробуйте позже.' });
  } finally {
    clearTimeout(timeout);
  }
};
