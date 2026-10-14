export async function onRequestGet({ env }) {
  if (!env.APPLE_MAPS_TOKEN) {
    return Response.json({
      error: 'Apple Maps ist noch nicht eingerichtet.',
      setupUrl: 'https://developer.apple.com/account/resources/services/list'
    }, { status: 503, headers: { 'cache-control': 'private, no-store' } });
  }
  return Response.json({ token: env.APPLE_MAPS_TOKEN }, {
    headers: { 'cache-control': 'private, no-store' }
  });
}
