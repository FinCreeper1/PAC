import calendar from '../../../public/data/calendar.json' with { type: 'json' };
import materialAliases from '../../../public/data/materials.json' with { type: 'json' };
import { safeEqual } from '../_middleware.js';


const MAX_DELETE_PASSWORD_LENGTH = 128;
const PASSWORD_HASH_ITERATIONS = 100000;
const encoder = new TextEncoder();

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'private, no-store' }
  });
}

export function safeFilename(name) {
  return name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').replace(/^\.+/, '').slice(0, 180) || 'datei';
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hashPassword(password, salt, iterations = PASSWORD_HASH_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const result = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256
  );
  return bytesToBase64(new Uint8Array(result));
}

export async function createDeletePasswordData(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    deletePasswordHash: await hashPassword(password, salt),
    deletePasswordSalt: bytesToBase64(salt),
    deletePasswordIterations: PASSWORD_HASH_ITERATIONS
  };
}

async function matchesDeletePassword(password, metadata) {
  if (!metadata?.deletePasswordHash || !metadata.deletePasswordSalt) return false;
  try {
    const iterations = Number(metadata.deletePasswordIterations) || PASSWORD_HASH_ITERATIONS;
    const candidate = await hashPassword(password, base64ToBytes(metadata.deletePasswordSalt), iterations);
    return safeEqual(candidate, metadata.deletePasswordHash);
  } catch {
    return false;
  }
}

function publicMetadata(metadata) {
  return {
    name: metadata.name,
    type: metadata.type,
    size: metadata.size,
    uploadedAt: metadata.uploadedAt,
    source: 'cloud',
    storedAt: ['cloud']
  };
}

export async function onRequestGet({ request, env }) {
  const materialStorageKey = await env.eventStorage();
  const project = new URL(request.url).searchParams.get('project') || '';
  const storageKey = materialStorageKey(project);
  if (!storageKey) return json({ error: 'Unbekannter Termin.' }, 400);

  const result = {keys: []};
  let cursor;
  do {
    const page = await env.MATERIALS.list({prefix: `${storageKey}/`, cursor});
    result.keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while(cursor);
  const files = result.keys
    .filter((entry) => entry.metadata)
    .map((entry) => ({ id: entry.name.slice(storageKey.length + 1), ...publicMetadata(entry.metadata) }))
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
  return json({ files });
}

export async function onRequestPost({ request, env }) {
  const materialStorageKey = await env.eventStorage();
  const form = await request.formData();
  const project = String(form.get('project') || '');
  const password = String(form.get('password') || '');
  const deletePassword = String(form.get('deletePassword') || '');
  const file = form.get('file');

  const storageKey = materialStorageKey(project);
  if (!storageKey) return json({ error: 'Unbekannter Termin.' }, 400);
  if (!safeEqual(password, env.PORTAL_PASSWORD || '')) return json({ error: 'Das Passwort ist nicht richtig.' }, 401);
  if (!deletePassword) return json({ error: 'Bitte ein Löschpasswort festlegen.' }, 400);
  if (deletePassword.length > MAX_DELETE_PASSWORD_LENGTH) return json({ error: 'Das Löschpasswort ist zu lang.' }, 400);
  if (!(file instanceof File) || !file.name || file.size === 0) return json({ error: 'Bitte eine Datei auswählen.' }, 400);

  const id = crypto.randomUUID();
  const metadata = {
    name: safeFilename(file.name),
    type: 'application/octet-stream',
    size: file.size,
    uploadedAt: new Date().toISOString(),
    ...await createDeletePasswordData(deletePassword)
  };
  await env.MATERIALS.put(`${storageKey}/${id}`, file.stream(), { metadata });
  return json({ file: { id, ...publicMetadata(metadata) } }, 201);
}

export async function onRequestDelete({ request, env }) {
  const materialStorageKey = await env.eventStorage();
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Ungültige Anfrage.' }, 400);
  }

  const project = String(body.project || '');
  const id = String(body.id || '');
  const password = String(body.password || '');
  const storageKey = materialStorageKey(project);
  if (!storageKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return json({ error: 'Ungültige Datei.' }, 400);
  const key = `${storageKey}/${id}`;
  try {
    const file = await env.MATERIALS.getWithMetadata(key, 'stream');
    if (!file.value || !file.metadata) return json({ error: 'Datei nicht gefunden.' }, 404);
    await file.value.cancel();

    const isAdmin = Boolean(env.ADMIN_PASSWORD) && safeEqual(password, env.ADMIN_PASSWORD);
    const isOwner = await matchesDeletePassword(password, file.metadata);
    if (!isAdmin && !isOwner) return json({ error: 'Das Löschpasswort ist nicht richtig.' }, 401);

    await env.MATERIALS.delete(key);
    return json({ deleted: true });
  } catch (error) {
    console.error(JSON.stringify({ event: 'material_delete_failed', project, id, message: String(error) }));
    return json({ error: 'Die Datei konnte nicht gelöscht werden.' }, 502);
  }
}
