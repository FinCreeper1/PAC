"use strict";
const $ = (s) => document.querySelector(s),
  form = $("#editor");
let calendar,
  revision,
  csrf,
  selected,
  draft,
  history = [],
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
function updateSaveState() {
  $("#save-state").textContent = saving ? "Wird gespeichert …" : editing || dirty
    ? "Noch nicht gespeichert"
    : "Alle Änderungen sind gespeichert";
  $("#save").disabled = saving || sessionExpired || !(editing || dirty) || publicationBlocked;
  $("#save-event").disabled = saving || sessionExpired || !(editing || dirty) || publicationBlocked;
  $("#save-event").textContent = saving ? "Wird gespeichert …" : "Speichern – für alle sichtbar";
  $("#cancel-event").textContent = editing ? "Abbrechen" : "Zurück zu den Terminen";
  $("#editor-empty").hidden = Boolean(draft);
}
function controls() {
  updateSaveState();
  $("#delete-event").hidden = !calendar?.events.some(
    (item) => item.id === selected,
  );
  $("#new-event").disabled = sessionExpired || !calendar || calendar.events.length >= 200;
  $("#save").disabled = saving || sessionExpired || !(dirty || editing) || publicationBlocked;
  $("#undo").disabled = sessionExpired || !history.length;
}
function checkpoint() {
  history.push(structuredClone(calendar));
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
        message("Termin verschoben. Klicke oben auf „Änderungen speichern“, damit alle die neue Zeit sehen.");
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
    "Fülle den neuen Termin aus und klicke anschließend auf „Speichern – für alle sichtbar“.",
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
      `„${item.title}“ aus dem Plan löschen?${warning} Klicke danach auf „Änderungen speichern“, damit der Termin auch für alle anderen entfernt wird.`,
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
    "Termin zum Löschen vorgemerkt. Jetzt „Änderungen speichern“ oder „Letzte Änderung zurücknehmen“ wählen.",
  );
};
function mapLink() {
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
  if (!form.elements.latitude.value || !form.elements.longitude.value) {
    editorError("Bitte wähle zuerst einen Ort aus der Suche aus. So finden alle den richtigen Treffpunkt.", $("#search-place"));
    return false;
  }
  if (!form.reportValidity()) return false;
  const a = minutes(form.elements.startTime.value),
    b = minutes(form.elements.endTime.value);
  if (
    a === null ||
    b === null ||
    a < bounds().start ||
    b > bounds().end ||
    b <= a
  ) {
    editorError(
      `Die Endzeit muss nach dem Beginn liegen. Wähle Zeiten zwischen ${time(bounds().start)} und ${time(bounds().end)} Uhr.`,
      form.elements.endTime,
    );
    return;
  }
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
  for (const name of ["day", "latitude", "longitude"])
    draft[name] = Number(form.elements[name].value);
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
  controls();
  editing = false;
  updateSaveState();
  agendaDay = draft.day;
  $("#agenda-day").value = agendaDay;
  $("#editor-title").textContent = draft.title;
  render();
  return true;
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveChanges();
});
$("#undo").onclick = () => {
  if (editing && !confirm("Deine Eingaben sind noch nicht gespeichert. Möchtest du sie verwerfen?")) return;
  calendar = history.pop();
  dirty = true;
  controls();
  render();
  if (selected) select(selected, true);
  message("Letzte Änderung zurückgenommen.");
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
  message("Der Reiseplan wird gespeichert. Bitte kurz warten …");
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
    if (data.calendar) {
      for (const item of data.calendar.events) {
        const previous = calendar.events.find((e) => e.id === item.id);
        if (item.routeRef && previous?.mapRoute)
          routeData.set(item.routeRef, structuredClone(previous.mapRoute));
      }
      calendar = CalendarModel.normalize(data.calendar, trip);
    }
    dirty = false;
    history = [];
    if (selected) select(selected, true);
    else render();
    $("#event-search").value = "";
    closeEditor();
    message("Gespeichert. Alle Teilnehmenden sehen jetzt den aktualisierten Reiseplan.");
    if (mobileLayout()) returnToAgenda();
  } catch (e) {
    if (!(e instanceof AdminSessionExpired)) {
      const detail = e instanceof TypeError
        ? "Bitte prüfe deine Internetverbindung." : e.message;
      editorError(`Speichern hat nicht geklappt. Deine Änderungen sind noch hier. ${detail} Versuche es anschließend erneut.`);
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
    publicationBlocked = Boolean(data.noteImportError);
    calendar = CalendarModel.normalize(data.calendar, trip);
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
    for (const [i, d] of calendar.days.entries()) {
      const o = document.createElement("option");
      o.value = i + 1;
      o.textContent = CalendarModel.dayLabel(d);
      form.elements.day.append(o);
      $("#agenda-day").append(o.cloneNode(true));
    }
    const today = CalendarModel.current(calendar).dayIndex;
    if (today >= 0) agendaDay = today + 1;
    $("#agenda-day").value = agendaDay;
    for (const name of ["startTime", "endTime"]) {
      form.elements[name].min = time(bounds().start);
      form.elements[name].max = time(bounds().end);
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
  fields.deadlineAt.value = localInput(settings.deadline?.at);
  fields.deadlineHideAt.value = localInput(settings.deadline?.hideAt);
  fields.warningMinutes.value = settings.deadline?.warningMinutes ?? 60;
}
$("#countdown-form").onsubmit = event => {
  event.preventDefault();
  if (!calendar || saving || sessionExpired) return;
  const fields = event.currentTarget.elements;
  const settings = { enabled: fields.enabled.checked };
  if (fields.deadlineEnabled.checked) {
    const at = new Date(fields.deadlineAt.value), hideAt = new Date(fields.deadlineHideAt.value);
    const title = fields.deadlineTitle.value.trim(), warningMinutes = Number(fields.warningMinutes.value);
    if (!title || !Number.isFinite(at.getTime()) || !Number.isFinite(hideAt.getTime()) || hideAt <= at || !Number.isInteger(warningMinutes) || warningMinutes < 0 || warningMinutes > 10080) {
      message("Bitte Titel, Abgabezeit und eine spätere Ausblendzeit eintragen. Die Warnzeit muss zwischen 0 und 10080 Minuten liegen.");
      return;
    }
    settings.deadline = {title, at: at.toISOString(), hideAt: hideAt.toISOString(), warningMinutes};
  }
  checkpoint();
  calendar.countdown = settings;
  controls();
  message("Countdown-Einstellungen übernommen. Bitte oben Änderungen speichern.");
};
