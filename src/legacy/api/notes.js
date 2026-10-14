const MAX_NOTE_LENGTH = 10000;
const EVENT_ID_PATTERN = /^[a-z0-9-]{1,64}$/;

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'private, no-store' } });
}

export async function onRequestGet({ request, env }) {
  const eventId = new URL(request.url).searchParams.get('event') || '';
  if (!EVENT_ID_PATTERN.test(eventId)) return json({ error: 'Ungültiger Termin.' }, 400);
  const note = await env.MATERIALS.get(`note:${eventId}`) || '';
  return json({ note });
}

export async function onRequestPut() {
  return json({ error: 'Notizen werden ausschließlich mit dem Kalender administrativ veröffentlicht.' }, 403);
}
