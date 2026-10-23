export function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}
