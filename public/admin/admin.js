"use strict";
const $ = (s) => document.querySelector(s),
  form = $("#editor");
let calendar,
  revision,
  csrf,
  selected,
  draft,
  history = [],
  future = [],
  dirty = false,
  editing = false,
  draggedPoint = null,
  saving = false;
// Active, visible editors renew their session without replacing local changes.
let sessionExpired = false;
class AdminSessionExpired extends Error {}
async function adminFetch(url, options) {
  const response = await fetch(url, options);
  const problem = response.status === 403
    ? await response.clone().json().catch(() => ({})) : {};
  if (response.status === 401 || (response.status === 403 &&
      ["csrf_invalid", "session_expired"].includes(problem.code))) {
    if (!sessionExpired) {
      sessionExpired = true;
      $(".workspace").inert = true;
      location.reload();
    }
    throw new AdminSessionExpired();
  }
  return response;
}
let sessionCheckPending = false;
async function checkAdminSession() {
  if (document.visibilityState !== "visible" || sessionExpired || sessionCheckPending) return;
  sessionCheckPending = true;
  try {
    // Renew authentication only; never reload calendar data into the local draft.
    await adminFetch("/api/admin/session", { cache: "no-store", signal: AbortSignal.timeout(15000) });
  } catch {
    // Network outages are not evidence of logout. A later visible check retries.
  } finally { sessionCheckPending = false; }
}
function watchAdminSession() {
  window.setInterval(checkAdminSession, 60000);
  document.addEventListener("visibilitychange", checkAdminSession);
  checkAdminSession();
}
// State and time geometry. All limits come from the loaded calendar.
const minutes = CalendarModel.minutes,
  time = CalendarModel.time;
const start = (e) => minutes(e.startTime),
  end = (e) => minutes(e.endTime);
const bounds = () => CalendarModel.bounds(calendar);
const layoutEvents = (events) => CalendarModel.layout(events, calendar);
const dropStart = (item, minute, offset) =>
  CalendarModel.dropStart(item, minute, offset, calendar);
let trip,
  routeData = new Map(),
  publicationBlocked = false;
const message = (t) => {
  $("#status").textContent = t;
};
function editorError(text, field) {
  $("#editor-message").hidden = false;
  $("#editor-message").textContent = text;
  message(text);
  if (field) {
    let section = field.closest("details");
    while (section) {
      section.open = true;
      section = section.parentElement.closest("details");
    }
    field.focus();
  } else if (!form.hidden) $("#editor-message").focus();
}
function syncTimeFields() {
  const open = form.elements.timing.value === "unscheduled";
  $("#time-fields").hidden = open;
  $("#time-help").hidden = !open;
  $("#confirmation-label").hidden = open;
  if (open) form.elements.status.value = "provisional";
  form.elements.startTime.required = !open;
  form.elements.endTime.required = !open;
}
// Advance only on committed changes, so typing and opening existing drafts stay put.
function advanceEditorTo(selector) {
  const target = $(selector);
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: "start", behavior: "auto" });
}
function advanceAfterTimeChange(name) {
  if (!["day", "timing", "startTime", "endTime", "status"].includes(name)) return;
  if (!form.elements.day.value) return;
  if (form.elements.timing.value === "unscheduled") {
    advanceEditorTo("#editor-place-heading");
    return;
  }
  const { startTime, endTime } = form.elements;
  if (!startTime.value || !endTime.value || !startTime.validity.valid ||
      !endTime.validity.valid || minutes(endTime.value) <= minutes(startTime.value)) return;
  advanceEditorTo(name === "status" ? "#editor-place-heading" : '#confirmation-label select');
}
form.addEventListener("change", (event) => advanceAfterTimeChange(event.target.name));
let lastEditorState, restoringHistory = false;
let publishedCalendar;
function publicationSummary() {
  if (!publishedCalendar || !calendar) return "";
  const previous = new Map(publishedCalendar.events.map(item => [item.id, item]));
  let added = 0, changed = 0;
  for (const item of calendar.events) {
    if (!previous.has(item.id)) added++;
    else if (JSON.stringify(item) !== JSON.stringify(previous.get(item.id))) changed++;
    previous.delete(item.id);
  }
  const parts = [];
  if (added) parts.push(`${added} neu`);
  if (changed) parts.push(`${changed} geändert`);
  if (previous.size) parts.push(`${previous.size} gelöscht`);
  if (JSON.stringify(calendar.countdown) !== JSON.stringify(publishedCalendar.countdown)) parts.push("Countdown geändert");
  return parts.length ? "Gesamter Plan: " + parts.join(" · ") : "";
}
function historySnapshot() {
  const fields = {};
  for (const field of new Set(Object.values(form.elements))) {
    if (field.name && field.type !== "file") fields[field.name] = {value: field.value, checked: field.checked};
  }
  const countdownFields = {};
  for (const [name, field] of Object.entries($("#countdown-form").elements)) {
    if (!/^\d+$/.test(name) && field && "value" in field) countdownFields[name] = {value: field.value, checked: field.checked};
  }
  return structuredClone({calendar, dirty, selected, draft, editing, fields, countdownFields,
    journey: window.captureJourneyHistory?.()});
}
function trackEditorStep() {
  if (!calendar || restoringHistory) return;
  const next = historySnapshot();
  const editor = state => JSON.stringify([state.selected, state.draft, state.fields, state.journey]);
  if (lastEditorState && ((editing && editor(next) !== editor(lastEditorState)) ||
      JSON.stringify(next.countdownFields) !== JSON.stringify(lastEditorState.countdownFields))) {
    history.push(lastEditorState);
    future = [];
  }
  lastEditorState = next;
}
function updateSaveState() {
  trackEditorStep();
  $("#publish-summary").textContent = publicationSummary();
  $("#undo").disabled = saving || sessionExpired || !history.length;
  $("#redo").disabled = saving || sessionExpired || !future.length;
  $("#save-state").textContent = saving ? "Wird veröffentlicht …" : editing
    ? "Termin noch nicht im Entwurf gespeichert"
    : dirty ? "Entwurf noch nicht veröffentlicht"
    : "Keine unveröffentlichten Änderungen";
  $("#save").disabled = saving || sessionExpired || !(editing || dirty) || publicationBlocked;
  $("#save-event").disabled = saving || sessionExpired || !editing;
  $("#save-event").textContent = saving ? "Wird gespeichert …" : "Speichern";
  $("#cancel-event").textContent = editing ? "Abbrechen" : "Zurück zu den Terminen";
  $("#editor-empty").hidden = Boolean(draft);
}
function controls() {
  updateSaveState();
  $("#delete-event").hidden = !calendar?.events.some(
    (item) => item.id === selected,
  );
  $("#new-event").disabled = sessionExpired || !calendar || calendar.events.length >= 200;
  $("#new-journey").disabled = $("#new-event").disabled;
  $("#new-journey-from-link").disabled = $("#new-event").disabled;
  $("#save").disabled = saving || sessionExpired || !(dirty || editing) || publicationBlocked;
  $("#undo").disabled = saving || sessionExpired || !history.length;
}
function checkpoint() {
  history.push(historySnapshot());
  future = [];
  dirty = true;
  controls();
}
let dragOffset = 0;
let agendaDay = 1;
const mobileLayout = () => window.matchMedia("(max-width: 700px)").matches;
function returnToAgenda() {
  const entry = [...$("#agenda").querySelectorAll("button")].find(
    (button) => button.dataset.eventId === selected,
  );
  (entry || $("#agenda-day")).focus();
  (entry || $(".mobile-schedule")).scrollIntoView({ block: "start" });
}
$("#back-to-agenda").onclick = returnToAgenda;
function setView(view) {
  document.body.dataset.view = view;
  $("#view-list").setAttribute("aria-pressed", String(view === "list"));
  $("#view-week").setAttribute("aria-pressed", String(view === "week"));
}
$("#view-list").onclick = () => setView("list");
$("#view-week").onclick = () => setView("week");
$("#event-search").oninput = renderAgenda;
$("#clear-search").onclick = () => {
  $("#event-search").value = "";
  renderAgenda();
  $("#event-search").focus();
};
function refreshDayOptions() {
  const selectedDay = Number(form.elements.day.value) || draft?.day || 1;
  form.elements.day.replaceChildren();
  $("#agenda-day").replaceChildren();
  for (const [i, day] of calendar.days.entries()) {
    const option = document.createElement("option");
    option.value = i + 1;
    option.textContent = CalendarModel.dayLabel(day);
    form.elements.day.append(option);
    $("#agenda-day").append(option.cloneNode(true));
  }
  agendaDay = Math.min(agendaDay, calendar.days.length);
  form.elements.day.value = Math.min(selectedDay, calendar.days.length);
  $("#agenda-day").value = agendaDay;
}
function changeDay(day) {
  if (!calendar || day < 1 || day > calendar.days.length) return;
  agendaDay = day;
  $("#agenda-day").value = day;
  renderAgenda();
}
$("#previous-day").onclick = () => changeDay(agendaDay - 1);
$("#next-day").onclick = () => changeDay(agendaDay + 1);
$("#agenda-day").onchange = (e) => {
  agendaDay = Number(e.target.value);
  renderAgenda();
};
// Rendering uses exactly the same components as the participant portal.
function renderAgenda() {
  if (!calendar) return;
  $("#previous-day").disabled = agendaDay <= 1;
  $("#next-day").disabled = agendaDay >= calendar.days.length;
  const query = $("#event-search").value.trim().toLocaleLowerCase("de");
  const events = calendar.events.filter(item =>
    [item.title, item.subtitle, item.detail, item.location, item.responsible, item.note]
      .some(value => String(value || "").toLocaleLowerCase("de").includes(query)));
  $("#clear-search").hidden = !query;
  const count = events.filter(item => item.day === agendaDay).length;
  $("#agenda-count").textContent = query
    ? `${count} Treffer an diesem Tag` : `${count} Termine · Zum Bearbeiten auswählen`;
  CalendarView.agenda($("#agenda"), { ...calendar, events }, agendaDay, {
    selected,
    onSelect: (item) => select(item.id),
  });
  if (query && !count) $("#agenda").textContent = "Kein passender Termin. Versuche einen anderen Suchbegriff oder lösche die Suche.";
}
function render() {
  // During undo/redo the view is rendered once after the whole state is restored.
  if (restoringHistory) return;
  renderCountdownSettings();
  renderAgenda();
  CalendarView.week($("#calendar"), calendar, {
    selected,
    onSelect: (item) => select(item.id),
    decorate(button, item) {
      button.draggable = true;
      button.addEventListener("dragstart", (e) => {
        dragOffset = e.clientY - button.getBoundingClientRect().top;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-event", item.id);
      });
      button.addEventListener("dragend", () =>
        document
          .querySelectorAll(".drop-indicator")
          .forEach((el) => (el.hidden = true)),
      );
    },
    column(column, day) {
      const indicator = document.createElement("div");
      indicator.className = "drop-indicator";
      indicator.hidden = true;
      column.append(indicator);
      const targetMinute = (e) =>
        bounds().start + e.clientY - column.getBoundingClientRect().top;
      column.addEventListener("dragover", (e) => {
        if (!e.dataTransfer.types.includes("application/x-event")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        indicator.hidden = false;
        indicator.style.top = `${Math.max(0, Math.min(bounds().duration, targetMinute(e) - bounds().start - dragOffset))}px`;
      });
      column.addEventListener("dragleave", (e) => {
        if (!column.contains(e.relatedTarget)) indicator.hidden = true;
      });
      column.addEventListener("drop", (e) => {
        e.preventDefault();
        indicator.hidden = true;
        const item = calendar.events.find(
          (x) => x.id === e.dataTransfer.getData("application/x-event"),
        );
        if (!item) return;
        if (editing && !confirm("Deine Eingaben sind noch nicht gespeichert. Möchtest du sie verwerfen?"))
          return;
        const m = dropStart(item, targetMinute(e), dragOffset),
          duration = end(item) - start(item);
        if (day === item.day && m === start(item)) return;
        checkpoint();
        Object.assign(item, {
          day,
          startTime: time(m),
          endTime: time(m + duration),
        });
        select(item.id, true);
        message("Termin verschoben. Klicke oben auf „Änderungen veröffentlichen“, damit alle die neue Zeit sehen.");
      });
    },
  });
}
// Editor only changes a draft. Undo and publish operate on the entire canonical plan.
function closeEditor() {
  selected = undefined;
  draft = undefined;
  editing = false;
  form.hidden = true;
  $("#editor-title").textContent = "Termin auswählen";
  $("#search-results").replaceChildren();
  updateSaveState();
  render();
}
function showDraft() {
  $("#delete-event").hidden = !calendar.events.some(
    (item) => item.id === selected,
  );
  form.hidden = false;
  $("#editor-message").hidden = true;
  $("#editor-title").textContent = draft.title || "Neuer Termin";
  $("#search-results").replaceChildren();
  for (const name of [
    "title",
    "day",
    "lane",
    "location",
    "latitude",
    "longitude",
    "note",
    "responsible",
    "type",
    "status",
    "display",
    "timing",
  ])
    form.elements[name].value = draft[name] ?? "";
  form.elements.note.value = [draft.subtitle, draft.detail, draft.note]
    .filter((text) => typeof text === "string" && text.trim())
    .join("\n\n");
  form.elements.showMap.checked = draft.showMap !== false;
  form.elements.time.value = CalendarModel.label(draft);
  if (draft.routeRef && !draft.mapRoute)
    draft.mapRoute = structuredClone(
      routeData.get(draft.routeRef) || { points: [] },
    );
  form.elements.startTime.value = time(start(draft));
  form.elements.endTime.value = time(end(draft));
  draft.mapRoute ??= { points: [] };
  $("#geometry").value = (draft.mapRoute.geometry || [])
    .map((p) => p.join(", "))
    .join("\n");
  points();
  window.showJourneyDraft?.();
  mapLink();
  syncTimeFields();
  updateSaveState();
  render();
}
function select(id, force = false) {
  if (editing && !force && !confirm("Deine Eingaben sind noch nicht gespeichert. Möchtest du sie verwerfen?"))
    return;
  const item = calendar.events.find((e) => e.id === id);
  if (!item) {
    closeEditor();
    return;
  }
  selected = id;
  draft = structuredClone(item);
  editing = false;
  showDraft();
  if (mobileLayout() && !force) {
    $("#editor-title").focus({ preventScroll: true });
    $("#editor-panel").scrollIntoView({ block: "start" });
  }
}
$("#new-event").onclick = () => {
  if (!calendar || calendar.events.length >= 200) return;
  if (editing && !confirm("Deine Eingaben sind noch nicht gespeichert. Möchtest du sie verwerfen?")) return;
  selected = `termin-${crypto.randomUUID()}`;
  draft = {
    id: selected,
    day: agendaDay,
    startTime: time(bounds().start),
    endTime: time(Math.min(bounds().start + 60, bounds().end)),
    title: "",
    subtitle: "",
    detail: "",
    location: "",
    lane: "",
    type: "program",
    status: "provisional",
    display: "normal",
    timing: "scheduled",
    mapRoute: { points: [] },
  };
  editing = true;
  showDraft();
  $("#editor-panel").scrollIntoView({ block: "start" });
  form.elements.title.focus({ preventScroll: true });
  message(
    "Fülle den neuen Termin aus und klicke anschließend auf „Speichern“.",
  );
};
$("#cancel-event").onclick = () => {
  if (editing && !confirm("Deine Eingaben sind noch nicht gespeichert. Möchtest du sie verwerfen?")) return;
  closeEditor();
  if (mobileLayout()) returnToAgenda();
  else $("#new-event").focus();
};
$("#delete-event").onclick = () => {
  const index =
    calendar?.events.findIndex((item) => item.id === selected) ?? -1;
  if (index < 0) return;
  const item = calendar.events[index];
  const warning = editing
    ? " Deine ungespeicherten Eingaben gehen dabei verloren."
    : "";
  if (
    !confirm(
      `„${item.title}“ aus dem Plan löschen?${warning} Klicke danach auf „Änderungen veröffentlichen“, damit der Termin auch für alle anderen entfernt wird.`,
    )
  )
    return;
  checkpoint();
  calendar.events.splice(index, 1);
  agendaDay = item.day;
  $("#agenda-day").value = agendaDay;
  closeEditor();
  controls();
  if (mobileLayout()) returnToAgenda();
  else $("#undo").focus();
  message(
    "Termin zum Löschen vorgemerkt. Jetzt „Änderungen veröffentlichen“ oder „Letzte Änderung zurücknehmen“ wählen.",
  );
};
function mapLink() {
  if (restoringHistory) return;
  window.updateAdminPlacePreview?.();
  $("#maps-link").hidden = !form.elements.latitude.value || !form.elements.longitude.value;
  $("#maps-link").href =
    `https://maps.apple.com/?q=${encodeURIComponent(form.elements.location.value)}&ll=${encodeURIComponent(form.elements.latitude.value + "," + form.elements.longitude.value)}`;
}
function points() {
  const list = $("#points");
  list.replaceChildren();
  draft.mapRoute.points.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "point";
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      draggedPoint = i;
      e.dataTransfer.setData("application/x-point", String(i));
    });
    row.addEventListener("dragover", (e) => {
      if (e.dataTransfer.types.includes("application/x-point"))
        e.preventDefault();
    });
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      if (draggedPoint === null) return;
      draft.mapRoute.points.splice(
        i,
        0,
        draft.mapRoute.points.splice(draggedPoint, 1)[0],
      );
      draggedPoint = null;
      editing = true;
      updateSaveState();
      points();
    });
    for (const [key, label] of [
      ["name", "Haltepunkt"],
      ["latitude", "Breitengrad"],
      ["longitude", "Längengrad"],
    ]) {
      const l = document.createElement("label");
      l.textContent = label;
      const input = document.createElement("input");
      input.value = p[key];
      input.required = true;
      if (key !== "name") {
        input.type = "number";
        input.step = "any";
        input.min = key === "latitude" ? -90 : -180;
        input.max = key === "latitude" ? 90 : 180;
      }
      input.addEventListener("input", () => {
        p[key] = key === "name" ? input.value : Number(input.value);
        editing = true;
        updateSaveState();
      });
      l.append(input);
      row.append(l);
    }
    const actions = document.createElement("div");
    actions.className = "point-tools";
    for (const [text, offset] of [
      ["Nach oben", -1],
      ["Nach unten", 1],
      ["Entfernen", 0],
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = text;
      b.setAttribute("aria-label", `${text} · ${p.name}`);
      b.disabled =
        offset !== 0 &&
        (i + offset < 0 || i + offset >= draft.mapRoute.points.length);
      b.onclick = () => {
        if (offset === 0) draft.mapRoute.points.splice(i, 1);
        else
          [draft.mapRoute.points[i], draft.mapRoute.points[i + offset]] = [
            draft.mapRoute.points[i + offset],
            draft.mapRoute.points[i],
          ];
        editing = true;
        updateSaveState();
        points();
      };
      actions.append(b);
    }
    const search = document.createElement("button");
    search.type = "button";
    search.textContent = "Ort suchen";
    search.onclick = async () => {
      const id = selected;
      search.disabled = true;
      try {
        const places = await searchPlaces(p.name);
        if (id !== selected) return;
        const results = document.createElement("div");
        for (const place of places.slice(0, 5)) {
          const choose = document.createElement("button");
          choose.type = "button";
          choose.textContent = place.formattedAddress || place.name;
          choose.onclick = () => {
            Object.assign(p, {
              name: place.name,
              latitude: place.coordinate.latitude,
              longitude: place.coordinate.longitude,
            });
            editing = true;
            updateSaveState();
            points();
          };
          results.append(choose);
        }
        if (!places.length) results.textContent = "Keine Orte gefunden.";
        row.append(results);
      } catch (error) {
        message(error.message);
      } finally {
        search.disabled = false;
      }
    };
    actions.append(search);
    row.append(actions);
    list.append(row);
  });
}
// Native validation must be able to focus fields inside collapsed sections.
form.addEventListener("invalid", (event) => {
  $("#editor-message").hidden = false;
  $("#editor-message").textContent = "Bitte ergänze oder korrigiere das markierte Feld.";
  let section = event.target.closest("details");
  while (section) {
    section.open = true;
    section = section.parentElement.closest("details");
  }
}, true);
form.addEventListener("input", (event) => {
  editing = true;
  $("#editor-message").hidden = true;
  syncTimeFields();
  if (event.target.name === "location") {
    form.elements.latitude.value = "";
    form.elements.longitude.value = "";
    $("#search-results").textContent = "Ort geändert. Bitte wähle den passenden Ort erneut über die Suche.";
  }
  updateSaveState();
  if (["startTime", "endTime", "timing"].includes(event.target.name))
    form.elements.time.value = CalendarModel.label({
      startTime: form.elements.startTime.value,
      endTime: form.elements.endTime.value,
      timing: form.elements.timing.value,
    });
  mapLink();
});
$("#add-point").onclick = () => {
  draft.mapRoute.points.push({
    name: "Neuer Haltepunkt",
    latitude: Number(form.elements.latitude.value),
    longitude: Number(form.elements.longitude.value),
  });
  editing = true;
  updateSaveState();
  points();
};
function applyDraft() {
  if (!draft) return false;
  for (const name of ["title", "location"]) form.elements[name].value = form.elements[name].value.trim();
  const hasCoordinates = Boolean(form.elements.latitude.value && form.elements.longitude.value);
  if (!form.elements.location.value) form.elements.showMap.checked = false;
  if (form.elements.showMap.checked && !hasCoordinates) {
    editorError("Bitte wähle einen Ort aus der Suche aus oder schalte „Karte im Reiseplan anzeigen“ aus. Ein Ort ist optional.", $("#search-place"));
    return false;
  }
  if (!form.reportValidity()) return false;
  const a = minutes(form.elements.startTime.value),
    b = minutes(form.elements.endTime.value);
  if (
    a === null ||
    b === null ||
    (!draft.journeyDate && (a < bounds().start || b > bounds().end)) ||
    b <= a
  ) {
    editorError(
      `Die Endzeit muss nach dem Beginn liegen. Wähle Zeiten zwischen ${time(bounds().start)} und ${time(bounds().end)} Uhr.`,
      form.elements.endTime,
    );
    return;
  }
  if (!window.applyJourneyDraft()) return false;
  let geometry;
  try {
    geometry = $("#geometry").value.trim()
      ? $("#geometry")
          .value.trim()
          .split("\n")
          .map((line) => {
            const p = line.split(",").map((v) => Number(v.trim()));
            if (
              p.length !== 2 ||
              !p.every(Number.isFinite) ||
              Math.abs(p[0]) > 90 ||
              Math.abs(p[1]) > 180
            )
              throw Error();
            return p;
          })
      : undefined;
  } catch {
    editorError(
      "Der genaue Routenverlauf enthält einen Fehler. Trage je Zeile Breitengrad und Längengrad ein, getrennt durch ein Komma.",
      $("#geometry"),
    );
    return;
  }
  for (const name of [
    "title",
    "lane",
    "location",
    "note",
    "responsible",
    "type",
    "status",
    "display",
    "timing",
  ])
    draft[name] = form.elements[name].value;
  delete draft.subtitle;
  delete draft.detail;
  draft.day = Number(form.elements.day.value);
  // Events without a place keep neither coordinates nor a map.
  for (const name of ["latitude", "longitude"])
    if (hasCoordinates) draft[name] = Number(form.elements[name].value);
    else delete draft[name];
  if (!draft.location) delete draft.location;
  Object.assign(draft, {
    startTime: time(a),
    endTime: time(b),
    showMap: form.elements.showMap.checked,
  });
  if (draft.timing === "unscheduled") draft.status = "provisional";
  if (geometry) draft.mapRoute.geometry = geometry;
  else delete draft.mapRoute.geometry;
  // Keep unchanged route files referenced; edited routes are extracted atomically at publish.
  const stored = structuredClone(draft);
  const journeyParts = stored.journeyParts;
  delete stored.journeyParts;
  if (
    stored.routeRef &&
    JSON.stringify(stored.mapRoute) ===
      JSON.stringify(routeData.get(stored.routeRef))
  )
    delete stored.mapRoute;
  else delete stored.routeRef;
  const index = calendar.events.findIndex((x) => x.id === selected);
  checkpoint();
  if (index < 0) calendar.events.push(stored);
  else calendar.events[index] = stored;
  if (journeyParts) {
    for (const part of journeyParts.slice(1)) {
      const id=crypto.randomUUID();
      const continuation=structuredClone(stored);
      Object.assign(continuation,{id,journeyId:id,day:calendar.days.findIndex(d=>d.isoDate===part.date)+1,startTime:part.startTime,endTime:part.endTime});
      Object.assign(continuation.journey,{dialog:`${id}-journey`,statusId:`${id}-status`,buttonId:`${id}-refresh`});
      continuation.journey.legs.forEach((leg,n)=>Object.assign(leg,{timeId:`${id}-leg-${n}`,platformId:`${id}-leg-${n}-platform`,delayId:`${id}-leg-${n}-delay`}));
      calendar.events.push(continuation);
    }
    delete draft.journeyParts;
  }
  controls();
  editing = false;
  updateSaveState();
  agendaDay = draft.day;
  $("#agenda-day").value = agendaDay;
  $("#editor-title").textContent = draft.title;
  render();
  return true;
}
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (saving || sessionExpired || !editing || !applyDraft()) return;
  closeEditor();
  message("Im Entwurf gespeichert. Es wurde nichts veröffentlicht. Erst mit „Änderungen veröffentlichen“ oben wird der geänderte Reiseplan für Teilnehmende sichtbar.");
  if (mobileLayout()) returnToAgenda();
});
function restoreHistory(state) {
  restoringHistory = true;
  try {
    const changedPlan = JSON.stringify(calendar) !== JSON.stringify(state.calendar);
    // Snapshots are private clones, so the popped state can be adopted directly.
    calendar = state.calendar;
    dirty = changedPlan || dirty || state.dirty;
    selected = state.selected;
    draft = state.draft;
    editing = state.editing;
    refreshDayOptions();
    renderCountdownSettings();
    for (const [name, value] of Object.entries(state.countdownFields)) {
      const field = $("#countdown-form").elements[name];
      if (field) { field.value = value.value; if (value.checked !== undefined) field.checked = value.checked; }
    }
    if (draft) {
      showDraft();
      for (const [name, value] of Object.entries(state.fields)) {
        const field = form.elements[name];
        if (field) { field.value = value.value; if (value.checked !== undefined) field.checked = value.checked; }
      }
      window.restoreJourneyHistory?.(state.journey);
      syncTimeFields();
    } else closeEditor();
  } finally {
    lastEditorState = historySnapshot();
    controls();
    restoringHistory = false;
  }
  if (draft) mapLink();
  render();
}
$("#undo").onclick = () => {
  if (saving || sessionExpired || !history.length) return;
  future.push(historySnapshot());
  restoreHistory(history.pop());
  message("Letzten Bearbeitungsschritt zurückgenommen. Änderungen am Reiseplan sind noch nicht veröffentlicht.");
};
$("#redo").onclick = () => {
  if (saving || sessionExpired || !future.length) return;
  history.push(historySnapshot());
  restoreHistory(future.pop());
  message("Bearbeitungsschritt wiederholt. Änderungen am Reiseplan sind noch nicht veröffentlicht.");
};
async function saveChanges() {
  if (saving || sessionExpired) return;
  if (publicationBlocked) {
    message("Bitte erneut laden, damit bestehende Notizen erhalten bleiben.");
    return;
  }
  if (editing && !applyDraft()) return;
  if (!dirty) return;
  saving = true;
  $("#countdown-fields").disabled = true;
  updateSaveState();
  message("Der Reiseplan wird veröffentlicht. Bitte kurz warten …");
  $("#save").disabled = true;
  $("#undo").disabled = true;
  $("#new-event").disabled = true;
  $(".workspace").inert = true;
  $("#logout").disabled = true;
  try {
    const r = await adminFetch("/api/admin/calendar", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ calendar, revision }),
    });
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    revision = data.revision;
    if (data.trip) trip = data.trip;
    if (data.calendar) {
      for (const item of data.calendar.events) {
        const previous = calendar.events.find((e) => e.id === item.id);
        if (previous?.journey) window.adminJourneys[item.journeyId] = structuredClone(previous.journey);
        if (item.routeRef && previous?.mapRoute)
          routeData.set(item.routeRef, structuredClone(previous.mapRoute));
      }
      calendar = CalendarModel.normalize(data.calendar, trip);
    }
    publishedCalendar = structuredClone(calendar);
    dirty = false;
    // Keep session history so directly published edits can still be undone.
    if (selected) select(selected, true);
    else render();
    $("#event-search").value = "";
    closeEditor();
    message("Veröffentlicht. Teilnehmende sehen den neuen Stand, wenn sie den Reiseplan online neu laden.");
    if (mobileLayout()) returnToAgenda();
  } catch (e) {
    if (!(e instanceof AdminSessionExpired)) {
      const detail = e instanceof TypeError
        ? "Bitte prüfe deine Internetverbindung." : e.message;
      editorError(`Veröffentlichen hat nicht geklappt. Deine Änderungen sind noch hier. ${detail} Versuche es anschließend erneut.`);
    }
  } finally {
    saving = false;
    $("#countdown-fields").disabled = sessionExpired;
    $(".workspace").inert = sessionExpired;
    $("#logout").disabled = sessionExpired;
    controls();
  }
}
$("#save").onclick = saveChanges;
$("#logout").onclick = async () => {
  if (
    (dirty || editing) &&
    !confirm("Ungespeicherte Änderungen verwerfen und abmelden?")
  )
    return;
  try { await adminFetch("/admin/logout", {
    method: "POST",
    headers: { "X-CSRF-Token": csrf },
  });
  } catch (error) {
    if (!(error instanceof AdminSessionExpired)) message(error.message);
    return;
  }
  dirty = false;
  editing = false;
  location.href = "/admin";
};
window.addEventListener("beforeunload", (e) => {
  if (!sessionExpired && (dirty || editing)) {
    e.preventDefault();
    e.returnValue = "";
  }
});
// Persistence/bootstrap. Fetch route bodies for editing, but retain references in state.
(async () => {
  try {
    const r = await adminFetch("/api/admin/calendar");
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    ({ revision, csrf, trip } = data);
    window.PortalMaps?.setProvider(trip.mapProvider || "mapkit");
    publicationBlocked = Boolean(data.noteImportError);
    calendar = CalendarModel.normalize(data.calendar, trip);
    publishedCalendar = structuredClone(calendar);
    window.adminJourneys = data.journeys || {};
    watchAdminSession();
    await Promise.all(
      [...new Set(calendar.events.map((e) => e.routeRef).filter(Boolean))].map(
        async (ref) => {
          const response = await fetch(
            `/data/routes/${encodeURIComponent(ref)}.json`,
          );
          if (!response.ok)
            throw Error("Eine Route konnte nicht geladen werden.");
          routeData.set(ref, await response.json());
        },
      ),
    );
    refreshDayOptions();
    const today = CalendarModel.current(calendar).dayIndex;
    if (today >= 0) agendaDay = today + 1;
    $("#agenda-day").value = agendaDay;
    for (const name of ["startTime", "endTime"]) {
      form.elements[name].min = draft?.journeyDate ? "00:00" : time(bounds().start);
      form.elements[name].max = draft?.journeyDate ? "23:59" : time(bounds().end);
    }
    render();
    controls();
    message(
      data.noteImportError ||
        "Wähle einen Termin zum Bearbeiten oder klicke auf „Neuer Termin“.",
    );
  } catch (e) {
    if (!(e instanceof AdminSessionExpired)) message(e.message);
  }
})();

function localInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function renderCountdownSettings() {
  const settings = calendar.countdown || {}, fields = $("#countdown-form").elements;
  $("#countdown-fields").disabled = saving || sessionExpired;
  fields.enabled.checked = settings.enabled !== false;
  fields.deadlineEnabled.checked = Boolean(settings.deadline);
  fields.deadlineTitle.value = settings.deadline?.title || "";
  const start = localInput(settings.deadline?.startAt || new Date().toISOString());
  const end = localInput(settings.deadline?.at);
  fields.deadlineStartDate.value = start.slice(0, 10);
  fields.deadlineStartTime.value = start.slice(11);
  fields.deadlineEndDate.value = end.slice(0, 10);
  fields.deadlineEndTime.value = end.slice(11);
  fields.deadlineHideAt.value = localInput(settings.deadline?.hideAt);
  fields.warningMinutes.value = settings.deadline?.warningMinutes ?? 60;
}
// Changes go straight into the draft; publishing still happens via "Veröffentlichen".
function applyCountdownSettings() {
  if (!calendar || saving || sessionExpired) return;
  const fields = $("#countdown-form").elements;
  const settings = { enabled: fields.enabled.checked };
  if (fields.deadlineEnabled.checked) {
    const endInput = fields.deadlineEndDate.value && fields.deadlineEndTime.value ? `${fields.deadlineEndDate.value}T${fields.deadlineEndTime.value}` : "";
    const startInput = fields.deadlineStartDate.value && fields.deadlineStartTime.value ? `${fields.deadlineStartDate.value}T${fields.deadlineStartTime.value}` : "";
    const at = new Date(endInput), hideAt = new Date(fields.deadlineHideAt.value || endInput);
    const startAt = new Date(startInput);
    const title = fields.deadlineTitle.value.trim(), warningMinutes = Number(fields.warningMinutes.value);
    if (!title || !Number.isFinite(at.getTime()) || !Number.isFinite(hideAt.getTime()) || hideAt < at || (!Number.isFinite(startAt.getTime()) || startAt >= at) || !Number.isInteger(warningMinutes) || warningMinutes < 0 || warningMinutes > 10080) {
      message("Die Abgabefrist wird übernommen, sobald Titel, „Von“ und „Bis“ mit Uhrzeit vollständig sind. „Von“ muss vor „Bis“ liegen; die optionale Ausblendzeit darf nicht vor der Abgabe liegen. Die Warnzeit muss zwischen 0 und 10080 Minuten liegen.");
      return;
    }
    settings.deadline = {title, at: at.toISOString(), hideAt: hideAt.toISOString(), warningMinutes, ...(startAt ? {startAt: startAt.toISOString()} : {})};
  }
  if (JSON.stringify(settings) === JSON.stringify(calendar.countdown || {enabled: true})) return;
  checkpoint();
  calendar.countdown = settings;
  controls();
  message("Countdown-Einstellungen geändert. Zum Veröffentlichen oben „Änderungen veröffentlichen“.");
}
$("#countdown-form").onsubmit = event => {
  event.preventDefault();
  applyCountdownSettings();
};
$("#countdown-form").addEventListener("change", applyCountdownSettings);
$("#countdown-form").addEventListener("input", event => {
  const fields = $("#countdown-form").elements;
  if (event.target.name === "deadlineStartDate" && !fields.deadlineEndDate.value) {
    fields.deadlineEndDate.value = fields.deadlineStartDate.value;
  }
  updateSaveState();
});


for (const button of document.querySelectorAll(".new-menu-list button")) {
  button.addEventListener("click", () => { $(".new-menu").open = false; });
}
document.addEventListener("click", (event) => {
  if (!event.target.closest(".new-menu")) $(".new-menu").open = false;
});
