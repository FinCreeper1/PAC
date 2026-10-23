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
