// Count down to the next scheduled calendar event in German local time.
(() => {
  const value = document.getElementById("submission-timer-value");
  const label = document.getElementById("submission-timer-label");
  if (!value || !label) return;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  function berlinTime(now) {
    const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  }
  const timer = value.closest(".submission-timer");
  let loaded = false;
  let settings = {};
  let targets = [];
  function loadTargets() {
    loaded = true;
    settings = portalCalendar.countdown || {};
    targets = portalCalendar.events.filter(item => item.timing === "scheduled")
      .map(item => {
        const date = portalCalendar.days[item.day - 1]?.isoDate;
        return { title: item.title, time: item.startTime,
          start: Date.parse(`${date}T${item.startTime}:00Z`) };
      }).filter(item => Number.isFinite(item.start));
    targets.sort((a, b) => a.start - b.start);
    update();
  }
  let timeout;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  function createDigits(time) { return Array.from(time, character => {
    const digit = document.createElement("span");
    digit.className = character === ":" ? "submission-timer-separator" : "submission-timer-digit";
    digit.textContent = character;
    digit.setAttribute("aria-hidden", "true");
    return digit;
  }); }
  let digits = createDigits("00:00:00");
  value.replaceChildren(...digits);
  let previousTime;
  function update() {
    clearTimeout(timeout);
    const now = new Date();
    const current = berlinTime(now);
    const deadline = settings.deadline;
    const deadlineActive = deadline && (!deadline.startAt || Date.parse(deadline.startAt) <= now.getTime()) && Date.parse(deadline.hideAt) > now.getTime();
    const next = deadlineActive ? {title: deadline.title, start: Date.parse(deadline.at), deadline: true} : targets.find(item => item.start > current);
    if (timer) {
      timer.hidden = settings.enabled === false || (loaded && !next);
      timer.classList.toggle("submission-timer-warning", Boolean(deadlineActive && Date.parse(deadline.at) - now.getTime() <= deadline.warningMinutes * 60000));
    }
    if (!next) {
      label.textContent = loaded ? "Keine kommenden Termine" : "Nächster Termin wird geladen …";
      value.hidden = true;
      timeout = setTimeout(update, 1000 - now.getMilliseconds());
      return;
    }
    value.hidden = false;
    const date = new Date(next.start).toLocaleDateString("de-DE", {
      timeZone: next.deadline ? undefined : "UTC", weekday: "short", day: "2-digit", month: "2-digit",
    });
    const remaining = next.start - (next.deadline ? now.getTime() : current);
    const clock = next.deadline ? new Date(next.start).toLocaleTimeString("de-DE", {hour:"2-digit", minute:"2-digit"}) : next.time;
    label.textContent = `${next.title} · ${date}, ${clock} Uhr${next.deadline && remaining <= 0 ? " · Abgabefrist abgelaufen" : next.deadline && remaining <= deadline.warningMinutes * 60000 ? " · Abgabe steht bevor" : ""}`;
    const seconds = Math.max(0, Math.round(remaining / 1000));
    const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(number => String(number).padStart(2, "0")).join(":");
    if (digits.length !== time.length) {
      digits = createDigits(time);
      value.replaceChildren(...digits);
    }
    value.setAttribute("aria-label", time);
    digits.forEach((digit, index) => {
      if (digit.textContent === time[index]) return;
      digit.getAnimations().forEach(animation => animation.cancel());
      digit.textContent = time[index];
      if (previousTime && !reducedMotion.matches && !document.hidden) {
        digit.animate([
          { transform: "translateY(-55%)", opacity: 0 },
          { transform: "translateY(0)", opacity: 1 },
        ], { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
      }
    });
    previousTime = time;
    timeout = setTimeout(update, 1000 - now.getMilliseconds());
  }
  document.addEventListener("visibilitychange", update);
  window.addEventListener("portal-calendar-ready", loadTargets);
  update();
})();

// Only a confirmed outage of both providers warrants a blocking notice.
let fileOutageNotice;
let fileOutageNotified = false;
function updateFileProviderNotice(unavailable) {
  if (!unavailable) {
    fileOutageNotified = false;
    if (fileOutageNotice?.open) fileOutageNotice.close();
    return;
  }
  if (fileOutageNotified) return;
  if (!fileOutageNotice) {
    fileOutageNotice = document.createElement("dialog");
    fileOutageNotice.className = "delete-dialog";
    fileOutageNotice.setAttribute("aria-labelledby", "file-outage-title");
    fileOutageNotice.setAttribute("aria-describedby", "file-outage-description");
    fileOutageNotice.innerHTML = `
      <form method="dialog">
        <h2 id="file-outage-title">Dateien derzeit nicht verfügbar</h2>
        <p id="file-outage-description">Der Dateispeicher ist gerade nicht erreichbar. Bereits offline gespeicherte Dateien bleiben verfügbar. Bitte versuche es später erneut.</p>
        <div class="delete-actions"><button type="submit" autofocus>Verstanden</button></div>
      </form>`;
    document.body.append(fileOutageNotice);
  }
  fileOutageNotified = true;
  fileOutageNotice.showModal();
}

document.querySelectorAll(".train-close").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

function closeOnBackdropClick(dialog, event) {
  if (event.target !== dialog) return;
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX >= bounds.right ||
      event.clientY < bounds.top || event.clientY >= bounds.bottom) dialog.close();
}

document.querySelectorAll(".train-dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => closeOnBackdropClick(dialog, event));
});

const eventDialog = document.getElementById("event-dialog");
let mapKitPromise;

function updateEventNotePreview(event, note) {
  const preview = event.querySelector(".event-note-preview");
  if (!preview) return;
  preview.textContent = note;
  preview.hidden = !note;
  event.setAttribute(
    "aria-label",
    [event.dataset.label, note].filter(Boolean).join(". "),
  );
}

function appleMapsLink(event) {
  if (event.dataset.mapRoute) {
    const points = JSON.parse(event.dataset.mapRoute).points;
    if (points.length > 1) {
      const coordinate = (p) => `${p.latitude},${p.longitude}`;
      const query = new URLSearchParams({
        source: coordinate(points[0]),
        destination: coordinate(points.at(-1)),
      });
      for (const point of points.slice(1, -1))
        query.append("waypoint", coordinate(point));
      return `https://maps.apple.com/directions?${query}`;
    }
  }
  const query = encodeURIComponent(event.dataset.location);
  return `https://maps.apple.com/?q=${query}&ll=${event.dataset.latitude},${event.dataset.longitude}`;
}

async function loadMapKit() {
  if (window.mapkit?.Map) return window.mapkit;
  if (mapKitPromise) return mapKitPromise;
  mapKitPromise = (async () => {
    const response = await fetch("/api/apple-maps-token");
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.error), { setupUrl: data.setupUrl });
    await new Promise((resolve, reject) => {
      window.initProfilreiseMapKit = resolve;
      const script = document.createElement("script");
      script.src = "https://cdn.apple-mapkit.com/mk/6/mapkit.core.js";
      script.crossOrigin = "anonymous";
      script.async = true;
      script.dataset.callback = "initProfilreiseMapKit";
      script.dataset.libraries = "map,annotations,overlays";
      script.dataset.token = data.token;
      script.addEventListener("error", () =>
        reject(new Error("Apple Maps konnte nicht geladen werden.")),
      );
      document.head.append(script);
    });
    delete window.initProfilreiseMapKit;
    return window.mapkit;
  })();
  return mapKitPromise;
}

function makeMarker(mapkit, point, index) {
  return new mapkit.MarkerAnnotation(
    new mapkit.Coordinate(point.latitude, point.longitude),
    {
      title: point.name,
      color: index === 0 ? "#465d51" : "#c81d25",
      glyphText: String(index + 1),
      accessibilityLabel: `${index + 1}. ${point.name}`,
    },
  );
}

async function renderEventMap(event, container) {
  const directLink = appleMapsLink(event);
  container.innerHTML = `<div class="map-loading">Karte wird geladen …</div><a class="map-link" href="${directLink}" target="_blank" rel="noopener">In Apple Maps öffnen ↗</a>`;
  try {
    if (window.PortalMaps && await PortalMaps.isOSM()) {
      container.replaceChildren();
      const canvas = document.createElement("div"); canvas.className = "map-canvas";
      container.append(canvas);
      const link = document.createElement("a"); link.className = "map-link";
      link.href = `https://www.openstreetmap.org/?mlat=${Number(event.dataset.latitude)}&mlon=${Number(event.dataset.longitude)}#map=14/${Number(event.dataset.latitude)}/${Number(event.dataset.longitude)}`;
      link.target = "_blank"; link.rel = "noopener"; link.textContent = "In OpenStreetMap öffnen ↗";
      container.append(link);
      const route = event.dataset.mapRoute ? JSON.parse(event.dataset.mapRoute) : null;
      const points = route?.points?.length ? route.points : [{latitude: Number(event.dataset.latitude), longitude: Number(event.dataset.longitude), name: event.dataset.location}];
      await PortalMaps.render(canvas, points, route?.geometry || route?.points.map(p => [p.latitude, p.longitude]));
      return;
    }
    const mapkit = await loadMapKit();
    const coordinate = new mapkit.Coordinate(
      Number(event.dataset.latitude),
      Number(event.dataset.longitude),
    );
    container.querySelector(".map-loading").remove();
    const canvas = document.createElement("div");
    canvas.className = "map-canvas";
    if (event.dataset.mapRoute) canvas.classList.add("route-map");
    container.prepend(canvas);
    const map = new mapkit.Map(canvas, {
      center: coordinate,
      cameraDistance: 18000,
      showsCompass: mapkit.FeatureVisibility.Hidden,
    });
    if (event.dataset.mapRoute) {
      const route = JSON.parse(event.dataset.mapRoute);
      const markers = route.points.map((point, index) =>
        makeMarker(mapkit, point, index),
      );
      const geometry =
        route.geometry || route.points.map((p) => [p.latitude, p.longitude]);
      const items = [...markers];
      if (geometry.length > 1)
        items.unshift(
          new mapkit.PolylineOverlay(
            geometry.map((p) => new mapkit.Coordinate(...p)),
            {
              style: new mapkit.Style({ lineWidth: 4, strokeColor: "#c81d25" }),
            },
          ),
        );
      if (items.length)
        map.showItems(items, { padding: new mapkit.Padding(42, 42, 42, 42) });
      else
        map.addAnnotation(
          makeMarker(
            mapkit,
            {
              name: event.dataset.location,
              latitude: coordinate.latitude,
              longitude: coordinate.longitude,
            },
            0,
          ),
        );
    } else {
      const marker = makeMarker(
        mapkit,
        {
          name: event.dataset.location,
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
        },
        0,
      );
      map.addAnnotation(marker);
    }
  } catch (error) {
    const loading = container.querySelector(".map-loading");
    if (!loading) {
      container.querySelector(".map-canvas")?.remove();
      container.insertAdjacentHTML(
        "afterbegin",
        '<div class="map-loading"></div>',
      );
    }
    container.querySelector(".map-loading").innerHTML = error.setupUrl
      ? `Apple Maps ist noch nicht verbunden. <a href="${error.setupUrl}" target="_blank" rel="noopener">MapKit-Token erstellen ↗</a>`
      : "Die Karte konnte gerade nicht geladen werden.";
  }
}

async function loadVisibleEventNote(item) {
  if (Object.hasOwn(item, "note")) return item.note || "";
  try {
    const response = await fetch(
      `/api/notes?event=${encodeURIComponent(item.id)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return "";
    const data = await response.json();
    item.note = data.note || "";
    return item.note;
  } catch {
    return "";
  }
}

function eventInformation(item) {
  const section = createTextElement("section", "");
  section.className = "event-information";
  for (const [label, value] of [
    ["Zeit", CalendarModel.label(item)],
    ["Programm", item.subtitle],
    ["Details", item.detail],
    ["Verantwortlich", item.responsible],
    ["Status", CalendarModel.statusLabel(item)],
  ]) {
    if (!value) continue;
    const row = createTextElement("div", "");
    row.append(createTextElement("strong", label), createTextElement("p", value));
    section.append(row);
  }
  return section;
}

function openEventExtras(event, dialog) {
  const item = portalCalendar.events.find(
    (item) => item.id === event.dataset.eventId,
  );
  const container = dialog?.querySelector(".event-extras");
  if (!item || !container) return;
  container.replaceChildren();
  container.append(eventInformation(item));
  const noteSection = createTextElement("section", "");
  noteSection.className = "event-note";
  const noteTitle = createTextElement("strong", "Notizen");
  const noteText = createTextElement("p", "Notizen werden geladen …");
  noteSection.append(noteTitle, noteText);
  container.append(noteSection);
  loadVisibleEventNote(item).then((note) => {
    if (!noteText.isConnected) return;
    noteText.textContent = note || "Für diesen Termin ist keine Notiz hinterlegt.";
    noteText.classList.toggle("is-empty", !note);
  });
  addEventExport(container, item.id);
  if (item.showMap !== false && Number.isFinite(item.latitude) && Number.isFinite(item.longitude)) {
    const section = createTextElement("section", "");
    section.className = "event-map";
    const heading = createTextElement("div", "");
    heading.className = "event-map-heading";
    heading.append(
      createTextElement("strong", "Ort"),
      createTextElement("p", item.location),
    );
    if (item.routeRef || item.mapRoute) {
      heading.append(
        createTextElement(
          "small",
          "Die Karte dient zur Orientierung. Maßgeblich sind die Reisedetails.",
        ),
      );
    }
    section.append(heading);
    const map = createTextElement("div", "");
    map.className = "map-container";
    section.append(map);
    container.append(section);
    resolveRoute(item)
      .then((route) => {
        if (!map.isConnected) return;
        if (route) event.dataset.mapRoute = JSON.stringify(route);
        return renderEventMap(event, map);
      })
      .catch(() => {
        map.textContent =
          "Route nicht verfügbar. Die Reisedetails bleiben im Kalender lesbar.";
      });
  }
}

async function resolveRoute(item) {
  if (item.mapRoute) return item.mapRoute;
  if (!item.routeRef) return null;
  const response = await fetch(
    `/data/routes/${encodeURIComponent(item.routeRef)}.json`,
  );
  if (!response.ok) throw Error("Route nicht verfügbar.");
  return response.json();
}

document
  .querySelector(".event-dialog-close")
  .addEventListener("click", () => eventDialog.close());
eventDialog.addEventListener("click", (event) => {
  closeOnBackdropClick(eventDialog, event);
});

function bindCalendarEvent(event) {
  event.addEventListener("click", () => {
    if (event.dataset.action === "journey") {
      const detail = document.getElementById(event.dataset.dialog);
      openEventExtras(event, detail);
      openEventMaterials(event, detail);
      detail.showModal();
      return;
    }
    openEvent(event);
  });
}

function createTextElement(tag, value) {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
}

const exportEvents = new Map();
const {
  calendarExportEvent,
  escapeCalendarText,
  foldCalendarLine,
  buildCalendarFile,
  googleCalendarLink,
} = CalendarExport;
let portalCalendar,
  tripConfig,
  journeys = {};

function downloadCalendar(events, filename) {
  const url = URL.createObjectURL(
    new Blob([buildCalendarFile(events)], {
      type: "text/calendar;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function addEventExport(container, eventId) {
  const item = exportEvents.get(eventId);
  if (!item) return;
  const brandIcon = (name) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("calendar-brand-icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#logo-${name}`);
    svg.append(use);
    return svg;
  };
  const actions = document.createElement("section");
  actions.className = "calendar-export-actions event-export-actions";
  const button = createTextElement("button", "iCalendar (.ics)");
  button.type = "button";
  button.prepend(brandIcon("apple"));
  button.addEventListener("click", () =>
    downloadCalendar([item], `${item.id}.ics`),
  );
  const google = createTextElement("a", "Google Kalender");
  google.prepend(brandIcon("google"));
  google.href = googleCalendarLink(item);
  google.target = "_blank";
  google.rel = "noopener noreferrer";
  actions.append(button, google);
  container.prepend(actions);
}

function decorateEvent(button, item) {
  Object.assign(button.dataset, {
    action: "event",
    location: item.location || item.title,
    latitude: item.latitude,
    longitude: item.longitude,
  });
  if (item.journeyId && journeys[item.journeyId])
    Object.assign(button.dataset, {
      action: "journey",
      dialog: journeys[item.journeyId].dialog,
    });
  bindCalendarEvent(button);
  // Offline status is informational; clicking the card still opens the event.
  const wrapper = document.createElement("div");
  wrapper.className = button.classList.contains("calendar-event") ? "event-download-card calendar-download-card" : "event-download-card";
  wrapper.style.cssText = button.style.cssText;
  button.style.cssText = "";
  const download = document.createElement("span");
  download.setAttribute("role", "img");
  download.className = "event-offline-download";
  download.dataset.offlineEvent = item.id;
  download.dataset.eventTitle = item.title;
  download.hidden = true;
  download.textContent = "↓";
  wrapper.append(button, download);
  window.OfflineFiles?.refreshEvents?.();
  return wrapper;
}

let todayTimer;
function updateToday() {
  if (!portalCalendar) return;
  const state = CalendarModel.current(portalCalendar),
    box = document.getElementById("today-summary");
  box.replaceChildren();
  const day = portalCalendar.days[state.dayIndex];
  box.append(
    createTextElement(
      "h2",
      day
        ? `Heute · ${CalendarModel.dayLabel(day)}`
        : state.date < tripConfig.startDate
          ? "Die nächste Profilreise"
          : "Reiseplan",
    ),
  );
  if (state.active.length)
    for (const item of state.active) {
      const button = CalendarView.button(item, { agenda: true });
      box.append(createTextElement("p", "Jetzt"), decorateEvent(button, item));
    }
  else
    box.append(
      createTextElement(
        "p",
        day
          ? "Gerade kein angesetzter Termin."
          : state.date < tripConfig.startDate
            ? `Beginn am ${CalendarModel.dayLabel(portalCalendar.days[0])}`
            : "Die Profilreise ist beendet. Der vollständige Plan bleibt verfügbar.",
      ),
    );
  if (state.next) {
    box.append(
      createTextElement(
        "p",
        `Als Nächstes${state.minutesUntil !== null ? ` · in ${state.minutesUntil} Minuten` : ` · ${CalendarModel.dayLabel(portalCalendar.days[state.next.day - 1])}`}`,
      ),
    );
    const button = CalendarView.button(state.next, { agenda: true });
    box.append(decorateEvent(button, state.next));
  }
  document
    .querySelectorAll("[data-date]")
    .forEach((el) =>
      el.classList.toggle("is-today", el.dataset.date === state.date),
    );
  arrangeAgenda(state);
}

// Today, the following days and the past days form separate, labelled groups.
function arrangeAgenda(state) {
  const agenda = document.querySelector(".mobile-agenda"),
    sections = [...agenda.querySelectorAll(".agenda-day")],
    groups = CalendarModel.agendaGroups(portalCalendar, state.date);
  if (sections.length !== portalCalendar.days.length) return;
  const minute = CalendarModel.minutes(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()),
  );
  sections.forEach((section, i) => {
    const heading = section.querySelector("h2"),
      label = CalendarModel.dayLabel(portalCalendar.days[i]);
    heading.textContent = i === groups.today ? `Heute · ${label}` : label;
    section.querySelectorAll(".agenda-event[data-event-id]").forEach((button) => {
      const item = portalCalendar.events.find((e) => e.id === button.dataset.eventId);
      button.classList.toggle("is-past",
        i === groups.today && item?.timing !== "unscheduled" &&
          CalendarModel.minutes(item.endTime) <= minute);
    });
  });
  const groupLabel = (text) => {
    const label = createTextElement("p", text);
    label.className = "agenda-group-label";
    return label;
  };
  const parts = [];
  if (groups.today !== null) {
    parts.push(sections[groups.today]);
    if (groups.upcoming.length) parts.push(groupLabel("Nächste Tage"));
  }
  parts.push(...groups.upcoming.map((i) => sections[i]));
  if (groups.past.length) {
    const past = agenda.querySelector(".agenda-past") || document.createElement("details");
    past.className = "agenda-past";
    const summary = createTextElement("summary", `Vergangene Tage (${groups.past.length})`);
    past.replaceChildren(summary, ...groups.past.map((i) => sections[i]));
    parts.push(past);
  }
  agenda.replaceChildren(...parts);
}

function renderJourneys() {
  for (const [id, details] of Object.entries(journeys)) {
    const item = portalCalendar.events.find((e) => e.journeyId === id);
    if (!item) continue;
    const journey = CalendarModel.journey(item, details);
    const dialog = document.createElement("dialog");
    dialog.id = journey.dialog;
    dialog.className = "calendar-train-detail train-dialog";
    const heading = createTextElement("div", "");
    heading.className = "detail-heading";
    const title = createTextElement("div", "");
    title.append(
      createTextElement(
        "span",
        CalendarModel.dayLabel(portalCalendar.days[item.day - 1]),
      ),
      createTextElement("strong", journey.heading),
    );
    const controls = createTextElement("div", "");
    controls.className = "live-controls";
    const status = createTextElement("span", "Live-Daten werden geladen …");
    status.id = journey.statusId;
    const refresh = createTextElement("button", "Aktualisieren");
    refresh.type = "button";
    refresh.id = journey.buttonId;
    const close = createTextElement("button", "×");
    close.type = "button";
    close.className = "train-close";
    close.setAttribute("aria-label", "Zugverbindung schließen");
    close.onclick = () => dialog.close();
    controls.append(status, refresh, close);
    heading.append(title, controls);
    dialog.append(heading);
    for (const [legIndex, leg] of journey.legs.entries()) {
      const row = createTextElement("div", "");
      row.className = "train-leg";
      row.dataset.liveTrain = leg.service;
      const departure = createTextElement("time", "");
      const live = createTextElement("em", "—");
      live.id = leg.timeId;
      departure.append(
        createTextElement("span", "Abfahrt · Plan"),
        createTextElement("strong", leg.departure + (leg.departureDate ? ` · ${leg.departureDate}` : "")),
        live,
      );
      const origin = createTextElement("div", "");
      const originTitle = createTextElement("strong", leg.origin + " · ");
      const platform = createTextElement("span", leg.platform);
      platform.id = leg.platformId;
      originTitle.append(platform);
      origin.append(originTitle, createTextElement("span", leg.service));
      const arrival = createTextElement("time", "");
      const arrivalLive = createTextElement("em", "Live-Daten fehlen");
      arrivalLive.id = `${leg.timeId}-arrival`;
      arrival.append(
        createTextElement("span", "Ankunft · Plan"),
        createTextElement("strong", leg.arrival + (leg.arrivalDate ? ` · ${leg.arrivalDate}` : "")),
        arrivalLive,
      );
      const destination = createTextElement("div", "");
      destination.append(
        Object.assign(createTextElement("strong", leg.destination), { id: `${leg.platformId}-arrival` }),
        createTextElement("span", "Ankunft"),
      );
      const badge = createTextElement("b", "Noch keine Live-Daten");
      badge.id = leg.delayId;
      badge.className = "live-badge waiting";
      row.append(departure, origin, arrival, destination, badge);
      dialog.append(row);
      if (journey.legs[legIndex + 1]) {
        const transfer = createTextElement("div", "Umstiegszeit wird berechnet …");
        transfer.id = `${leg.timeId}-transfer`;
        transfer.className = "train-transfer";
        transfer.setAttribute("aria-live", "polite");
        dialog.append(transfer);
      }
    }
    const journeyFooter = createTextElement("div", "");
    journeyFooter.className = "journey-footer";
    const link = createTextElement("a", "Verbindung auf bahn.de ansehen ↗");
    link.className = "bahn-link";
    link.href = journey.url;
    link.target = "_blank";
    link.rel = "noopener";
    const credits = createTextElement("p", "");
    credits.className = "journey-credits";
    const source = (label, text, href) => {
      const item = createTextElement("span", label + " ");
      const anchor = createTextElement("a", text);
      anchor.href = href;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      item.append(anchor);
      return item;
    };
    if (journey.source === "transport-rest")
      credits.append(source("Fahrplan:", "transport.rest", "https://v6.db.transport.rest/"));
    if (journey.source === "transitous")
      credits.append(
        source("Fahrplan:", "Transitous", "https://transitous.org/sources/"),
        source("Haltestellen:", "© OpenStreetMap-Mitwirkende", "https://www.openstreetmap.org/copyright"),
      );
    credits.append(
      source("Echtzeit:", "Deutsche Bahn (IRIS)", "https://developers.deutschebahn.com/db-api-marketplace/apis/product/timetables"),
    );
    if (journey.url) journeyFooter.append(link);
    journeyFooter.append(credits);
    dialog.append(journeyFooter);
    const extras = createTextElement("div", "");
    extras.className = "event-extras";
    dialog.append(extras);
    document.body.append(dialog);
    dialog.addEventListener("click", (e) => {
      closeOnBackdropClick(dialog, e);
    });
    const date = portalCalendar.days[item.day - 1].isoDate.replaceAll("-", "");
    const liveJourney = {
      ...journey,
      date,
      irisDate: date.slice(2),
      trains: journey.legs.map((leg) => ({
        ...leg,
        hour: Number(leg.departure.slice(0, 2)),
      })),
    };
    refresh.onclick = () => refreshLiveTrains(liveJourney);
    refreshLiveTrains(liveJourney);
    setInterval(() => {
      if (!document.hidden && dialog.open && navigator.onLine)
        refreshLiveTrains(liveJourney);
    }, 60000);
  }
}

async function loadCalendar() {
  const grid = document.querySelector(".week-grid"),
    agenda = document.querySelector(".mobile-agenda");
  try {
    const responses = await Promise.all(
      [
        "/data/calendar.json",
        "/data/trip.json",
        "/data/journeys.json",
      ].map((url) =>
        fetch(url, {
          cache: "no-store",
          headers: { accept: "application/json" },
        }),
      ),
    );
    if (
      responses.some(
        (r) =>
          !r.ok || !r.headers.get("content-type")?.includes("application/json"),
      )
    )
      throw Error("Kalender nicht verfügbar. Bitte online erneut anmelden.");
    const [data, trip, travel] = await Promise.all(
      responses.map((r) => r.json()),
    );
    tripConfig = trip;
    journeys = travel;
    portalCalendar = CalendarModel.normalize(data, trip);
    document.title = trip.title + " · Reiseportal";
    document.querySelector(".brand-title").textContent = trip.title;
    document.getElementById("kalender-title").textContent = trip.title;
    const range = new Intl.DateTimeFormat("de-DE", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).formatRange(new Date(trip.startDate), new Date(trip.endDate));
    document
      .querySelectorAll(".header-date,.date-line")
      .forEach((el) => (el.textContent = range));
    document.querySelector(".site-footer .trip-title").textContent = trip.title;
    const updated =
      data.publishedAt || responses[0].headers.get("last-modified");
    document.getElementById("published-at").textContent = updated
      ? `${data.publicationSource === "file" || !data.publishedAt ? "Quelldatei aktualisiert" : "Zuletzt veröffentlicht"}: ${new Date(updated).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}`
      : "Veröffentlichungszeitpunkt noch nicht verfügbar";
    const cached = responses[0].headers.get("x-offline-cached-at");
    document.getElementById("offline-status").textContent = cached
      ? `Offline · lokaler Stand vom ${new Date(cached).toLocaleString("de-DE")}`
      : "Kalender online geladen";
    exportEvents.clear();
    for (const item of portalCalendar.events)
      exportEvents.set(item.id, calendarExportEvent(item, portalCalendar));
    renderJourneys();
    // Legacy shared notes remain visible until the first administrative publication.
    const legacyNotes = portalCalendar.events.filter(
      (item) => !Object.hasOwn(item, "note"),
    );
    for (const item of legacyNotes)
      fetch(`/api/notes?event=${encodeURIComponent(item.id)}`)
        .then((r) => (r.ok ? r.json() : {}))
        .then((data) => {
          if (data.note) {
            item.note = data.note;
            exportEvents.set(
              item.id,
              calendarExportEvent(item, portalCalendar),
            );
            document
              .querySelectorAll(`[data-event-id="${item.id}"]`)
              .forEach((button) => {
                const note = createTextElement("small", data.note);
                note.className = "event-note-preview";
                button.append(note);
              });
          }
        })
        .catch(() => {});
    CalendarView.week(grid, portalCalendar, { decorate: decorateEvent });
    agenda.replaceChildren();
    portalCalendar.days.forEach((day, i) => {
      const section = createTextElement("section", "");
      section.className = "agenda-day";
      section.dataset.date = day.isoDate;
      section.append(createTextElement("h2", CalendarModel.dayLabel(day)));
      const list = createTextElement("div", "");
      CalendarView.agenda(list, portalCalendar, i + 1, {
        decorate: decorateEvent,
      });
      section.append(list);
      agenda.append(section);
    });
    const exportButton = document.getElementById("export-all-events");
    exportButton.disabled = !exportEvents.size;
    exportButton.onclick = () =>
      downloadCalendar([...exportEvents.values()], `${trip.id}.ics`);
    setupDayPlanPrint(data, cached);
    updateToday();
    clearInterval(todayTimer);
    todayTimer = setInterval(updateToday, 60000);
    window.portalCalendarReady = true;
    window.dispatchEvent(new Event("portal-calendar-ready"));
    // Cache referenced routes proactively so travel details work after the first visit.
    if ("serviceWorker" in navigator) {
      try {
        await navigator.serviceWorker.register("/sw.js");
        const worker = await navigator.serviceWorker.ready;
        worker.active?.postMessage({
          type: "CACHE_PORTAL",
          routes: [
            ...new Set(
              portalCalendar.events.map((e) => e.routeRef).filter(Boolean),
            ),
          ],
        });
      } catch {
        // Cache/update failures must never replace an already loaded calendar.
        if (!cached)
          document.getElementById("offline-status").textContent =
            "Kalender geladen · Offline-Speicherung derzeit nicht verfügbar";
      }
    }
  } catch (error) {
    grid.replaceChildren(createTextElement("p", error.message));
    agenda.replaceChildren(createTextElement("p", error.message));
  }
}

const IRIS_BASE = "https://iris.noncd.db.de/iris-tts/timetable";
function parseIrisTime(value) {
  if (!value || value.length < 10) return null;
  return new Date(
    2000 + Number(value.slice(0, 2)),
    Number(value.slice(2, 4)) - 1,
    Number(value.slice(4, 6)),
    Number(value.slice(6, 8)),
    Number(value.slice(8, 10)),
  );
}

function formatTime(date) {
  return (
    date?.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) ??
    "—"
  );
}

async function fetchLiveStop(train, irisDate, station, hour, event) {
  if (!station) return null;
  const [planResponse, changesResponse] = await Promise.all([
    fetch(`${IRIS_BASE}/plan/${station}/${irisDate}/${String(hour).padStart(2, "0")}`),
    fetch(`${IRIS_BASE}/fchg/${station}`),
  ]);
  if (!planResponse.ok || !changesResponse.ok) return null;
  const parser = new DOMParser();
  const plan = parser.parseFromString(await planResponse.text(), "text/xml");
  const changes = parser.parseFromString(await changesResponse.text(), "text/xml");
  const stop = [...plan.querySelectorAll("s")].find((item) =>
    item.querySelector("tl")?.getAttribute("n") === train.number && item.querySelector(event));
  if (!stop) return null;
  const scheduled = stop.querySelector(event);
  const changed = [...changes.querySelectorAll("s")]
    .find(item => item.getAttribute("id") === stop.getAttribute("id"))?.querySelector(event);
  const planned = parseIrisTime(scheduled.getAttribute("pt"));
  const current = parseIrisTime(changed?.getAttribute("ct")) || planned;
  if (!planned || !current) return null;
  return { planned, current,
    platform: changed?.getAttribute("cp") || scheduled.getAttribute("pp"),
    cancelled: (changed?.getAttribute("cs") || scheduled.getAttribute("ps")) === "c",
    delay: Math.round((current - planned) / 60000) };
}

async function fetchLiveTrain(train, irisDate) {
  const safeStop = (...args) => fetchLiveStop(...args).catch(() => null);
  const arrivalHour = Number(train.arrival.slice(0, 2));
  const arrivalDate = train.arrivalDate ? train.arrivalDate.replaceAll("-", "").slice(2) : train.arrival < train.departure
    ? (() => { const date = parseIrisTime(`${irisDate}1200`); date.setDate(date.getDate() + 1);
        return `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`; })()
    : irisDate;
  const [departure, arrival] = await Promise.all([
    safeStop(train, irisDate, train.station, train.hour, "dp"),
    safeStop(train, arrivalDate, train.arrivalStation, arrivalHour, "ar"),
  ]);
  return { departure, arrival };
}

function transferState(train, next, data, nextData) {
  const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const planned = (minutes(next.departure) - minutes(train.arrival) + 1440) % 1440;
  if (data?.arrival?.cancelled || nextData?.departure?.cancelled || data?.departure?.cancelled)
    return { tone: "cancelled", text: "Umstieg nicht möglich · Zug fällt aus" };
  if (!data?.arrival || !nextData?.departure)
    return { tone: "waiting", text: `Umstieg · ${planned} Min. laut Plan · Live-Daten unvollständig` };
  const current = Math.round((nextData.departure.current - data.arrival.current) / 60000);
  const delta = current - planned;
  const change = delta < 0 ? `${-delta} Min. weniger` : delta > 0 ? `${delta} Min. mehr` : "unverändert";
  const hint = current < 0 ? "Anschluss nicht erreichbar" : current < 5 ? "Sehr knapper Anschluss" : current < 10 ? "Wenig Zeit zum Umsteigen" : "Zeit zum Umsteigen";
  return { tone: current < 0 ? "cancelled" : current < 10 ? "delayed" : "on-time",
    text: `${hint} · ${Math.max(0, current)} Min. · ${change} (Plan: ${planned} Min.)` };
}

function renderLiveTrain(train, data) {
  const time = document.getElementById(train.timeId);
  const platform = document.getElementById(train.platformId);
  const badge = document.getElementById(train.delayId);
  const arrivalTime = document.getElementById(`${train.timeId}-arrival`);
  const destination = document.getElementById(`${train.platformId}-arrival`);
  const arrival = data?.arrival;
  arrivalTime.textContent = arrival ? arrival.cancelled ? "Halt fällt aus" : `Aktuell ${formatTime(arrival.current)}` : "Live-Daten fehlen";
  destination.textContent = arrival?.platform
    ? `${train.destination.split(" · ")[0]} · Gleis ${arrival.platform}` : train.destination;
  data = data?.departure;
  time.textContent = "Live-Daten fehlen";
  platform.textContent = train.platform;
  badge.className = "live-badge";
  if (!data) {
    badge.classList.add("waiting");
    badge.textContent = "Noch keine Live-Daten";
    return;
  }
  time.textContent = `Aktuell ${formatTime(data.current)}`;
  if (data.platform) platform.textContent = `Gleis ${data.platform}`;
  if (data.cancelled) {
    badge.classList.add("cancelled");
    badge.textContent = "Zug fällt aus";
  } else if (data.delay > 0) {
    badge.classList.add("delayed");
    badge.textContent = `+${data.delay} Min.`;
  } else {
    badge.classList.add("on-time");
    badge.textContent = data.delay < 0 ? `${-data.delay} Min. früher` : "Pünktliche Abfahrt";
  }
}

async function refreshLiveTrains(journey) {
  const status = document.getElementById(journey.statusId);
  const button = document.getElementById(journey.buttonId);
  status.textContent = "Live-Daten werden geladen …";
  button.disabled = true;
  try {
    const results = await Promise.all(
      journey.trains.map((train) => fetchLiveTrain(train, train.departureDate?.replaceAll("-", "").slice(2) || journey.irisDate)),
    );
    journey.trains.forEach((train, index) =>
      renderLiveTrain(train, results[index]),
    );
    journey.trains.forEach((train, index) => {
      const next = journey.trains[index + 1];
      if (!next) return;
      const state = transferState(train, next, results[index], results[index + 1]);
      const transfer = document.getElementById(`${train.timeId}-transfer`);
      transfer.className = `train-transfer ${state.tone}`;
      transfer.textContent = state.text;
    });
    status.textContent = results.some(result => result.departure || result.arrival)
      ? `Aktualisiert ${new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
      : "Noch keine Live-Daten verfügbar";
  } catch {
    status.textContent = "Live-Daten derzeit nicht erreichbar";
  } finally {
    button.disabled = false;
  }
}

const materialDialog = document.getElementById("material-dialog");
const eventMaterials = document.getElementById("event-materials");
const resourceList = document.getElementById("resource-list");
const uploadForm = document.getElementById("upload-form");
const uploadToggle = document.getElementById("upload-toggle");
const uploadStatus = document.getElementById("upload-status");
const deleteDialog = document.getElementById("delete-dialog");
const deleteForm = document.getElementById("delete-form");
const deleteStatus = document.getElementById("delete-status");
const materialsByEvent = new Map();
const deletedFileIds = new Set();
let activeTopicId = null;
let pendingDelete = null;

function escapeHtml(value) {
  return String(value).replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character],
  );
}

// Keep the card marks passive; saving is an explicit action beside the event files.
let eventOfflineSaving = false;
function configureEventOfflineSave(files) {
  const button = document.getElementById("event-offline-save");
  const available = document.getElementById("event-offline-available");
  const progress = document.getElementById("event-offline-progress");
  if (!button) return;
  const eventId = activeTopicId;
  const item = portalCalendar?.events.find((event) => event.id === eventId);
  const isoDate = item && portalCalendar.days[item.day - 1]?.isoDate;
  // Wait for the cache check before offering another download.
  button.hidden = true;
  available.hidden = true;
  button.disabled = eventOfflineSaving;
  button.textContent = eventOfflineSaving ? "Wird gespeichert …" : "Offline verfügbar machen";
  if (!eventOfflineSaving) progress.textContent = "";
  button.onclick = async () => {
    if (eventOfflineSaving) return;
    eventOfflineSaving = true;
    button.disabled = true;
    button.textContent = "Wird gespeichert …";
    const report = (text) => { if (activeTopicId === eventId) progress.textContent = text; };
    try {
      const saved = await window.OfflineFiles.saveEvent(files.map((file) => ({
        ...file, event: eventId, isoDate,
        url: `/api/files/${encodeURIComponent(eventId)}/${encodeURIComponent(file.id)}`,
        materialsUrl: `/api/materials?project=${encodeURIComponent(eventId)}`,
      })), item.title, report);
      if (saved && activeTopicId === eventId) {
        button.hidden = true;
        available.hidden = false;
        report("");
      }
    } catch {
      report("Die Unterlagen konnten nicht vollständig gespeichert werden.");
    } finally {
      eventOfflineSaving = false;
      button.disabled = false;
      button.textContent = "Offline verfügbar machen";
    }
  };
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function fileSourceLabel(file) {
  const labels = {hetzner:"Hetzner", cloud:"Wolke", offline:"Auf diesem Gerät"};
  if (!labels[file.source]) return "";
  const mark = file.source === "hetzner"
    ? '<svg class="file-provider-mark" aria-hidden="true" viewBox="0 0 16 16"><rect width="16" height="16" rx="1" fill="#d50c2d"/><path d="M4 3h2v4h4V3h2v10h-2V9H6v4H4z" fill="white"/></svg>'
    : '<svg class="file-provider-mark" aria-hidden="true" viewBox="0 0 16 16"><path d="M4 12h8a3 3 0 0 0 .4-6 4.5 4.5 0 0 0-8.5-.8A3.4 3.4 0 0 0 4 12Z" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
  const places = (file.storedAt || []).filter((key) => key !== "offline" && labels[key]).map((key) => labels[key]);
  const saved = file.source !== "offline" && places.length ? ` · Gespeichert: ${places.join(" + ")}` : "";
  return `<span class="file-storage-source">${mark} Quelle: ${labels[file.source]}${saved}</span>`;
}

function renderMaterials(uploaded = [], emptyMessage = "Keine Dateien vorhanden.") {
  configureEventOfflineSave(uploaded);
  const storedMaterials = uploaded.map((file) => ({
    type: escapeHtml(
      file.name.split(".").pop()?.toUpperCase().slice(0, 5) || "DATEI",
    ),
    title: escapeHtml(file.name),
    description: `${formatFileSize(file.size)} · hochgeladen ${new Date(file.uploadedAt).toLocaleDateString("de-DE")}`,
    url: `/api/files/${encodeURIComponent(activeTopicId)}/${encodeURIComponent(file.id)}`,
    id: escapeHtml(file.id),
    uploaded: true,
    sourceLabel: fileSourceLabel(file),
  }));
  if (storedMaterials.length === 0) {
    resourceList.innerHTML =
      `<p class="resource-empty">${escapeHtml(emptyMessage)}</p>`;
    return;
  }
  resourceList.innerHTML = storedMaterials
    .map(
      (material) => `
    <div class="resource-row">
      <span class="resource-icon">${material.type}</span>
      <div class="resource-copy"><strong>${material.title}</strong><span>${material.description}</span>${material.sourceLabel}</div>
      <div class="resource-actions">
        <a href="${material.url}" target="_blank" rel="noopener">Ansehen</a>
        <a href="${material.url}?download" download>Herunterladen</a>
        <button class="delete-material" type="button" data-file-id="${material.id}">Löschen</button>
      </div>
    </div>
  `,
    )
    .join("");
}

// Keep status inside the file area. Failed live requests never erase known files.
let materialsLoadSequence = 0;
function materialsMessage(text) {
  document.getElementById("materials-status").textContent = text;
}
async function showOfflineAvailability(eventId, files, message = "", sequence = materialsLoadSequence) {
  if (!files.length || !window.OfflineFiles) return;
  const button = document.getElementById("event-offline-save");
  const available = document.getElementById("event-offline-available");
  const current = () => sequence === materialsLoadSequence && activeTopicId === eventId;
  try {
    const result = await window.OfflineFiles.status(files.map((file) => ({url:`/api/files/${encodeURIComponent(eventId)}/${encodeURIComponent(file.id)}`})));
    if (!current()) return;
    const complete = result.total > 0 && result.cached === result.total;
    if (button) button.hidden = complete || !window.OfflineFiles.saveEvent;
    if (available) available.hidden = !complete;
    if (complete)
      materialsMessage([message, "Offline verfügbar"].filter(Boolean).join(" "));
  } catch {
    // Do not claim availability without confirmation; retrying the save is safe.
    if (current()) {
      if (button) button.hidden = !window.OfflineFiles.saveEvent;
      if (available) available.hidden = true;
    }
  }
}
async function loadMaterials(eventId) {
  const sequence = ++materialsLoadSequence;
  const known = materialsByEvent.get(eventId) || [];
  renderMaterials(known, "Dateien werden geladen …");
  materialsMessage("");
  let notice = "";
  try {
    const response = await fetch(`/api/materials?project=${encodeURIComponent(eventId)}`);
    const bothUnavailable = response.headers.get("x-file-providers-unavailable") === "1";
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (sequence === materialsLoadSequence && activeTopicId === eventId)
        updateFileProviderNotice(bothUnavailable || errorData.providersUnavailable === true);
      throw new Error();
    }
    const data = await response.json();
    if (!Array.isArray(data.files)) throw new Error();
    const fallback = response.headers.get("x-offline-materials");
    // A successful live response is authoritative; stale responses only supplement memory.
    const incoming = fallback ? data.files.map((file) => ({...file, source:"offline"})) : data.files;
    const files = [...incoming, ...(fallback ? known.map((file) => ({...file, source:"offline"})) : [])]
      .filter((file) => !deletedFileIds.has(`${eventId}/${file.id}`))
      .filter((file, index, all) => all.findIndex((candidate) => candidate.id === file.id) === index)
      .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
    if (sequence !== materialsLoadSequence) return;
    materialsByEvent.set(eventId, files);
    notice = fallback === "storage-error" ? "Dateispeicher derzeit nicht erreichbar. Bereits offline gespeicherte Dateien sind weiterhin verfügbar."
      : fallback ? "Offline. Bereits gespeicherte Dateien sind weiterhin verfügbar." : "";
    if (activeTopicId === eventId) {
      updateFileProviderNotice(bothUnavailable);
      renderMaterials(files, fallback ? "Keine offline gespeicherten Dateien für diesen Termin verfügbar." : "Keine Dateien vorhanden.");
      materialsMessage(notice);
    }
  } catch {
    if (sequence !== materialsLoadSequence) return;
    notice = navigator.onLine === false ? "Offline. Bereits gespeicherte Dateien sind weiterhin verfügbar."
      : "Dateispeicher derzeit nicht erreichbar. Bereits offline gespeicherte Dateien sind weiterhin verfügbar.";
    if (activeTopicId === eventId) {
      renderMaterials(known, "Dateiliste konnte nicht geladen werden.");
      materialsMessage(notice);
    }
  }
  if (activeTopicId === eventId) await showOfflineAvailability(eventId, materialsByEvent.get(eventId) || [], notice, sequence);
}
window.addEventListener("offline-files-changed", () => {
  if (activeTopicId) loadMaterials(activeTopicId);
});

function openEventMaterials(card, dialog) {
  activeTopicId = card.dataset.eventId;
  if (!activeTopicId) return;
  dialog.append(eventMaterials);
  uploadForm.reset();
  uploadForm.hidden = true;
  uploadToggle.setAttribute("aria-expanded", "false");
  uploadStatus.textContent = "";
  uploadStatus.classList.remove("error");
  loadMaterials(activeTopicId);
}

function openEvent(card) {
  const item = portalCalendar.events.find(
    (entry) => entry.id === card.dataset.eventId,
  );
  if (!item) return;
  document.getElementById("dialog-kind").textContent = CalendarModel.label(item);
  document.getElementById("dialog-title").textContent = item.title;
  openEventExtras(card, materialDialog);
  openEventMaterials(card, materialDialog);
  materialDialog.showModal();
}

uploadToggle.addEventListener("click", () => {
  uploadForm.hidden = !uploadForm.hidden;
  uploadToggle.setAttribute("aria-expanded", String(!uploadForm.hidden));
  if (!uploadForm.hidden) document.getElementById("upload-file").focus();
});

let pendingMaterialFiles = [];
uploadForm.addEventListener("reset", () => {
  pendingMaterialFiles = [];
});

document.getElementById("upload-file").addEventListener("change", (event) => {
  for (const file of Array.from(event.target.files || [])) {
    if (!pendingMaterialFiles.some((existing) =>
      existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified,
    )) pendingMaterialFiles.push(file);
  }
  const selection = new DataTransfer();
  pendingMaterialFiles.forEach((file) => selection.items.add(file));
  event.target.files = selection.files;
  const files = pendingMaterialFiles;
  uploadStatus.textContent = files.length
    ? `${files.length === 1 ? files[0].name : `${files.length} Dateien`} · ${formatFileSize(files.reduce((total, file) => total + file.size, 0))} ausgewählt`
    : "";
  uploadStatus.classList.remove("error");
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeTopicId) return;
  const uploadTopicId = activeTopicId;
  const submit = document.getElementById("upload-submit");
  const selectedFiles = Array.from(uploadForm.elements.file.files || []);
  if (!selectedFiles.length || submit.disabled) return;
  const password = uploadForm.elements.password.value;
  const deletePassword = uploadForm.elements.deletePassword.value;
  const failedFiles = [];
  const failures = [];
  let completed = 0;
  submit.disabled = true;
  uploadForm.elements.file.disabled = true;
  uploadStatus.classList.remove("error");
  try {
    for (const [index, file] of selectedFiles.entries()) {
      const progress = (percent) => {
        uploadStatus.textContent = `Datei ${index + 1} von ${selectedFiles.length} wird hochgeladen … ${percent} % (${file.name})`;
      };
      progress(0);
      try {
        const result = await sendMaterialUpload(file, uploadTopicId, password, deletePassword, progress);
        const files = [result.file, ...(materialsByEvent.get(uploadTopicId) || [])].filter(
          (file, index, all) => all.findIndex((candidate) => candidate.id === file.id) === index,
        );
        materialsByEvent.set(uploadTopicId, files);
        ++materialsLoadSequence;
        completed++;
        if (activeTopicId === uploadTopicId) {
          renderMaterials(files);
          materialsMessage("");
          showOfflineAvailability(uploadTopicId, files);
        }
      } catch (error) {
        failedFiles.push(file);
        failures.push(`${file.name}: ${error.message || "Upload fehlgeschlagen."}`);
      }
    }
    if (failedFiles.length) {
      pendingMaterialFiles = failedFiles;
      const remaining = new DataTransfer();
      failedFiles.forEach((file) => remaining.items.add(file));
      uploadForm.elements.file.files = remaining.files;
      uploadStatus.textContent = `${completed} von ${selectedFiles.length} Dateien hochgeladen. ${failures.join(" ")} Erneut hochladen, um die fehlgeschlagenen Dateien zu wiederholen.`;
      uploadStatus.classList.add("error");
    } else {
      uploadForm.reset();
      uploadForm.hidden = true;
      uploadToggle.setAttribute("aria-expanded", "false");
      uploadStatus.textContent = selectedFiles.length === 1 ? "Datei wurde hinzugefügt." : `${completed} Dateien wurden hinzugefügt.`;
    }
  } finally {
    if (completed) window.OfflineFiles?.reloadManifest?.();
    submit.disabled = false;
    uploadForm.elements.file.disabled = false;
  }
});

resourceList.addEventListener("click", async (event) => {
  const link = event.target.closest("a[download]");
  if (!link) return;
  event.preventDefault();
  const url = new URL(link.href, location.href);
  url.search = "";
  const fileId = url.pathname.split("/").pop();
  const file = (materialsByEvent.get(activeTopicId) || []).find((entry) => entry.id === fileId);
  try {
    // navigator.onLine can stay true on a network without Internet access.
    // Use a Blob download for saved files regardless of that connection hint.
    let response;
    try {
      const cache = await caches.open("profilreise-offline-files-v1");
      response = await cache.match(url.toString());
    } catch {
      // Downloads still work online when browser storage is unavailable.
    }
    if (!response && navigator.onLine) {
      response = await fetch(link.href);
      if (!response.ok || response.redirected) throw new Error("Die Datei konnte nicht heruntergeladen werden.");
    }
    if (!response) throw new Error("Diese Datei ist auf diesem Gerät noch nicht offline gespeichert.");
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const download = document.createElement("a");
    download.href = blobUrl;
    download.download = file?.name || "datei";
    document.body.append(download);
    download.click();
    download.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch (error) {
    window.alert(error.message || "Die gespeicherte Datei konnte nicht heruntergeladen werden.");
  }
});

resourceList.addEventListener("click", async (event) => {
  const button = event.target.closest(".delete-material");
  if (!button || !activeTopicId) return;
  const file = (materialsByEvent.get(activeTopicId) || []).find(
    (candidate) => candidate.id === button.dataset.fileId,
  );
  pendingDelete = { project: activeTopicId, id: button.dataset.fileId, button };
  document.getElementById("delete-filename").textContent =
    file?.name || "Ausgewählte Datei";
  deleteForm.reset();
  deleteStatus.textContent = "";
  deleteStatus.classList.remove("error");
  deleteDialog.showModal();
  document.getElementById("delete-password").focus();
});

deleteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!pendingDelete) return;
  const { project, id, button } = pendingDelete;
  const submit = deleteForm.querySelector(".delete-confirm");
  submit.disabled = true;
  deleteStatus.textContent = "Datei wird gelöscht …";
  deleteStatus.classList.remove("error");
  try {
    const response = await fetch("/api/materials", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project,
        id,
        password: deleteForm.elements.password.value,
      }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Löschen fehlgeschlagen.");
    deletedFileIds.add(`${project}/${id}`);
    const files = (materialsByEvent.get(project) || []).filter(
      (file) => file.id !== id,
    );
    materialsByEvent.set(project, files);
    ++materialsLoadSequence;
    window.OfflineFiles?.reloadManifest?.();
    if (activeTopicId === project) {
      renderMaterials(files);
      materialsMessage("");
      showOfflineAvailability(project, files);
    }
    uploadStatus.textContent = "Datei wurde gelöscht.";
    pendingDelete = null;
    deleteDialog.close();
  } catch (error) {
    deleteStatus.textContent = error.message || "Löschen fehlgeschlagen.";
    deleteStatus.classList.add("error");
    button.disabled = false;
  } finally {
    submit.disabled = false;
    uploadForm.elements.file.disabled = false;
  }
});

document.querySelector(".delete-cancel").addEventListener("click", () => {
  pendingDelete = null;
  deleteDialog.close();
});

document
  .querySelector(".dialog-close")
  .addEventListener("click", () => materialDialog.close());
materialDialog.addEventListener("click", (event) => {
  closeOnBackdropClick(materialDialog, event);
});

loadCalendar();

// A subscription token is fetched only on request and never stored in offline caches.
document.getElementById("subscribe-calendar").onclick = async () => {
  const status = document.getElementById("subscription-status");
  try {
    const response = await fetch("/api/calendar-subscription", {
      cache: "no-store",
    });
    if (
      !response.ok ||
      !response.headers.get("content-type")?.includes("application/json")
    )
      throw Error(
        "Das Kalenderabo konnte nicht geladen werden. Bitte prüfe deine Internetverbindung und melde dich gegebenenfalls erneut an.",
      );
    const data = await response.json();
    const input = document.getElementById("subscription-url");
    input.value = new URL(data.path, location.origin).href;
    input.hidden = false;
    input.select();
    status.textContent =
      "Diese private URL in der Kalender-App als Kalenderabo hinzufügen. Sie gewährt Zugriff auf den Reiseplan und sollte nur mit Teilnehmenden geteilt werden.";
  } catch (error) {
    status.textContent = error.message;
  }
};
document.getElementById("portal-logout").onclick = async (event) => {
  event.preventDefault();
  if (navigator.serviceWorker?.controller) {
    await new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = resolve;
      navigator.serviceWorker.controller.postMessage({ type: "CLEAR_PORTAL" }, [
        channel.port2,
      ]);
      setTimeout(resolve, 3000);
    });
  }
  if ("caches" in window)
    for (const key of await caches.keys())
      if (key.startsWith("profilreise-offline-")) await caches.delete(key);
  // Without a registration the logout navigation goes straight to the network.
  try {
    for (const registration of (await navigator.serviceWorker?.getRegistrations()) || [])
      await registration.unregister();
  } catch {}
  location.replace("/__logout");
};
if ("serviceWorker" in navigator)
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "OFFLINE_READY")
      document.getElementById("offline-status").textContent =
        "Offline verfügbar · lokal gespeichert " +
        new Date().toLocaleString("de-DE");
  });


function setupDayPlanPrint(source, cached) {
  const select = document.getElementById("print-day");
  const button = document.getElementById("print-day-plan");
  select.replaceChildren(new Option("Alle Reisetage", "all"));
  portalCalendar.days.forEach((day, i) => select.add(new Option(CalendarModel.dayLabel(day), String(i + 1))));
  const today = portalCalendar.days.findIndex(day => day.isoDate === CalendarModel.localDate());
  select.value = today < 0 ? "all" : String(today + 1);
  select.disabled = button.disabled = !portalCalendar.days.length;
  const part = (tag, text, className) => {
    const element = createTextElement(tag, text);
    if (className) element.className = className;
    return element;
  };
  const longDate = isoDate => new Intl.DateTimeFormat("de-DE", {weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC"}).format(new Date(`${isoDate}T12:00:00Z`));
  button.onclick = async () => {
    button.disabled = true;
    const status = document.getElementById("print-plan-status");
    status.textContent = "Tagesplan wird vorbereitet …";
    try {
      const events = portalCalendar.events.filter(item => select.value === "all" || item.day === Number(select.value));
      await Promise.all(events.map(loadVisibleEventNote));
      document.getElementById("print-day-plan-content")?.remove();
      const content = part("section", "");
      content.id = "print-day-plan-content";
      const header = part("header", "", "print-plan-header");
      header.append(part("span", "Tagesplan", "print-plan-kicker"), part("h1", tripConfig.title));
      const meta = part("p", "", "print-plan-meta");
      const published = source.publishedAt;
      if (cached) meta.append(part("span", "Offline-Kopie", "print-plan-flag"));
      meta.append(part("span", "Erstellt " + new Date().toLocaleString("de-DE")), part("span", published ? "Veröffentlicht " + new Date(published).toLocaleString("de-DE") : "Veröffentlichungsstand unbekannt"));
      header.append(meta);
      content.append(header);
      portalCalendar.days.forEach((day, index) => {
        if (select.value !== "all" && Number(select.value) !== index + 1) return;
        const section = part("section", "", "print-plan-day");
        const dayHeading = part("div", "", "print-plan-day-heading");
        dayHeading.append(part("span", "Tag " + (index + 1), "print-plan-day-number"), part("h2", longDate(day.isoDate)));
        section.append(dayHeading);
        const items = events.filter(item => item.day === index + 1).sort((a, b) => (a.timing === "unscheduled") - (b.timing === "unscheduled") || String(a.startTime).localeCompare(String(b.startTime)));
        if (!items.length) section.append(part("p", "Keine Termine geplant.", "print-plan-empty"));
        for (const item of items) {
          const entry = part("article", "", "print-plan-event " + printEventClasses(item) + (item.status === "provisional" ? " is-provisional" : ""));
          const time = part("div", "", "print-plan-time");
          if (item.timing === "unscheduled") time.append(part("span", "Zeit offen"));
          else time.append(part("strong", item.startTime), part("span", "bis " + item.endTime));
          const body = part("div", "", "print-plan-body");
          body.append(part("h3", item.title));
          const statusText = CalendarModel.statusLabel(item);
          if (statusText) body.append(part("p", statusText, "print-plan-status"));
          for (const text of [item.subtitle, item.detail]) if (text) body.append(part("p", text, "print-plan-text"));
          if (item.location) {
            const location = part("p", "", "print-plan-location");
            location.append(part("span", "Ort / Treffpunkt", "print-plan-label"), part("span", item.location));
            body.append(location);
          }
          if (item.note) {
            const note = part("div", "", "print-plan-note");
            note.append(part("span", "Hinweise", "print-plan-label"), part("p", item.note));
            body.append(note);
          }
          const legs = journeys[item.journeyId]?.legs || [];
          if (legs.length) {
            const table = part("table", "", "print-plan-journey");
            const head = part("tr", "");
            for (const label of ["Zug", "Ab", "Von · Gleis", "An", "Nach"]) head.append(part("th", label));
            table.append(head);
            for (const leg of legs) {
              const row = part("tr", "");
              row.append(part("td", leg.service || "–"), part("td", (leg.departure || "–") + (leg.departureDate ? " · " + leg.departureDate : "")), part("td", [leg.origin, leg.platform].filter(Boolean).join(" · ") || "–"), part("td", (leg.arrival || "–") + (leg.arrivalDate ? " · " + leg.arrivalDate : "")), part("td", leg.destination || "–"));
              table.append(row);
              if (leg.connection) {
                const transfer = part("tr", "", "print-plan-transfer");
                const cell = part("td", leg.connection);
                cell.colSpan = 5;
                transfer.append(cell);
                table.append(transfer);
              }
            }
            body.append(table);
          }
          entry.append(time, body);
          section.append(entry);
        }
        content.append(section);
      });
      content.append(part("footer", "Reserveplan zum Weitergeben. Änderungen und aktuelle Gleise bitte im Portal prüfen. Alle Zeiten sind Ortszeiten der Reise.", "print-plan-footer"));
      document.body.append(content);
      status.textContent = "Im Druckdialog drucken oder als PDF sichern. Hinweise werden so übernommen, wie sie im Portal vorliegen.";
      window.print();
    } catch {
      status.textContent = "Der Tagesplan konnte nicht vorbereitet werden. Bitte erneut versuchen.";
    } finally {
      button.disabled = false;
    }
  };
  setupCalendarPrint(source, cached, part);
}

function setupCalendarPrint(source, cached, part) {
  const button = document.getElementById("print-calendar-plan");
  if (!button) return;
  button.disabled = !portalCalendar.days.length;
  button.onclick = () => {
    const status = document.getElementById("print-plan-status");
    try {
      document.getElementById("print-day-plan-content")?.remove();
      const scheduled = portalCalendar.events.filter(item => item.timing !== "unscheduled" && CalendarModel.minutes(item.startTime) !== null);
      const startOf = item => CalendarModel.minutes(item.startTime);
      const endOf = item => Math.max(startOf(item) + 15, CalendarModel.minutes(item.endTime) ?? 0);
      const first = Math.min(8 * 60, ...scheduled.map(startOf));
      const last = Math.max(20 * 60, ...scheduled.map(endOf));
      const from = Math.floor(first / 60) * 60, to = Math.min(24 * 60, Math.ceil(last / 60) * 60), span = to - from;
      const content = part("section", "", "print-calendar");
      content.id = "print-day-plan-content";
      const published = source.publishedAt;
      const range = portalCalendar.days.length ? `${CalendarModel.dayLabel(portalCalendar.days[0])} – ${CalendarModel.dayLabel(portalCalendar.days.at(-1))}` : "";
      for (let offset = 0; offset < portalCalendar.days.length; offset += 7) {
        const page = part("div", "", "print-calendar-page");
        const header = part("header", "", "print-calendar-header");
        const titles = part("div", "");
        titles.append(part("span", "Gesamtplan · Kalenderansicht", "print-plan-kicker"), part("h1", tripConfig.title));
        const meta = part("p", "", "print-plan-meta");
        if (cached) meta.append(part("span", "Offline-Kopie", "print-plan-flag"));
        meta.append(part("span", range), part("span", "Erstellt " + new Date().toLocaleString("de-DE")), part("span", published ? "Veröffentlicht " + new Date(published).toLocaleString("de-DE") : "Veröffentlichungsstand unbekannt"));
        header.append(titles, meta);
        page.append(header);
        const days = portalCalendar.days.slice(offset, offset + 7);
        const grid = part("div", "", "print-calendar-grid");
        grid.style.setProperty("--days", String(days.length));
        grid.append(part("div", "", "print-calendar-corner"));
        days.forEach((day, i) => {
          const head = part("div", "", "print-calendar-dayhead");
          head.append(part("span", "Tag " + (offset + i + 1)), part("strong", CalendarModel.dayLabel(day)));
          grid.append(head);
        });
        grid.append(part("div", "Zeit offen", "print-calendar-axis-open"));
        days.forEach((day, i) => {
          const cell = part("div", "", "print-calendar-open");
          for (const item of portalCalendar.events.filter(e => e.day === offset + i + 1 && !scheduled.includes(e))) cell.append(part("span", item.title, "print-calendar-open-event " + printEventClasses(item)));
          grid.append(cell);
        });
        const axis = part("div", "", "print-calendar-axis");
        for (let minute = from; minute < to; minute += 60) {
          const label = part("span", String(minute / 60).padStart(2, "0") + ":00");
          label.style.top = ((minute - from) / span * 100) + "%";
          axis.append(label);
        }
        grid.append(axis);
        days.forEach((day, i) => {
          const column = part("div", "", "print-calendar-column");
          column.style.setProperty("--hours", String(span / 60));
          const items = scheduled.filter(e => e.day === offset + i + 1).sort((a, b) => startOf(a) - startOf(b) || endOf(b) - endOf(a));
          let cluster = [], clusterEnd = -1;
          const place = () => {
            const lanes = [];
            const placed = cluster.map(item => {
              let lane = lanes.findIndex(end => end <= startOf(item));
              if (lane < 0) lane = lanes.length;
              lanes[lane] = endOf(item);
              return [item, lane];
            });
            for (const [item, lane] of placed) {
              const block = part("div", "", "print-calendar-event " + printEventClasses(item) + (item.status === "provisional" ? " is-provisional" : ""));
              block.style.top = ((startOf(item) - from) / span * 100) + "%";
              block.style.height = ((Math.min(endOf(item), to) - startOf(item)) / span * 100) + "%";
              block.style.left = (lane / lanes.length * 100) + "%";
              block.style.width = (100 / lanes.length) + "%";
              block.append(part("strong", item.title), part("span", CalendarModel.label(item)));
              if (item.location) block.append(part("span", item.location, "print-calendar-location"));
              column.append(block);
            }
            cluster = [];
          };
          for (const item of items) {
            if (cluster.length && startOf(item) >= clusterEnd) place();
            cluster.push(item);
            clusterEnd = Math.max(clusterEnd, endOf(item));
          }
          if (cluster.length) place();
          grid.append(column);
        });
        page.append(grid);
        page.append(part("footer", "Reserveplan zum Weitergeben. Details, Hinweise und Bahnverbindungen stehen im Tagesplan. Alle Zeiten sind Ortszeiten der Reise.", "print-plan-footer"));
        content.append(page);
      }
      document.body.append(content);
      status.textContent = "Im Druckdialog drucken oder als PDF sichern. Querformat wird automatisch verwendet.";
      window.print();
    } catch {
      status.textContent = "Die Kalenderansicht konnte nicht vorbereitet werden. Bitte erneut versuchen.";
    }
  };
}

function printEventClasses(item) {
  const kind = item.type === "travel" ? "train" : item.type === "free" ? "free" : item.type === "event" ? "notice" : "program";
  return `${kind}-event${item.status === "provisional" ? " draft-event" : ""}`;
}
