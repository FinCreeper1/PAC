import trip from '../../public/data/trip.json' with { type: 'json' };
const COOKIE_NAME = 'profilreise_session';
const SESSION_SECONDS = 60 * 60 * 24 * 400;

const encoder = new TextEncoder();

function escapeHtml(value) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function loginPage(message = '', details = trip) {
  const notice = message ? `<p class="error">${escapeHtml(message)}</p>` : '';
  return new Response(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zugang · ${escapeHtml(details.title)}</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#fbfcfa;color:#171816;font:15px system-ui,sans-serif}
main{width:min(380px,100%);border-top:3px solid #c81d25;padding-top:28px}h1{margin:0 0 8px;font-size:28px;letter-spacing:-.04em}p{margin:0 0 28px;color:#676a64;line-height:1.55}label{display:block;margin-bottom:7px;font-size:13px;font-weight:650}input{width:100%;height:44px;padding:0 12px;border:1px solid #bfc2bc;border-radius:6px;background:white;font:inherit}input:focus{outline:3px solid rgba(200,29,37,.2);border-color:#c81d25}button{width:100%;height:44px;margin-top:12px;border:0;border-radius:6px;background:#171816;color:white;font:650 14px system-ui,sans-serif;cursor:pointer}.error{margin:0 0 18px;color:#a5151b;font-size:13px}.meta{margin-top:24px;font-size:11px}
</style></head><body><main><h1>${escapeHtml(details.title)}</h1><p>Dieser Kalender ist nur für Teilnehmende zugänglich.</p>${notice}<form method="post" action="/__login"><label for="password">Passwort</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Kalender öffnen</button></form><p class="meta">${escapeHtml(details.startDate)} – ${escapeHtml(details.endDate)}</p></main></body></html>`, {
    status: message ? 401 : 200,
    headers: { 'content-type': 'text/html; charset=UTF-8', 'cache-control': 'no-store' }
  });
}

export async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(left, right) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function createSession(secret) {
  const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  return `${expires}.${await sign(expires, secret)}`;
}

export async function validSession(request, secret) {
  const cookieHeader = request.headers.get('cookie') || '';
  const rawCookie = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!rawCookie) return false;
  const [expires, signature] = rawCookie.slice(COOKIE_NAME.length + 1).split('.');
  if (!expires || !signature || Number(expires) < Date.now() / 1000) return false;
  return safeEqual(signature, await sign(expires, secret));
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (!env.PORTAL_PASSWORD || !env.SESSION_SECRET) {
    return new Response('Portal-Zugang ist noch nicht konfiguriert.', { status: 503 });
  }

  if (url.pathname === '/__login' && request.method === 'POST') {
    const form = await request.formData();
    if (!safeEqual(String(form.get('password') || ''), env.PORTAL_PASSWORD)) {
      return loginPage('Das Passwort ist nicht richtig.',env.getPortalTrip?await env.getPortalTrip():trip);
    }
    const session = await createSession(env.SESSION_SECRET);
    return new Response(null, {
      status: 303,
      headers: {
        location: '/',
        'set-cookie': `${COOKIE_NAME}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`,
        'cache-control': 'no-store'
      }
    });
  }

  if (url.pathname === '/__logout') {
    return new Response(null, {
      status: 303,
      headers: {
        location: '/',
        'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        'clear-site-data': '"cache", "storage"',
        'cache-control': 'no-store'
      }
    });
  }

  if (!(await validSession(request, env.SESSION_SECRET))) return url.pathname.startsWith('/api/') ? Response.json({error:'Bitte anmelden.'}, {status:401}) : loginPage('',env.getPortalTrip?await env.getPortalTrip():trip);

  const response = await context.next();
  const protectedResponse = new Response(response.body, response);
  const session = await createSession(env.SESSION_SECRET);
  protectedResponse.headers.append('set-cookie', `${COOKIE_NAME}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`);
  protectedResponse.headers.set('cache-control', 'private, no-store');
  protectedResponse.headers.set('x-frame-options', 'DENY');
  protectedResponse.headers.set('x-content-type-options', 'nosniff');
  protectedResponse.headers.set('referrer-policy', 'no-referrer');
  protectedResponse.headers.set('x-portal-content', 'authenticated');
  return protectedResponse;
}
