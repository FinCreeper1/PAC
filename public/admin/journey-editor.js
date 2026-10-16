"use strict";
let journeyLegs = [];
const legFields = [
  ["service", "Zug, z. B. ICE 517"], ["origin", "Abfahrtsbahnhof"],
  ["destination", "Ankunftsbahnhof"], ["departure", "Abfahrt", "time"],
  ["arrival", "Ankunft", "time"], ["platform", "Abfahrtsgleis (freiwillig)"],
  ["number", "Zugnummer für Live-Daten (freiwillig)"],
  ["station", "Abfahrtsbahnhof-ID (freiwillig)"],
  ["arrivalStation", "Ankunftsbahnhof-ID (freiwillig)"],
];
function renderJourneyLegs() {
  const list = $("#journey-legs");
  list.replaceChildren();
  journeyLegs.forEach((leg, index) => {
    const section = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = `Zugabschnitt ${index + 1}`;
    section.append(legend);
    for (const [key, text, type] of legFields) {
      const label = document.createElement("label"), input = document.createElement("input");
      label.textContent = text;
      input.type = type || "text";
      input.maxLength = 500;
      input.value = leg[key] || "";
      input.oninput = () => { leg[key] = input.value.trim(); };
      label.append(input);
      section.append(label);
    }
    for (const [text, offset] of [["Nach oben", -1], ["Nach unten", 1], ["Entfernen", 0]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.disabled = offset !== 0 && !journeyLegs[index + offset];
      button.onclick = () => {
        if (offset) [journeyLegs[index], journeyLegs[index + offset]] = [journeyLegs[index + offset], journeyLegs[index]];
        else journeyLegs.splice(index, 1);
        editing = true;
        updateSaveState();
        renderJourneyLegs();
      };
      section.append(button);
    }
    list.append(section);
  });
}
window.showJourneyDraft = () => {
  $("#journey-import-status").textContent = "";
  $("#journey-options").replaceChildren();
  for (const name of ["journeyOrigin", "journeyDestination", "journeyDate", "journeyTime"]) form.elements[name].value = "";
  const details = draft.journey || window.adminJourneys?.[draft.journeyId];
  form.elements.isJourney.checked = Boolean(details);
  form.elements.journeyUrl.value = details?.url || "";
  journeyLegs = details ? CalendarModel.journey(draft, details).legs : [];
  $("#journey-section").open = Boolean(details) || draft.type === "travel";
  renderJourneyLegs();
};
$("#add-leg").onclick = () => {
  if (journeyLegs.length >= 20) return;
  form.elements.isJourney.checked = true;
  journeyLegs.push({ origin: journeyLegs.at(-1)?.destination || "", departure: journeyLegs.at(-1)?.arrival || form.elements.startTime.value, arrival: form.elements.endTime.value });
  editing = true;
  updateSaveState();
  renderJourneyLegs();
};
$("#new-journey").onclick = () => {
  const previous = draft;
  $("#new-event").onclick();
  if (draft === previous) return;
  form.elements.type.value = "travel";
  $("#journey-section").open = true;
  $("#add-leg").onclick();
  message("Füge den geteilten Bahn-Link ein und klicke auf „Mit Transitous suchen“. Alternativ kannst du die Zugabschnitte selbst eintragen.");
};
window.applyJourneyDraft = () => {
  if (!form.elements.isJourney.checked) {
    delete draft.journey;
    delete draft.journeyId;
    return true;
  }
  const legs = structuredClone(journeyLegs);
  if (!legs.length) {
    editorError("Füge mindestens einen Zugabschnitt hinzu.", $("#add-leg"));
    return false;
  }
  legs[0].departure = form.elements.startTime.value;
  legs.at(-1).arrival = form.elements.endTime.value;
  for (const [i, leg] of legs.entries()) {
    if (!["service", "origin", "destination"].every(key => leg[key]?.trim()) ||
        minutes(leg.departure) === null || minutes(leg.arrival) === null ||
        minutes(leg.arrival) <= minutes(leg.departure) ||
        (i && minutes(leg.departure) < minutes(legs[i - 1].arrival))) {
      editorError(`Bitte Bahnhöfe, Zug und Zeiten von Zugabschnitt ${i + 1} prüfen. Die Abschnitte müssen zeitlich aufeinander folgen.`, $("#add-leg"));
      return false;
    }
    const id = `${draft.id}-leg-${i}`;
    Object.assign(leg, { timeId: id, platformId: `${id}-platform`, delayId: `${id}-delay` });
  }
  form.elements.type.value = "travel";
  draft.journeyId = draft.id;
  draft.journey = { legs, ...(legs.some(leg => Object.hasOwn(leg, "transitousTripId")) ? {source:"transitous"} : {}), heading: `${legs[0].origin} → ${legs.at(-1).destination}`,
    url: form.elements.journeyUrl.value.trim() || "https://www.bahn.de/",
    dialog: `${draft.id}-journey`, statusId: `${draft.id}-status`, buttonId: `${draft.id}-refresh` };
  return true;
};

let importingJourney = false;
const journeyFormState = () => JSON.stringify([...new FormData(form).entries()]) + JSON.stringify(journeyLegs);
function applyImportedJourney(data, currentDraft, currentState) {
  if (draft !== currentDraft) return;
  const status = $("#journey-import-status");
  try {
    if (journeyFormState() !== currentState) throw Error("Deine Eingaben wurden inzwischen geändert. Bitte erneut mit Transitous suchen.");
    if (minutes(data.startTime) < bounds().start || minutes(data.endTime) > bounds().end)
      throw Error("Die Verbindung liegt außerhalb der Uhrzeiten dieses Reiseplans. Deine Eingaben bleiben erhalten.");
    let day = calendar.days.findIndex(item => item.isoDate === data.date);
    if (day < 0) {
      const extended = CalendarModel.extend(calendar, data.date);
      if (!confirm(`Den Kalendertag ${data.date} zur Reise hinzufügen und die Verbindung übernehmen? Bestehende Termine behalten ihr Datum. Die Änderung wird erst beim Speichern veröffentlicht.`)) return;
      const draftDate = calendar.days[draft.day - 1]?.isoDate;
      checkpoint();
      calendar = extended;
      draft.day = calendar.days.findIndex(d=>d.isoDate===draftDate) + 1;
      agendaDay = draft.day;
      refreshDayOptions();
      day = calendar.days.findIndex(item => item.isoDate === data.date);
      render();
    }
    journeyLegs = data.legs;
    for (const key of ["title", "location", "startTime", "endTime"]) form.elements[key].value = data[key];
    form.elements.day.value = day + 1;
    form.elements.latitude.value = data.latitude ?? "";
    form.elements.longitude.value = data.longitude ?? "";
    form.elements.type.value = "travel";
    form.elements.timing.value = "scheduled";
    form.elements.isJourney.checked = true;
    editing = true;
    syncTimeFields();
    form.elements.time.value = CalendarModel.label(data);
    renderJourneyLegs();
    mapLink();
    updateSaveState();
    $("#journey-options").replaceChildren();
    status.textContent = `${journeyLegs.length} Zugabschnitt${journeyLegs.length === 1 ? "" : "e"} aus Transitous übernommen. Prüfe die Angaben und speichere die Zugreise.` +
      (data.latitude == null ? " Wähle den Abfahrtsbahnhof noch über die Ortssuche aus." : "");
  } catch (error) { status.textContent = error.message; }
}
$("#import-journey").onclick = async () => {
  if (importingJourney || !draft) return;
  const url = form.elements.journeyUrl.value.trim();
  const status = $("#journey-import-status"), button = $("#import-journey");
  if (journeyLegs.some(leg => leg.service || leg.origin || leg.destination) &&
      !confirm("Nach Auswahl einer Verbindung werden die bisherigen Zugabschnitte und Terminangaben ersetzt. Fortfahren?")) return;
  const currentDraft = draft, currentState = journeyFormState();
  importingJourney = true;
  button.disabled = true;
  $("#journey-options").replaceChildren();
  status.textContent = "Passende Verbindungen werden mit Transitous gesucht …";
  try {
    const search = {origin:form.elements.journeyOrigin.value,destination:form.elements.journeyDestination.value,
      date:form.elements.journeyDate.value,time:form.elements.journeyTime.value};
    const response = await adminFetch("/api/admin/journey-import", {
      method: "POST", headers: {"Content-Type":"application/json", "X-CSRF-Token":csrf},
      body: JSON.stringify({url,search}), signal: AbortSignal.timeout(65000),
    });
    const data = await response.json();
    if (draft !== currentDraft) return;
    if (!response.ok) throw Error(data.error || "Die Verbindung konnte nicht geladen werden.");
    if (journeyFormState() !== currentState) throw Error("Deine Eingaben wurden inzwischen geändert. Bitte erneut mit Transitous suchen.");
    status.textContent = "Wähle die passende Verbindung. Die Suche kann von der ursprünglichen Bahn-Verbindung abweichen.";
    for (const choice of data.choices) {
      const select = document.createElement("button");
      select.type = "button";
      select.textContent = `${choice.date} · ${choice.startTime}–${choice.endTime} · ${choice.legs.map(leg=>leg.service).join(" → ")} – übernehmen`;
      select.onclick = () => applyImportedJourney(choice,currentDraft,currentState);
      $("#journey-options").append(select);
    }
  } catch (error) {
    if (draft === currentDraft && !(error instanceof AdminSessionExpired))
      status.textContent = error.name === "TimeoutError" ? "Der Abruf dauert zu lange. Bitte erneut versuchen. Deine Eingaben bleiben erhalten." : error.message;
  } finally {
    importingJourney = false;
    button.disabled = false;
  }
};

$("#new-journey-from-link").onclick = () => {
  const previous = draft;
  $("#new-journey").onclick();
  if (draft === previous) return;
  form.elements.journeyUrl.focus();
  form.elements.journeyUrl.scrollIntoView({block:"center"});
};
form.elements.type.addEventListener("change", () => {
  if (form.elements.type.value === "travel") $("#journey-section").open = true;
});
