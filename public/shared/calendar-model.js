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
      : `${item.startTime}–${item.endTime}${item.journeyDate ? " · Nachtverbindung" : ""}`;
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
      minute,
      active,
      next,
      minutesUntil:
        next?.day === dayIndex + 1 ? minutes(next.startTime) - minute : null,
    };
  }
  // Mobile agenda order: today first, then upcoming days, past days last.
  function agendaGroups(calendar, date) {
    const indices = calendar.days.map((_, i) => i),
      today = indices.find((i) => calendar.days[i].isoDate === date);
    if (today === undefined) return { today: null, upcoming: indices, past: [] };
    return {
      today,
      upcoming: indices.filter((i) => i > today),
      past: indices.filter((i) => i < today),
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
          top: item.journeyDate ? Math.max(0, Math.min(bounds(calendar).duration - 15, minutes(item.startTime) - base)) : minutes(item.startTime) - base,
          height: item.journeyDate ? Math.max(15, Math.min(bounds(calendar).end, minutes(item.endTime)) - Math.max(base, minutes(item.startTime))) : minutes(item.endTime) - minutes(item.startTime),
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
  function validDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  }
  function extend(calendar, date) {
    if (!validDate(date) || !calendar.days.length || !calendar.days.every(d=>validDate(d.isoDate))) throw Error("Bitte ein gültiges Reisedatum wählen.");
    const result = structuredClone(calendar);
    // Add the requested day only: a distant date must not create years of empty columns.
    result.days = [...new Set(calendar.days.map(d=>d.isoDate).concat(date))].sort().map(isoDate=>({isoDate}));
    const indices = new Map(result.days.map((day,index)=>[day.isoDate,index+1]));
    for (const event of result.events) event.day = indices.get(calendar.days[event.day-1]?.isoDate);
    return result;
  }
  function journeyDays(data) {
    if (!data.endDate || data.endDate === data.date) return [data];
    if (!validDate(data.date) || !validDate(data.endDate) || data.endDate < data.date || (Date.parse(data.endDate)-Date.parse(data.date))/86400000 > 14) throw Error("Ungültiger Zeitraum der Zugverbindung.");
    const result=[];
    for(let stamp=Date.parse(data.date);stamp<=Date.parse(data.endDate);stamp+=86400000) {
      const date=new Date(stamp).toISOString().slice(0,10);
      const startTime=date===data.date?data.startTime:"00:00", endTime=date===data.endDate?data.endTime:"23:59";
      if (startTime===endTime) continue;
      result.push({...data,date,startTime,endTime,journeyDate:data.date,journeyEndDate:data.endDate});
    }
    return result;
  }
  // Outer journey times belong to the event; only intermediate times live in journeys.json.
  function journey(item, details) {
    const result = structuredClone(details);
    if (!result.legs[0].departureDate) {
      result.legs[0].departure = item.startTime;
      result.legs.at(-1).arrival = item.endTime;
    }
    return result;
  }
  return {
    journeyDays,
    extend,
    validDate,
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
    agendaGroups,
    layout,
    dropStart,
  };
})();
