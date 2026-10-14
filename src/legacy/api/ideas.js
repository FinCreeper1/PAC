const COOKIE = 'profilreise_voter';
const encoder = new TextEncoder();

function allowedMapUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.hostname === 'maps.app.goo.gl') return /^\/[A-Za-z0-9_-]{5,80}\/?$/.test(url.pathname);
    if (url.hostname === 'goo.gl') return url.pathname.startsWith('/maps/');
    if (['maps.google.com', 'maps.google.de'].includes(url.hostname) && url.pathname === '/')
      return Boolean(url.searchParams.get('q')?.trim());
    return ['google.com', 'www.google.com', 'maps.google.com', 'google.de', 'www.google.de', 'maps.google.de'].includes(url.hostname)
      && url.pathname.startsWith('/maps');
  } catch { return false; }
}

function coordinates(url) {
  const decoded = decodeURIComponent(url.href);
  const match = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(decoded)
    || /\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(decoded)
    || /\/maps\/search\/(-?\d+(?:\.\d+)?),[+\s]*(-?\d+(?:\.\d+)?)(?:[/?]|$)/.exec(decoded)
    || /^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/.exec(url.searchParams.get('q') || url.searchParams.get('query') || url.searchParams.get('ll') || '');
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

function googleUrlFromText(text) {
  return (text.match(/https:\/\/[^\s<>"']+/giu) || [])
    .map((url) => url.replace(/[.,;)]}]+$/, ''))
    .find(allowedMapUrl) || null;
}

function pendingLocation(text) {
  const googleUrl = googleUrlFromText(text);
  return googleUrl ? { googleUrl, name: '', latitude: null, longitude: null, retryAt: new Date(Date.now() + 900000).toISOString(), resolverVersion: 3 } : null;
}

export async function mapLocation(text, fetchRedirect = fetch) {
  const googleUrl = googleUrlFromText(text);
  if (!googleUrl) return null;
  let resolved = googleUrl;
  for (let step = 0; step < 5 && ['maps.app.goo.gl', 'goo.gl'].includes(new URL(resolved).hostname); step++) {
    const response = await fetchRedirect(resolved, { method: 'HEAD', redirect: 'manual' });
    const target = response.headers.get('location');
    const next = target && new URL(target, resolved).href;
    if (!next || !allowedMapUrl(next)) throw new Error('Der Google-Maps-Link konnte nicht aufgelöst werden. Bitte erneut versuchen.');
    resolved = next;
  }
  const url = new URL(resolved);
  if (['maps.app.goo.gl', 'goo.gl'].includes(url.hostname)) throw new Error('Der Google-Maps-Link konnte nicht aufgelöst werden. Bitte erneut versuchen.');
  const point = coordinates(url);
  const place = /\/maps\/place\/([^/]+)/.exec(url.pathname);
  const name = (place ? decodeURIComponent(place[1]).replaceAll('+', ' ') : url.searchParams.get('q') || url.searchParams.get('query') || '').trim().slice(0, 160);
  if (!point && !name) throw new Error('Der Google-Maps-Link enthält keinen erkennbaren Standort.');
  return { googleUrl, name, latitude: point?.latitude ?? null, longitude: point?.longitude ?? null };
}

function reply(payload, status = 200, cookie = '') {
  const headers = { 'cache-control': 'private, no-store' };
  if (cookie) headers['set-cookie'] = `${COOKIE}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
  return Response.json(payload, { status, headers });
}

function safeEqual(left, right) {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function voter(request) {
  const raw = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  let token = raw?.slice(COOKIE.length + 1) || '';
  let fresh = '';
  if (!/^[0-9a-f]{64}$/.test(token)) {
    token = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    fresh = token;
  }
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return { id: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''), fresh };
}

async function keys(kv, prefix) {
  const result = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    result.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return result;
}

async function board(kv, voterId, fetchRedirect) {
  const ideaKeys = await keys(kv, 'idea:');
  const ideas = (await Promise.all(ideaKeys.map((key) => kv.get(key, 'json')))).filter(Boolean);
  let attempts = 0;
  for (const idea of ideas) {
    if (attempts >= 3) break;
    if ((idea.location?.latitude != null && idea.location?.longitude != null) || idea.location?.name || (idea.location?.resolverVersion >= 3 && Date.parse(idea.location?.retryAt || '') > Date.now()) || !googleUrlFromText(idea.text)) continue;
    attempts++;
    try {
      const location = await mapLocation(idea.text, fetchRedirect);
      idea.location = location;
    } catch { idea.location = pendingLocation(idea.text); }
    await kv.put(`idea:${idea.id}`, JSON.stringify(idea));
  }
  const voteKeys = await keys(kv, 'idea-vote:');
  const scores = new Map();
  const own = new Map();
  for (const key of voteKeys) {
    const match = /^idea-vote:([0-9a-f]{32}):([0-9a-f]{64})$/.exec(key);
    if (!match) continue;
    const value = Number(await kv.get(key));
    if (value !== 1 && value !== -1) continue;
    scores.set(match[1], (scores.get(match[1]) || 0) + value);
    if (match[2] === voterId) own.set(match[1], value);
  }
  return ideas.map((idea) => ({ ...idea, score: scores.get(idea.id) || 0, vote: own.get(idea.id) || 0 }))
    .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
}

export async function onRequest({ request, env, fetchRedirect = fetch }) {
  const { id: voterId, fresh } = await voter(request);
  const respond = (payload, status) => reply(payload, status, fresh);
  if (request.method === 'GET') return respond({ ideas: await board(env.MATERIALS, voterId, fetchRedirect) });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return respond({ error: 'Ungültige Anfrage.' }, 400);
  if (request.method === 'POST') {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || [...text].length > 500) return respond({ error: 'Die Idee muss zwischen 1 und 500 Zeichen lang sein.' }, 400);
    if ((await keys(env.MATERIALS, 'idea:')).length >= 500) return respond({ error: 'Die Ideenliste ist voll.' }, 409);
    const id = crypto.randomUUID().replaceAll('-', '');
    let location;
    try { location = await mapLocation(text, fetchRedirect); }
    catch { location = pendingLocation(text); }
    await env.MATERIALS.put(`idea:${id}`, JSON.stringify({ id, text, createdAt: new Date().toISOString(), location }));
    return respond({ ideas: await board(env.MATERIALS, voterId, fetchRedirect) }, 201);
  }
  if (request.method === 'PUT') {
    const { id, vote } = body;
    if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id) || ![-1, 0, 1].includes(vote)) return respond({ error: 'Ungültige Stimme.' }, 400);
    if (!(await env.MATERIALS.get(`idea:${id}`))) return respond({ error: 'Idee nicht gefunden.' }, 404);
    const key = `idea-vote:${id}:${voterId}`;
    if (vote === 0) await env.MATERIALS.delete(key);
    else await env.MATERIALS.put(key, String(vote));
    return respond({ ideas: await board(env.MATERIALS, voterId, fetchRedirect) });
  }
  if (request.method === 'DELETE') {
    const { id, password } = body;
    if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id) || typeof password !== 'string') return respond({ error: 'Ungültige Löschanfrage.' }, 400);
    if (!env.ADMIN_PASSWORD || !safeEqual(password, env.ADMIN_PASSWORD)) return respond({ error: 'Das Adminpasswort ist nicht richtig.' }, 403);
    const key = `idea:${id}`;
    if (!(await env.MATERIALS.get(key))) return respond({ error: 'Idee nicht gefunden.' }, 404);
    await env.MATERIALS.delete(key);
    for (const voteKey of await keys(env.MATERIALS, `idea-vote:${id}:`)) await env.MATERIALS.delete(voteKey);
    return respond({ ideas: await board(env.MATERIALS, voterId, fetchRedirect) });
  }
  return respond({ error: 'Methode nicht erlaubt.' }, 405);
}
