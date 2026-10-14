/* Canonical times and semantic fields; legacy fields are read only during migration. */
globalThis.CalendarModel = (() => {
  const minutes = (value) =>
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || "")
      ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
      : null;
  const time = (value) =>
    `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  function bounds(calendar) {
    const slots = calendar.timeSlots.map(minutes);
    const step = slots.at(-1) - slots.at(-2);
    if (
      slots.length < 2 ||
      slots.some((v, i) => v === null || (i && v <= slots[i - 1])) ||
      slots.at(-1) + step > 1439
    ) {
      throw Error(
        "Ungültiges Zeitraster. Mindestens zwei aufsteigende Zeitmarken erforderlich.",
      );
    }
    return {
      start: slots[0],
      end: slots.at(-1) + step,
      step,
      duration: slots.at(-1) + step - slots[0],
    };
  }
  function normalize(calendar, trip) {
    const result = structuredClone(calendar),
      grid = bounds(result);
    result.schemaVersion = 2;
    result.days = result.days.map((day) => ({
      isoDate:
        day.isoDate ||
        `${trip.startDate.slice(0, 7)}-${String(day.date).padStart(2, "0")}`,
    }));
    result.events = result.events.map((item) => {
      const e = { ...item },
        style = String(e.style || "program");
      e.timing ??= e.startTime && e.endTime ? "scheduled" : "unscheduled";
      e.startTime ??= time(grid.start + e.start * grid.step);
      e.endTime ??= time(grid.start + e.end * grid.step);
      e.type ??= style.includes("train") ? "travel" : "program";
      e.status ??=
        style.includes("draft") || e.timing === "unscheduled"
          ? "provisional"
          : "confirmed";
      e.display ??= style.includes("compact") ? "compact" : "normal";
      if (e.dialog) e.journeyId ??= e.id;
      for (const key of [
        "start",
        "end",
        "time",
        "style",
        "action",
        "topic",
        "materialTopic",
        "dialog",
        "route",
      ])
        delete e[key];
      return e;
    });
    return result;
  }
  const label = (item) =>
    item.timing === "unscheduled"
      ? "Zeit noch offen"
      : `${item.startTime}–${item.endTime}`;
  const statusLabel = (item) =>
    item.status === "provisional"
      ? "Vorläufig · Zeit noch nicht bestätigt"
      : "";
  const dayLabel = (day) =>
    new Intl.DateTimeFormat("de-DE", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      timeZone: "UTC",
    }).format(new Date(`${day.isoDate}T12:00:00Z`));
  const localDate = (now = new Date()) =>
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(now);
  function current(calendar, now = new Date()) {
    const date = localDate(now);
    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);
    const minute = minutes(clock),
      dayIndex = calendar.days.findIndex((day) => day.isoDate === date);
    const scheduled = calendar.events
      .filter((e) => e.timing !== "unscheduled")
      .sort(
        (a, b) => a.day - b.day || minutes(a.startTime) - minutes(b.startTime),
      );
    const active = scheduled.filter(
      (e) =>
        e.day === dayIndex + 1 &&
        minutes(e.startTime) <= minute &&
        minutes(e.endTime) > minute,
    );
    const next = scheduled.find(
      (e) =>
        calendar.days[e.day - 1].isoDate > date ||
        (e.day === dayIndex + 1 && minutes(e.startTime) > minute),
    );
    return {
      date,
      dayIndex,
      active,
      next,
      minutesUntil:
        next?.day === dayIndex + 1 ? minutes(next.startTime) - minute : null,
    };
  }
  function layout(events, calendar) {
    const base = bounds(calendar).start,
      result = [];
    const sorted = [...events].sort(
      (a, b) =>
        minutes(a.startTime) - minutes(b.startTime) ||
        minutes(b.endTime) - minutes(a.endTime),
    );
    let group = [],
      until = -Infinity;
    function flush() {
      const columns = [],
        entries = [];
      for (const item of group) {
        let column =
          item.lane === "right"
            ? 1
            : item.lane === "left"
              ? 0
              : columns.findIndex((end) => end <= minutes(item.startTime));
        if (column < 0) column = columns.length;
        while ((columns[column] ?? -Infinity) > minutes(item.startTime))
          column++;
        columns[column] = minutes(item.endTime);
        entries.push({
          item,
          column,
          top: minutes(item.startTime) - base,
          height: minutes(item.endTime) - minutes(item.startTime),
        });
      }
      result.push(
        ...entries.map((entry) => ({
          ...entry,
          columns: Math.max(1, columns.length),
        })),
      );
      group = [];
    }
    for (const item of sorted) {
      if (group.length && minutes(item.startTime) >= until) {
        flush();
        until = -Infinity;
      }
      group.push(item);
      until = Math.max(until, minutes(item.endTime));
    }
    if (group.length) flush();
    return result;
  }
  function dropStart(item, minute, offset, calendar) {
    const grid = bounds(calendar),
      start = minutes(item.startTime),
      duration = minutes(item.endTime) - start;
    return Math.max(
      grid.start,
      Math.min(
        grid.end - duration,
        start + Math.round((minute - offset - start) / 15) * 15,
      ),
    );
  }
  // Outer journey times belong to the event; only intermediate times live in journeys.json.
  function journey(item, details) {
    const result = structuredClone(details);
    result.legs[0].departure = item.startTime;
    result.legs.at(-1).arrival = item.endTime;
    return result;
  }
  return {
    journey,
    minutes,
    time,
    bounds,
    normalize,
    label,
    statusLabel,
    dayLabel,
    localDate,
    current,
    layout,
    dropStart,
  };
})();
