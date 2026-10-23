import { validateTrip, dayTimeSlots } from "./onboarding.js";
import { json } from "./http.js";

export async function tripSettings(request, session) {
  const env = this.env,
    method = request.method,
    url = new URL(request.url);
  const snapshot = structuredClone((await this.snapshot()).value);
  const mapProvider = snapshot.trip.mapProvider || "mapkit";
  const revision = await this.revision(snapshot.trip);
  const grid = CalendarModel.bounds(snapshot.calendar),
    dayHours = {
      start: CalendarModel.time(grid.start),
      end: CalendarModel.time(grid.end),
    };
  const appleMapsConfigured = Boolean(env.APPLE_MAPS_TOKEN);
  if (method === "GET")
    return json({
      mapProvider,
      trip: snapshot.trip,
      dayHours,
      revision,
      csrf: session.csrf,
      appleMapsConfigured,
      version: this.baseEnv.PAC_VERSION || null,
    });
  if (method !== "PUT") return json({ error: "Methode nicht erlaubt." }, 405);
  const text = await request.text();
  if (text.length > 20000)
    return json({ error: "Einstellungen zu groß." }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Ungültige Einstellungen." }, 400);
  }
  if (!body || !["mapkit", "openstreetmap"].includes(body.mapProvider))
    return json({ error: "Bitte einen gültigen Kartenanbieter wählen." }, 400);
  if (body.revision !== revision)
    return json(
      {
        error: "Die Einstellungen wurden inzwischen geändert. Bitte neu laden.",
      },
      409,
    );
  if (body.mapProvider === "mapkit" && !appleMapsConfigured)
    return json(
      {
        error:
          "Für Apple MapKit zuerst APPLE_MAPS_TOKEN in den Cloudflare-Einstellungen des eigenen Workers hinterlegen.",
      },
      400,
    );
  if (body.trip) {
    let next;
    try {
      next = validateTrip({ ...body.trip, TRIP_MODE: "new" });
    } catch (error) {
      return json({ error: error.message }, 400);
    }
    const dates = [];
    for (
      let d = Date.parse(next.startDate);
      d <= Date.parse(next.endDate);
      d += 86400000
    )
      dates.push(new Date(d).toISOString().slice(0, 10));
    const removed = snapshot.calendar.days
      .map((day, i) => (dates.includes(day.isoDate) ? -1 : i))
      .filter((i) => i >= 0);
    if (
      snapshot.calendar.events.some((event) => removed.includes(event.day - 1))
    )
      return json(
        {
          error:
            "Im entfernten Zeitraum liegen Termine. Bitte diese zuerst verschieben oder entfernen.",
        },
        400,
      );
    const oldDays = snapshot.calendar.days;
    for (const event of snapshot.calendar.events)
      event.day = dates.indexOf(oldDays[event.day - 1]?.isoDate) + 1;
    snapshot.calendar.days = dates.map(
      (isoDate) =>
        oldDays.find((day) => day.isoDate === isoDate) || { isoDate },
    );
    snapshot.trip = { ...snapshot.trip, ...next, id: snapshot.trip.id };
    // Only rebuild the grid when the hours change, so irregular legacy grids stay untouched.
    const start = body.trip.TRIP_DAY_START || dayHours.start,
      end = body.trip.TRIP_DAY_END || dayHours.end;
    if (start !== dayHours.start || end !== dayHours.end) {
      let timeSlots;
      try {
        timeSlots = dayTimeSlots({ TRIP_DAY_START: start, TRIP_DAY_END: end });
      } catch (error) {
        return json({ error: error.message }, 400);
      }
      const from = CalendarModel.minutes(start),
        to = CalendarModel.minutes(end);
      const events = CalendarModel.normalize(
        snapshot.calendar,
        snapshot.trip,
      ).events;
      if (
        events.some(
          (event) =>
            CalendarModel.minutes(event.startTime) < from ||
            CalendarModel.minutes(event.endTime) > to,
        )
      )
        return json(
          {
            error:
              "Einige Termine liegen außerhalb der neuen Tageszeiten. Bitte diese zuerst verschieben.",
          },
          400,
        );
      snapshot.calendar.events = events;
      snapshot.calendar.timeSlots = timeSlots;
    }
  }
  snapshot.trip.mapProvider = body.mapProvider;
  await this.saveSnapshot(snapshot);
  return json({
    saved: true,
    mapProvider: body.mapProvider,
    trip: snapshot.trip,
    dayHours: (({ start, end }) => ({
      start: CalendarModel.time(start),
      end: CalendarModel.time(end),
    }))(CalendarModel.bounds(snapshot.calendar)),
    revision: await this.revision(snapshot.trip),
    appleMapsConfigured,
  });
}
