// Inspect a small prefix while retaining every byte in the streamed response.
async function previewStream(stream) {
  const reader = stream.getReader(), chunks = [];
  let length = 0, done = false;
  while (length < 16 && !done) {
    const next = await reader.read();
    done = next.done;
    if (next.value) { chunks.push(next.value); length += next.value.length; }
  }
  const prefix = new Uint8Array(Math.min(length, 16));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, prefix.length - offset);
    prefix.set(part, offset); offset += part.length;
    if (offset === prefix.length) break;
  }
  const starts = bytes => bytes.every((byte, i) => prefix[i] === byte);
  const ascii = (start, end) => String.fromCharCode(...prefix.subarray(start, end));
  let type = 'application/octet-stream';
  if (starts([137,80,78,71,13,10,26,10])) type = 'image/png';
  else if (starts([255,216,255])) type = 'image/jpeg';
  else if (['GIF87a','GIF89a'].includes(ascii(0,6))) type = 'image/gif';
  else if (ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') type = 'image/webp';
  else if (ascii(0,5) === '%PDF-') type = 'application/pdf';
  const body = new ReadableStream({
    async pull(controller) {
      if (chunks.length) { controller.enqueue(chunks.shift()); return; }
      if (done) { controller.close(); reader.releaseLock(); return; }
      const next = await reader.read();
      if (next.done) { done = true; controller.close(); reader.releaseLock(); }
      else controller.enqueue(next.value);
    },
    cancel(reason) { return reader.cancel(reason); }
  });
  return {type, body};
}

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
  const detected = await previewStream(object.value);
  const canPreview = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(detected.type);
  return new Response(detected.body, {
    headers: {
      'content-type': detected.type,
      'content-length': String(object.metadata.size),
      'content-disposition': contentDisposition(object.metadata.name, url.searchParams.has('download') || !canPreview),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': 'sandbox',
      'x-file-source': 'cloud'
    }
  });
}
import calendar from '../../../../public/data/calendar.json' with { type: 'json' };
import materialAliases from '../../../../public/data/materials.json' with { type: 'json' };
