function contentDisposition(filename, download) {
  const fallback = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'datei';
  const encoded = encodeURIComponent(filename);
  return `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function onRequestGet({ request, env, params }) {
  const materialStorageKey = await env.eventStorage();
  const parts = Array.isArray(params.path) ? params.path : [params.path];
  if (parts.length !== 2 || parts.some((part) => !part)) return new Response('Datei nicht gefunden.', { status: 404 });
  const storageKey = materialStorageKey(parts[0]);
  if (!storageKey) return new Response('Datei nicht gefunden.', { status: 404 });

  const object = await env.MATERIALS.getWithMetadata(`${storageKey}/${parts[1]}`, 'stream');
  if (!object.value || !object.metadata) return new Response('Datei nicht gefunden.', { status: 404 });

  const url = new URL(request.url);
  const canPreview = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(object.metadata.type);
  return new Response(object.value, {
    headers: {
      'content-type': object.metadata.type,
      'content-length': String(object.metadata.size),
      'content-disposition': contentDisposition(object.metadata.name, url.searchParams.has('download') || !canPreview),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'x-file-source': 'cloud'
    }
  });
}
import calendar from '../../../../public/data/calendar.json' with { type: 'json' };
import materialAliases from '../../../../public/data/materials.json' with { type: 'json' };
