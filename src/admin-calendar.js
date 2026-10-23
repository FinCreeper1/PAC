import { validateCalendar } from "./validation.js";
import { json } from "./http.js";

export async function adminCalendar(request, session) {
  const env = this.env,
    method = request.method,
    url = new URL(request.url);
  const current = await this.calendar(),
    revision = await this.revision(current);
  if (method === "GET") {
    const { trip, journeys } = (await this.snapshot()).value;
    return json({
      calendar: current,
      revision,
      csrf: session.csrf,
      trip,
      journeys,
      noteImportError: null,
    });
  }
  if (method !== "PUT") return json({ error: "Methode nicht erlaubt." }, 405);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 2000000)
    return json({ error: "Kalender zu groß." }, 413);
  let body;
  try {
    body = JSON.parse(text);
    const snapshot = (await this.snapshot()).value;
    validateCalendar(body.calendar, current, snapshot.trip, snapshot.journeys);
  } catch (error) {
    return json({ error: error.message }, 400);
  }
  if (body.revision !== revision)
    return json(
      { error: "Kalender wurde inzwischen geändert. Bitte neu laden." },
      409,
    );
  const calendar = body.calendar,
    snapshot = structuredClone((await this.snapshot()).value);
  for (const event of calendar.events) {
    if (event.journey) {
      snapshot.journeys[event.journeyId] = event.journey;
      delete event.journey;
    }
    if (event.mapRoute) {
      const ref = "route-" + (await this.revision(event.mapRoute));
      snapshot.routes[ref + ".json"] = event.mapRoute;
      event.routeRef = ref;
      delete event.mapRoute;
    }
    if (event.routeRef && !snapshot.routes[event.routeRef + ".json"]) {
      const asset = await env.ASSETS.fetch(
        new Request(
          new URL(`/data/routes/${event.routeRef}.json`, request.url),
        ),
      );
      if (!asset.ok) return json({ error: "Unbekannte Route." }, 400);
      snapshot.routes[event.routeRef + ".json"] = await asset.json();
    }
  }
  delete calendar.publicationSource;
  calendar.publishedAt = new Date().toISOString();
  snapshot.trip.startDate = calendar.days[0].isoDate;
  snapshot.trip.endDate = calendar.days.at(-1).isoDate;
  snapshot.calendar = calendar;
  await this.saveSnapshot(snapshot);
  return json({
    saved: true,
    calendar,
    trip: snapshot.trip,
    revision: await this.revision(calendar),
  });
}
