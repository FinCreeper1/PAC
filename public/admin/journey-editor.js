"use strict";
let journeyLegs = [];
window.captureJourneyHistory = () => structuredClone(journeyLegs);
window.restoreJourneyHistory = legs => {
  journeyLegs = structuredClone(legs || []);
  renderJourneyLegs();
  syncJourneySection();
};
function syncJourneySection() {
  $("#journey-section").hidden = !form.elements.isJourney.checked;
}
const legFields = [
  ["service", "Zug, z. B. ICE 517"], ["origin", "Abfahrtsbahnhof"],
  ["destination", "Ankunftsbahnhof"], ["departure", "Abfahrt", "time"],
  ["arrival", "Ankunft", "time"], ["platform", "Abfahrtsgleis (freiwillig)"],
  ["number", "Zugnummer für Live-Daten (freiwillig)"],
  ["station", "Abfahrtsbahnhof-ID (freiwillig)"],
  ["arrivalStation", "Ankunftsbahnhof-ID (freiwillig)"],
];
const minutesOf = time => /^\d{1,2}:\d{2}$/.test(time || "") ? time.split(":").reduce((h,m)=>h*60+ +m) : null;
const minutesBetween = (from, to) => {
  const a = minutesOf(from), b = minutesOf(to);
  return a == null || b == null ? null : (b - a + 1440) % 1440;
};
const formatDuration = minutes => minutes >= 60 ? `${Math.floor(minutes/60)} h ${String(minutes%60).padStart(2,"0")} min` : `${minutes} min`;
const element = (tag, className, text) => Object.assign(document.createElement(tag), {className, textContent: text ?? ""});

// Stops with times on the left, trains between them, transfers with wait time.
function journeyTimeline(legs) {
  const timeline = element("ol", "journey-timeline");
  const stop = (time, place, platform, kind) => {
    const [name, track] = (place || "").split(" · ");
    const item = element("li", "journey-stop " + kind);
    item.append(element("span", "journey-stop-time", time || "…"), element("strong", "", name || (kind === "end" ? "Ziel" : "Start")));
    const gleis = track || (platform ? (/gleis/i.test(platform) ? platform : "Gleis " + platform) : "");
    if (gleis) item.append(element("span", "journey-badge", gleis));
    return item;
  };
  legs.forEach((leg, index) => {
    if (index) {
      const wait = minutesBetween(legs[index-1].arrival, leg.departure);
      timeline.append(element("li", "journey-timeline-transfer", `Umstieg${wait != null ? " · " + wait + " min" : ""}`));
    }
    timeline.append(stop(leg.departure + (leg.departureDate ? ` · ${leg.departureDate}` : ""), leg.origin, leg.platform, "start"));
    const [, name, number] = (leg.service || "").match(/^(.*?)\s*(\(\d+\))?$/) || [];
    const ride = element("li", "journey-ride");
    const train = element("span", "journey-train", name || leg.service || "Zug");
    if (number) train.append(element("small", "", " " + number.slice(1,-1)));
    const duration = minutesBetween(leg.departure, leg.arrival);
    ride.append(train);
    if (duration != null) ride.append(element("span", "journey-leg-time", formatDuration(duration)));
    timeline.append(ride, stop(leg.arrival + (leg.arrivalDate ? ` · ${leg.arrivalDate}` : ""), leg.destination, "", "end"));
  });
  return timeline;
}
function renderJourneyLegs() {
  const list = $("#journey-legs");
  list.replaceChildren();
  const summary = $("#journey-summary");
  if (summary) {
    summary.replaceChildren();
    if (journeyLegs.length) summary.append(journeyTimeline(journeyLegs));
  }
  journeyLegs.forEach((leg, index) => {
    const section = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = `Zugabschnitt ${index + 1}`;
    section.append(legend);
    const technical = document.createElement("details"), technicalTitle = document.createElement("summary");
    technicalTitle.textContent = "Technische Angaben für Live-Daten";
    technical.append(technicalTitle);
    for (const [key, text, type] of legFields) {
      const label = document.createElement("label"), input = document.createElement("input");
      label.textContent = text;
      input.type = type || "text";
      input.maxLength = 500;
      input.value = leg[key] || "";
      input.oninput = () => { leg[key] = input.value.trim(); editing = true; updateSaveState(); };
      label.append(input);
      (["number", "station", "arrivalStation"].includes(key) ? technical : section).append(label);
    }
    section.append(technical);
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
  if ($("#journey-search-details")) $("#journey-search-details").open = false;
  if ($("#journey-manual-details")) $("#journey-manual-details").open = false;
  for (const name of ["journeyOrigin", "journeyDestination", "journeyDate", "journeyTime"]) form.elements[name].value = "";
  for(const key of ["startTime","endTime"]) {
    form.elements[key].min=draft.journeyDate ? "00:00" : CalendarModel.time(bounds().start);
    form.elements[key].max=draft.journeyDate ? "23:59" : CalendarModel.time(bounds().end);
  }
  const details = draft.journey || window.adminJourneys?.[draft.journeyId];
  form.elements.isJourney.checked = Boolean(details);
  form.elements.journeyUrl.value = details?.url || "";
  journeyLegs = details ? CalendarModel.journey(draft, details).legs : [];
  syncJourneySection();
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
  form.elements.isJourney.checked = true;
  syncJourneySection();
  message("Füge den ganzen Text aus „Teilen“ ein. Wähle anschließend deine Verbindung aus und speichere die Zugreise.");
};
window.applyJourneyDraft = () => {
  if (!form.elements.isJourney.checked) {
    delete draft.journey;
    delete draft.journeyId;
    delete draft.journeyDate;delete draft.journeyEndDate;delete draft.journeyParts;
    return true;
  }
  const legs = structuredClone(journeyLegs);
  if (!legs.length) {
    editorError("Füge den Teilentext ein und wähle eine Verbindung aus.", form.elements.journeyUrl);
    return false;
  }
  if (!draft.journeyDate) {
    legs[0].departure = form.elements.startTime.value;
    legs.at(-1).arrival = form.elements.endTime.value;
  }
  for (const [i, leg] of legs.entries()) {
    if (!["service", "origin", "destination"].every(key => leg[key]?.trim()) ||
        minutes(leg.departure) === null || minutes(leg.arrival) === null ||
        (draft.journeyDate ?
          (!CalendarModel.validDate(leg.departureDate) || !CalendarModel.validDate(leg.arrivalDate) || `${leg.arrivalDate}T${leg.arrival}` <= `${leg.departureDate}T${leg.departure}` || (i && `${leg.departureDate}T${leg.departure}` < `${legs[i-1].arrivalDate}T${legs[i-1].arrival}`)) :
          (minutes(leg.arrival) <= minutes(leg.departure) || (i && minutes(leg.departure) < minutes(legs[i - 1].arrival))))) {
      if ($("#journey-manual-details")) $("#journey-manual-details").open = true;
      editorError(`Bitte Bahnhöfe, Zug und Zeiten von Zugabschnitt ${i + 1} prüfen. Die Abschnitte müssen zeitlich aufeinander folgen.`, $("#add-leg"));
      return false;
    }
    const id = `${draft.id}-leg-${i}`;
    Object.assign(leg, { timeId: id, platformId: `${id}-platform`, delayId: `${id}-delay` });
  }
  form.elements.type.value = "travel";
  draft.journeyId = draft.id;
  draft.journey = { legs, ...(legs.some(leg => leg.importSource === "transport-rest") ? {source:"transport-rest"} : legs.some(leg => Object.hasOwn(leg, "transitousTripId")) ? {source:"transitous"} : {}), heading: `${legs[0].origin} → ${legs.at(-1).destination}`,
    url: form.elements.journeyUrl.value.match(/https?:\/\/\S+/)?.[0].replace(/[).,;]+$/, "") || "https://www.bahn.de/",
    dialog: `${draft.id}-journey`, statusId: `${draft.id}-status`, buttonId: `${draft.id}-refresh` };
  return true;
};

let importingJourney = false;
let journeyRetryUntil = 0, journeyRetryTimer;
function waitForJourneySearch(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  journeyRetryUntil = Date.now() + seconds * 1000;
  clearInterval(journeyRetryTimer);
  const update = () => {
    const remaining = Math.max(0, Math.ceil((journeyRetryUntil - Date.now()) / 1000));
    const button = $("#import-journey");
    button.disabled = importingJourney || remaining > 0;
    button.textContent = remaining ? `Erneut suchen in ${remaining} s` : "Verbindung suchen";
    if (!remaining) clearInterval(journeyRetryTimer);
  };
  update();
  journeyRetryTimer = setInterval(update, 1000);
}
const journeyFormState = () => JSON.stringify([...new FormData(form).entries()]) + JSON.stringify(journeyLegs);
function applyImportedJourney(data, currentDraft, currentState) {
  if (draft !== currentDraft) return;
  const status = $("#journey-import-status");
  try {
    if (journeyFormState() !== currentState) throw Error("Deine Eingaben wurden inzwischen geändert. Bitte erneut importieren.");
    const journeyDays = CalendarModel.journeyDays(data);
    if (!data.endDate && (minutes(data.startTime) < bounds().start || minutes(data.endTime) > bounds().end))
      throw Error("Die Verbindung liegt außerhalb der Uhrzeiten dieses Reiseplans. Deine Eingaben bleiben erhalten.");
    if (calendar.events.length + journeyDays.length - (calendar.events.some(e=>e.id===draft.id)?1:0) > 200) throw Error("Höchstens 200 Termine im Reiseplan speichern.");
    if (data.endDate) {
      checkpoint();
      const draftDate=calendar.days[draft.day-1]?.isoDate;
      for(const part of journeyDays) calendar=CalendarModel.extend(calendar,part.date);
      draft.day=calendar.days.findIndex(d=>d.isoDate===draftDate)+1;
      draft.journeyDate=data.date;draft.journeyEndDate=data.endDate;
      draft.journeyParts=journeyDays;
      refreshDayOptions();render();
      data=journeyDays[0];
      for(const key of ["startTime","endTime"]) {form.elements[key].min="00:00";form.elements[key].max="23:59";}
    } else {delete draft.journeyDate;delete draft.journeyEndDate;delete draft.journeyParts;}
    let day = calendar.days.findIndex(item => item.isoDate === data.date);
    if (day < 0) {
      const extended = CalendarModel.extend(calendar, data.date);
      if (!confirm(`Den Kalendertag ${data.date} zur Reise hinzufügen und die Verbindung übernehmen? Bestehende Termine behalten ihr Datum. Die Änderung wird erst mit „Veröffentlichen“ oben auf der Seite veröffentlicht.`)) return;
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
    syncJourneySection();
    editing = true;
    syncTimeFields();
    form.elements.time.value = CalendarModel.label(data);
    renderJourneyLegs();
    mapLink();
    updateSaveState();
    $("#journey-options").replaceChildren();
    status.textContent = (data.source === "text"
      ? "Verbindung aus dem eingefügten Text übernommen. Prüfe die Angaben und speichere die Zugreise."
      : `${journeyLegs.length} Zugabschnitt${journeyLegs.length === 1 ? "" : "e"} aus Transitous übernommen. Prüfe die Angaben und speichere die Zugreise.`) +
      (data.latitude == null ? " Wähle den Abfahrtsbahnhof noch über die Ortssuche aus." : "");
  } catch (error) { status.textContent = error.message; }
}
$("#import-journey").onclick = async () => {
  if (importingJourney || !draft || Date.now() < journeyRetryUntil) return;
  const url = form.elements.journeyUrl.value.trim();
  const status = $("#journey-import-status"), button = $("#import-journey");
  if (journeyLegs.some(leg => leg.service || leg.origin || leg.destination) &&
      !confirm("Nach Auswahl einer Verbindung werden die bisherigen Zugabschnitte und Terminangaben ersetzt. Fortfahren?")) return;
  const currentDraft = draft, currentState = journeyFormState();
  importingJourney = true;
  button.disabled = true;
  $("#journey-options").replaceChildren();
  status.textContent = "Verbindung mit Umstiegen wird gesucht …";
  try {
    const search = {origin:form.elements.journeyOrigin.value,destination:form.elements.journeyDestination.value,
      date:form.elements.journeyDate.value,time:form.elements.journeyTime.value};
    const response = await adminFetch("/api/admin/journey-import", {
      method: "POST", headers: {"Content-Type":"application/json", "X-CSRF-Token":csrf},
      body: JSON.stringify({url,search}), signal: AbortSignal.timeout(65000),
    });
    const data = await response.json();
    if (draft !== currentDraft) return;
    waitForJourneySearch(data.retryAfter);
    if (!response.ok) {
      if (data.detected) fillDetected(data.detected);
      throw Error(data.error || "Die Verbindung konnte nicht geladen werden.");
    }
    if (journeyFormState() !== currentState) throw Error("Deine Eingaben wurden inzwischen geändert. Bitte erneut importieren.");
    if (data.recommended != null && data.choices[data.recommended]) return applyImportedJourney(data.choices[data.recommended], currentDraft, currentState);
    status.textContent = data.source === "text"
      ? (data.choices.some(choice=>choice.incomplete)
        ? "Der Text enthält nur eine Übersicht. Umstiege und einzelne Zugabschnitte fehlen. Du kannst die Übersicht übernehmen und anschließend ergänzen."
        : "Fahrtdaten aus deinem Text. Prüfe die Verbindung und übernimm sie anschließend.")
      : "Wähle die passende Verbindung. Die Suche kann von der ursprünglichen Bahn-Verbindung abweichen.";
    if (data.warning) status.textContent = data.warning + " " + status.textContent;
    for (const choice of data.choices)
      $("#journey-options").append(journeyChoiceCard(choice, data.source === "text", () => applyImportedJourney(choice,currentDraft,currentState)));
  } catch (error) {
    if (draft === currentDraft && !(error instanceof AdminSessionExpired))
      status.textContent = error.name === "TimeoutError" ? "Der Abruf dauert zu lange. Bitte erneut versuchen. Deine Eingaben bleiben erhalten." : error.message;
  } finally {
    importingJourney = false;
    button.disabled = Date.now() < journeyRetryUntil;
  }
};

// One button per connection: times first, then trains and transfers at a glance.
function journeyChoiceCard(choice, fromText, onSelect) {
  const card = element("button", "journey-choice");
  card.type = "button";
  const head = element("span", "journey-choice-head");
  head.append(element("strong", "journey-choice-times", `${choice.startTime} → ${choice.endTime}`));
  const duration = choice.endDate ? (Date.parse(choice.endDate)-Date.parse(choice.date))/60000 + minutesOf(choice.endTime)-minutesOf(choice.startTime) : minutesBetween(choice.startTime, choice.endTime);
  const transfers = choice.legs.length - 1;
  const badges = element("span", "journey-choice-badges");
  if (duration != null) badges.append(element("span", "journey-badge", formatDuration(duration)));
  if (!choice.incomplete) badges.append(element("span", "journey-badge", transfers ? `${transfers} Umstieg${transfers > 1 ? "e" : ""}` : "Direkt"));
  head.append(badges);
  const meta = element("span", "journey-choice-meta", `${choice.date}${choice.endDate ? " → " + choice.endDate : ""} · ${choice.title}`);
  const legs = element("span", "journey-choice-legs");
  choice.legs.forEach((leg, index) => {
    if (index) {
      const wait = minutesBetween(choice.legs[index-1].arrival, leg.departure);
      legs.append(element("span", "journey-transfer", `Umstieg ${leg.origin}${wait != null ? ` · ${wait} min` : ""}`));
    }
    const [, name, number] = (leg.service || "").match(/^(.*?)\s*(\(\d+\))?$/) || [];
    const row = element("span", "journey-leg");
    const train = element("span", "journey-train", name || leg.service || "Zug");
    if (number) train.append(element("small", "", " " + number.slice(1,-1)));
    row.append(train, element("span", "journey-leg-time", `${leg.departure}–${leg.arrival}`));
    legs.append(row);
  });
  if (choice.incomplete) legs.append(element("span", "journey-transfer", "Umstiege fehlen – nach Übernahme ergänzen"));
  card.append(head, meta, legs, element("span", "journey-choice-action", fromText ? "Textübersicht übernehmen →" : "Diese Verbindung übernehmen →"));
  card.onclick = onSelect;
  return card;
}

// Shows what was recognised so only the missing details need typing.
function fillDetected(detected) {
  if (!detected) return;
  const fields = {journeyOrigin:"origin", journeyDestination:"destination", journeyDate:"date", journeyTime:"time"};
  let missing;
  for (const [name, key] of Object.entries(fields)) {
    if (!form.elements[name].value && detected[key]) form.elements[name].value = detected[key];
    if (!form.elements[name].value) missing ??= form.elements[name];
  }
  if ($("#journey-search-details")) $("#journey-search-details").open = true;
  missing?.focus();
}
form.elements.journeyUrl.addEventListener("paste", () => setTimeout(() => {
  for (const name of ["journeyOrigin", "journeyDestination", "journeyDate", "journeyTime"]) form.elements[name].value = "";
  if (form.elements.journeyUrl.value.trim()) $("#import-journey").onclick();
}));
$("#new-journey-from-link").onclick = () => {
  const previous = draft;
  $("#new-journey").onclick();
  if (draft === previous) return;
  form.elements.journeyUrl.focus();
  form.elements.journeyUrl.scrollIntoView({block:"center"});
};
form.elements.isJourney.addEventListener("change", () => {
  if (form.elements.isJourney.checked) {
    form.elements.type.value = "travel";
    if (!journeyLegs.length) $("#add-leg").onclick();
  }
  syncJourneySection();
});
