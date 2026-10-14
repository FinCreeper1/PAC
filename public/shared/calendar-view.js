/* Identical event contents, overlap geometry and day headings in portal and editor. */
globalThis.CalendarView = (() => {
  const text = (tag, value) => {
    const el = document.createElement(tag);
    el.textContent = value;
    return el;
  };
  function button(item, { agenda = false, selected, onSelect } = {}) {
    const b = document.createElement("button");
    b.type = "button";
    const kind =
      item.type === "travel"
        ? "train"
        : item.type === "event"
          ? "notice"
          : item.type === "free"
            ? "free"
            : "program";
    b.className = `${agenda ? "agenda-event" : "calendar-event"} ${kind}-event`;
    const duration =
      CalendarModel.minutes(item.endTime) - CalendarModel.minutes(item.startTime);
    if (!agenda && duration <= 45) b.classList.add("short-event");
    if (item.status === "provisional") b.classList.add("draft-event");
    if (item.display === "compact") b.classList.add("compact-event");
    if (item.id === selected) b.classList.add("active");
    b.dataset.eventId = item.id;
    b.setAttribute("aria-pressed", String(item.id === selected));
    b.append(
      text("span", CalendarModel.label(item)),
      text("strong", item.title),
    );
    for (const value of [
      item.subtitle,
      item.detail,
      item.location,
      item.responsible && `Verantwortlich: ${item.responsible}`,
      item.note,
      CalendarModel.statusLabel(item),
    ]) {
      if (value) {
        const note = text("small", value);
        note.className = "event-note-preview";
        b.append(note);
      }
    }
    b.setAttribute(
      "aria-label",
      [
        CalendarModel.label(item),
        item.title,
        item.responsible,
        CalendarModel.statusLabel(item),
      ]
        .filter(Boolean)
        .join(". "),
    );
    if (onSelect) b.onclick = () => onSelect(item, b);
    return b;
  }
  function weekEntries(events, calendar) {
    const time = CalendarModel.minutes;
    const start = CalendarModel.bounds(calendar).start;
    const duration = (item) => time(item.endTime) - time(item.startTime);
    const overlaps = (a, b) =>
      time(a.startTime) < time(b.endTime) && time(b.startTime) < time(a.endTime);
    const overlays = new Map();
    for (const item of [...events].sort((a, b) => duration(a) - duration(b))) {
      if (duration(item) > 90) continue;
      const parent = events
        .filter(
          (other) =>
            other !== item &&
            !overlays.has(other) &&
            time(item.startTime) - time(other.startTime) >= 50 &&
            time(other.endTime) - time(item.endTime) >= 30 &&
            duration(other) >= duration(item) * 3 &&
            ![...overlays].some(
              ([overlay, owner]) => owner === other && overlaps(overlay, item),
            ),
        )
        .sort((a, b) => duration(a) - duration(b))[0];
      if (parent) overlays.set(item, parent);
    }
    const entries = CalendarModel.layout(
      events.filter((item) => !overlays.has(item)),
      calendar,
    );
    for (const [item, parent] of overlays) {
      const lane = entries.find((entry) => entry.item === parent);
      if (!lane) continue;
      entries.push({
        item,
        column: lane.column,
        columns: lane.columns,
        top: time(item.startTime) - start,
        height: duration(item),
        overlay: true,
      });
    }
    return entries;
  }
  function week(grid, calendar, options = {}) {
    grid.replaceChildren();
    grid.classList.add("shared-week");
    const bounds = CalendarModel.bounds(calendar),
      today = CalendarModel.localDate();
    grid.style.setProperty("--schedule-duration", `${bounds.duration}px`);
    grid.style.gridTemplateColumns = `50px repeat(${calendar.days.length}, minmax(120px, 1fr))`;
    grid.append(text("div", ""));
    for (const day of calendar.days) {
      const head = text("strong", CalendarModel.dayLabel(day));
      head.className = "shared-day-head";
      head.dataset.date = day.isoDate;
      if (day.isoDate === today) head.classList.add("is-today");
      grid.append(head);
    }
    const axis = text("div", "");
    axis.className = "shared-time-axis";
    for (const value of calendar.timeSlots) {
      const label = text("time", value);
      label.style.top = `${CalendarModel.minutes(value) - bounds.start}px`;
      axis.append(label);
    }
    grid.append(axis);
    calendar.days.forEach((day, index) => {
      const column = text("div", "");
      column.className = "shared-day-column";
      column.dataset.day = index + 1;
      if (day.isoDate === today) column.classList.add("is-today");
      for (const entry of weekEntries(
        calendar.events.filter((e) => e.day === index + 1),
        calendar,
      )) {
        const b = button(entry.item, options);
        if (entry.columns > 1) b.classList.add("overlap-event");
        if (entry.columns > 2) b.classList.add("dense-overlap-event");
        if (entry.overlay) b.classList.add("inset-event");
        Object.assign(b.style, {
          top: `${entry.top}px`,
          height: `${entry.height}px`,
          left: `calc(${(entry.column / entry.columns) * 100}% + 2px)`,
          width: `calc(${100 / entry.columns}% - 4px)`,
        });
        const rendered = options.decorate?.(b, entry.item) || b;
        if (entry.overlay) rendered.classList.add("inset-event");
        column.append(rendered);
      }
      options.column?.(column, index + 1);
      grid.append(column);
    });
  }
  function agenda(list, calendar, day, options = {}) {
    list.replaceChildren();
    const events = calendar.events
      .filter((e) => e.day === day)
      .sort(
        (a, b) =>
          CalendarModel.minutes(a.startTime) -
          CalendarModel.minutes(b.startTime),
      );
    for (const item of events) {
      const b = button(item, { ...options, agenda: true });
      const rendered = options.decorate?.(b, item) || b;
      list.append(rendered);
    }
    if (!events.length) list.append(text("p", "Keine Termine an diesem Tag."));
  }
  return { button, week, agenda, weekEntries };
})();
