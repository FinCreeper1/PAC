globalThis.CalendarExport = (() => {
  function calendarExportEvent(item, calendar) {
    const day = calendar.days[item.day - 1];
    const date = day.isoDate;
    const midnight = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(midnight.getTime()))
      throw new Error("Ungültiges Exportdatum.");
    const compactDate = (value) =>
      value.toISOString().slice(0, 10).replaceAll("-", "");
    const timed =
      item.timing !== "unscheduled" &&
      CalendarModel.minutes(item.startTime) !== null &&
      CalendarModel.minutes(item.endTime) !== null;
    const start =
      compactDate(midnight) +
      (timed ? `T${item.startTime.replace(":", "")}00` : "");
    if (!timed || item.endTime <= item.startTime)
      midnight.setUTCDate(midnight.getUTCDate() + 1);
    const end =
      compactDate(midnight) +
      (timed ? `T${item.endTime.replace(":", "")}00` : "");
    return {
      ...item,
      start,
      end,
      timed,
      description: [
        CalendarModel.label(item),
        item.subtitle,
        item.detail,
        item.note,
        item.responsible && `Verantwortlich: ${item.responsible}`,
        CalendarModel.statusLabel(item),
        item.url && `Reiseportal: ${item.url}`,
        !timed && "Uhrzeit noch offen; als ganztägiger Termin gespeichert.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  function escapeCalendarText(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\r\n|\r|\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");
  }

  function foldCalendarLine(line) {
    let result = "",
      bytes = 0;
    for (const char of line) {
      const length = new TextEncoder().encode(char).length;
      if (bytes + length > 75) {
        result += "\r\n ";
        bytes = 1;
      }
      result += char;
      bytes += length;
    }
    return result;
  }

  function buildCalendarFile(events, now = new Date()) {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Profilreise//Kalender//DE",
      "CALSCALE:GREGORIAN",
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Berlin",
      "BEGIN:DAYLIGHT",
      "DTSTART:19960331T020000",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0200",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "DTSTART:19961027T030000",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0100",
      "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
      "END:STANDARD",
      "END:VTIMEZONE",
    ];
    const stamp = now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
    for (const item of events) {
      const dateType = item.timed ? ";TZID=Europe/Berlin:" : ";VALUE=DATE:";
      lines.push(
        "BEGIN:VEVENT",
        `UID:profilreise-${item.id}@profilfahrt.linusfin.de`,
        `DTSTAMP:${stamp}`,
        `LAST-MODIFIED:${stamp}`,
        `STATUS:${item.status === "provisional" ? "TENTATIVE" : "CONFIRMED"}`,
        `DTSTART${dateType}${item.start}`,
        `DTEND${dateType}${item.end}`,
        `SUMMARY:${escapeCalendarText(item.title)}`,
        ...(item.location ? [`LOCATION:${escapeCalendarText(item.location)}`] : []),
        `DESCRIPTION:${escapeCalendarText(item.description)}`,
        ...(item.url ? [`URL:${item.url}`] : []),
        ...((item.attachments || []).map((attachment) =>
          `ATTACH${attachment.type ? `;FMTTYPE=${attachment.type}` : ""}:${attachment.url}`
        )),
        "END:VEVENT",
      );
    }
    return (
      [...lines, "END:VCALENDAR"].map(foldCalendarLine).join("\r\n") + "\r\n"
    );
  }

  function googleCalendarLink(item) {
    return (
      "https://calendar.google.com/calendar/render?" +
      new URLSearchParams({
        action: "TEMPLATE",
        text: item.title,
        dates: `${item.start}/${item.end}`,
        ctz: "Europe/Berlin",
        details: item.description,
        location: item.location || "",
      })
    );
  }

  return {
    calendarExportEvent,
    escapeCalendarText,
    foldCalendarLine,
    buildCalendarFile,
    googleCalendarLink,
  };
})();
