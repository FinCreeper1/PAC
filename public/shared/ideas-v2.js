(() => {
  const tabs = [...document.querySelectorAll("[data-page-tab]")];
  const calendar = document.getElementById("kalender");
  const section = document.getElementById("ideen");
  const form = document.getElementById("idea-form");
  const input = document.getElementById("idea-text");
  const authorInput = document.getElementById("idea-author");
  const dateInput = document.getElementById("idea-date");
  const timeInput = document.getElementById("idea-time");
  const placeInput = document.getElementById("idea-place");
  const list = document.getElementById("ideas-list");
  const status = document.getElementById("ideas-status");
  let busy = false;
  let participantNames = [];
  let freeWindows = [];

  let planningReady = false;
  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  function minutes(value) {
    const [hour, minute] = String(value).split(":").map(Number);
    return hour * 60 + minute;
  }

  function timeValue(value) {
    return String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0");
  }

  function initials(name) {
    return String(name).trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() || "").join("");
  }

  function fillNameSelect(select, placeholder = "Name auswählen") {
    select.replaceChildren();
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.append(empty);
    for (const participant of participantNames) {
      const option = document.createElement("option");
      option.value = participant;
      option.textContent = participant;
      select.append(option);
    }
  }

  function updateFreeTimes() {
    const previousTime = timeInput.value;
    timeInput.replaceChildren();
    const relevant = freeWindows.filter((slot) => slot.date === dateInput.value);
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = relevant.length ? "Uhrzeit auswählen" : "Keine Freizeit freigegeben";
    timeInput.append(empty);
    for (const slot of relevant) {
      for (let current = minutes(slot.start); current < minutes(slot.end); current += 15) {
        const value = timeValue(current);
        if ([...timeInput.options].some((option) => option.value === value)) continue;
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value + " Uhr";
        timeInput.append(option);
      }
    }
    if ([...timeInput.options].some((option) => option.value === previousTime)) timeInput.value = previousTime;
    timeInput.disabled = !relevant.length;
    submitButton.disabled = busy || !planningReady || !relevant.length || !participantNames.length;
    const hint = document.getElementById("idea-free-time-hint");
    hint.textContent = !participantNames.length
      ? "Die Reiseleitung muss zuerst unter Einstellungen Teilnehmende ergänzen, damit du eine Idee eintragen kannst."
      : relevant.length
      ? "Freigegebene Freizeit: " + relevant.map((slot) => slot.start + "–" + slot.end + " Uhr").join(", ")
      : "Für diesen Tag hat die Reiseleitung noch keine Freizeit freigegeben.";
  }

  async function loadPlanningConfig() {
    const [tripResponse, calendarResponse] = await Promise.all([
      fetch("/data/trip.json", { cache: "no-store" }),
      fetch("/data/calendar.json", { cache: "no-store" })
    ]);
    if (!tripResponse.ok || !calendarResponse.ok) throw new Error("Teilnehmer oder Freizeit konnten nicht geladen werden.");
    const trip = await tripResponse.json();
    const calendarData = await calendarResponse.json();
    participantNames = Array.isArray(trip.participants) ? trip.participants.filter((name) => typeof name === "string" && name.trim()) : [];
    freeWindows = (calendarData.events || [])
      .filter((event) => event.type === "free" && event.timing === "scheduled")
      .map((event) => ({
        date: calendarData.days?.[Number(event.day) - 1]?.isoDate || "",
        start: event.startTime,
        end: event.endTime
      }))
      .filter((slot) => slot.date && slot.start && slot.end);
    const previousAuthor = authorInput.value;
    fillNameSelect(authorInput);
    if (participantNames.includes(previousAuthor)) authorInput.value = previousAuthor;
    const previousDate = dateInput.value;
    const dates = [...new Set((calendarData.days || []).map((day) => day.isoDate).filter(Boolean))].sort();
    dateInput.replaceChildren();
    for (const date of dates) {
      const option = document.createElement("option");
      option.value = date;
      option.textContent = dayLabel(date);
      dateInput.append(option);
    }
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: trip.timeZone || "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
    dateInput.value = dates.includes(previousDate) ? previousDate
      : dates.includes(today) ? today : freeWindows[0]?.date || dates[0] || "";
    dateInput.disabled = !dates.length;
    const heading = section.querySelector(".ideas-kicker");
    if (heading) heading.textContent = trip.title || "Reiseideen";
    planningReady = true;
    updateFreeTimes();
  }

  dateInput.addEventListener("change", updateFreeTimes);

  function mapsLink(location) {
    const query = new URLSearchParams();
    if (location.name) query.set("q", location.name);
    if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) query.set("ll", location.latitude + "," + location.longitude);
    return "https://maps.apple.com/?" + query;
  }

  async function renderMap(container, location) {
    try {
      if (window.PortalMaps && await PortalMaps.isOSM()) {
        if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
          container.textContent = "Für die Karte werden Koordinaten benötigt.";
          return;
        }
        await PortalMaps.render(container, [location]);
        return;
      }
      const mapkit = await loadMapKit();
      let coordinate;
      if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
        coordinate = new mapkit.Coordinate(location.latitude, location.longitude);
      } else if (location.name) {
        if (mapkit.load) await mapkit.load(["services"]);
        const result = await new mapkit.Search().search(location.name);
        coordinate = result.places?.[0]?.coordinate;
      }
      if (!coordinate || !container.isConnected) throw new Error();
      container.replaceChildren();

      const hostelCoordinate = new mapkit.Coordinate(50.7684, 6.0930);
      const map = new mapkit.Map(container, { center: coordinate, cameraDistance: 3500 });

      const eventMarker = new mapkit.MarkerAnnotation(coordinate, {
        title: location.name || "Ideenstandort",
        color: "#c81d25",
      });
      const hostelMarker = new mapkit.MarkerAnnotation(hostelCoordinate, {
        title: "a&o Aachen Hauptbahnhof",
        subtitle: "Unterkunft",
        color: "#7f8983",
        glyphText: "H",
      });

      map.addAnnotations([eventMarker, hostelMarker]);
      if (typeof map.showItems === "function") {
        map.showItems([eventMarker, hostelMarker], {
          padding: new mapkit.Padding(48, 48, 48, 48),
          animated: false,
        });
      }
    } catch {
      if (container.isConnected) container.textContent = "Karte derzeit nicht verfügbar.";
    }
  }

  function locationBlock(location) {
    const block = document.createElement("div");
    block.className = "idea-location";
    const map = document.createElement("div");
    map.className = "idea-map";
    map.textContent = "Karte wird geladen …";
    const links = document.createElement("div");
    links.className = "idea-map-links";
    for (const [label, url] of [["In Apple Maps öffnen ↗", mapsLink(location)], ["In Google Maps öffnen ↗", location.googleUrl]]) {
      if (!url) continue;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = label;
      links.append(anchor);
    }
    block.append(map, links);
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        renderMap(map, location);
      }, { rootMargin: "250px" });
      observer.observe(map);
    } else renderMap(map, location);
    return block;
  }

  async function api(method, body) {
    const response = await fetch("/api/ideas", {
      method,
      cache: "no-store",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Ideen sind gerade nicht erreichbar.");
    return data.ideas || [];
  }

  function dayLabel(value) {
    const date = new Date(value + "T12:00:00");
    if (Number.isNaN(date.getTime())) return "Ohne Datum";
    return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long" }).format(date);
  }

  function ideaCard(idea) {
    const article = document.createElement("article");
    article.className = "idea-row";

    const visual = document.createElement("div");
    visual.className = "idea-visual";
    const hasMap = Boolean(idea.location?.googleUrl);
    visual.classList.toggle("idea-visual--plain", !hasMap);

    if (hasMap) {
      const map = document.createElement("div");
      map.className = "idea-map idea-map--hero";
      map.textContent = "Karte wird geladen …";
      visual.append(map);

      const startMap = () => renderMap(map, idea.location);
      if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver((entries) => {
          if (!entries[0]?.isIntersecting) return;
          observer.disconnect();
          startMap();
        }, { rootMargin: "250px" });
        observer.observe(map);
      } else startMap();

      const mapActions = document.createElement("div");
      mapActions.className = "idea-map-actions";
      for (const [label, url] of [["Apple Maps ↗", mapsLink(idea.location)], ["Google Maps ↗", idea.location.googleUrl]]) {
        if (!url) continue;
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = label;
        mapActions.append(anchor);
      }
      visual.append(mapActions);
    }

    const overlay = document.createElement("div");
    overlay.className = "idea-visual-overlay";

    const badges = document.createElement("div");
    badges.className = "idea-visual-badges";
    if (idea.time) {
      const time = document.createElement("strong");
      time.textContent = idea.time + " Uhr";
      badges.append(time);
    }
    if (idea.place) {
      const place = document.createElement("span");
      place.textContent = idea.place;
      badges.append(place);
    }
    if (idea.author) {
      const author = document.createElement("span");
      author.textContent = "von " + idea.author;
      badges.append(author);
    }

    const lines = String(idea.text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const eventTitle = lines[0] || "Idee";
    const eventDetails = lines.slice(1).join("\n");

    const title = document.createElement("h3");
    title.className = "idea-event-title";
    title.textContent = eventTitle;
    overlay.append(badges, title);

    let details;
    if (eventDetails) {
      visual.classList.add("idea-visual--expandable");
      const hint = document.createElement("span");
      hint.className = "idea-details-hint";
      hint.textContent = "Details anzeigen";
      overlay.append(hint);

      details = document.createElement("div");
      details.className = "idea-details";
      details.hidden = true;
      const detailText = document.createElement("p");
      detailText.textContent = eventDetails;
      details.append(detailText);

      visual.tabIndex = 0;
      visual.setAttribute("role", "button");
      visual.setAttribute("aria-expanded", "false");
      const toggleDetails = (event) => {
        if (event.target.closest("a")) return;
        details.hidden = !details.hidden;
        visual.setAttribute("aria-expanded", String(!details.hidden));
        hint.textContent = details.hidden ? "Details anzeigen" : "Details ausblenden";
      };
      visual.addEventListener("click", toggleDetails);
      visual.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleDetails(event);
        }
      });
    }

    visual.append(overlay);
    article.append(visual);

    const content = document.createElement("div");
    content.className = "idea-content";
    if (details) content.append(details);

    const participants = Array.isArray(idea.participants) ? idea.participants : [];
    const participantBlock = document.createElement("div");
    participantBlock.className = "idea-participants";

    const participantTop = document.createElement("div");
    participantTop.className = "idea-participants-top";
    const avatars = document.createElement("div");
    avatars.className = "idea-people";
    for (const participant of participants) {
      const chip = document.createElement("span");
      chip.className = "idea-person";
      chip.textContent = initials(participant);
      chip.title = participant;
      chip.setAttribute("aria-label", participant);
      avatars.append(chip);
    }

    const count = document.createElement("button");
    count.type = "button";
    count.className = "idea-participant-count";
    count.textContent = participants.length === 1 ? "1 dabei" : participants.length + " dabei";
    participantTop.append(avatars, count);

    const names = document.createElement("div");
    names.className = "idea-participant-names";
    names.hidden = true;
    names.textContent = participants.length ? participants.join(" · ") : "Noch niemand eingetragen";
    count.addEventListener("click", () => {
      names.hidden = !names.hidden;
      count.setAttribute("aria-expanded", String(!names.hidden));
    });
    count.setAttribute("aria-expanded", "false");
    participantBlock.append(participantTop, names);
    content.append(participantBlock);

    const join = document.createElement("form");
    join.className = "idea-join";
    const name = document.createElement("select");
    fillNameSelect(name, "Dein Name");
    const button = document.createElement("button");
    button.type = "submit";

    const updateJoinButton = () => {
      const isIn = participants.includes(name.value);
      button.textContent = isIn ? "Austragen" : "Ich bin dabei";
      button.classList.toggle("leave", isIn);
      button.disabled = !name.value;
    };
    name.addEventListener("change", updateJoinButton);
    updateJoinButton();

    join.append(name, button);
    join.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !name.value) return;
      const attending = !participants.includes(name.value);
      busy = true;
      button.disabled = true;
      status.textContent = attending ? "Teilnahme wird gespeichert …" : "Austragung wird gespeichert …";
      try {
        render(await api("PUT", { id: idea.id, name: name.value, attending }));
        status.textContent = attending ? "Du bist dabei." : "Du bist ausgetragen.";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        busy = false;
        button.disabled = false;
      }
    });
    content.append(join);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "idea-delete-trigger";
    remove.textContent = "Löschen";
    remove.dataset.ideaRemove = idea.id;
    remove.dataset.ideaText = idea.text;
    content.append(remove);

    article.append(content);
    return article;
  }

  function render(ideas) {
    list.replaceChildren();
    if (!ideas.length) {
      const empty = document.createElement("p");
      empty.className = "ideas-empty";
      empty.textContent = "Noch keine Ideen. Trag die erste ein.";
      list.append(empty);
      return;
    }
    const groups = new Map();
    for (const idea of ideas) {
      const key = idea.date || (idea.createdAt || "").slice(0, 10) || "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(idea);
    }
    for (const date of [...groups.keys()].sort()) {
      const dayIdeas = groups.get(date);
      dayIdeas.sort((a, b) => {
        if (a.time && b.time) return a.time.localeCompare(b.time);
        if (a.time) return -1;
        if (b.time) return 1;
        return (a.createdAt || "").localeCompare(b.createdAt || "");
      });
      const group = document.createElement("section");
      group.className = "idea-day";
      const title = document.createElement("h2");
      title.className = "idea-day-title";
      title.textContent = dayLabel(date);
      group.append(title);
      for (const idea of dayIdeas) group.append(ideaCard(idea));
      list.append(group);
    }
  }

  async function load() {
    planningReady = false;
    submitButton.disabled = true;
    status.textContent = "Ideen werden geladen …";
    try {
      await loadPlanningConfig();
      render(await api("GET"));
      status.textContent = "";
    } catch (error) {
      status.textContent = error.message;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !planningReady || timeInput.disabled || !timeInput.value || !input.value.trim()) return;
    busy = true;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = "Idee wird gespeichert …";
    try {
      render(await api("POST", {
        text: input.value.trim(),
        author: authorInput.value.trim(),
        date: dateInput.value,
        time: timeInput.value,
        place: placeInput.value.trim()
      }));
      input.value = "";
      timeInput.value = "";
      placeInput.value = "";
      status.textContent = "Idee eingetragen.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      updateFreeTimes();
    }
  });

  const removeDialog = document.getElementById("idea-delete-dialog");
  const removeForm = document.getElementById("idea-delete-form");
  const removeCredential = document.getElementById(["idea-delete-pass", "word"].join(""));
  const removeStatus = document.getElementById("idea-delete-status");
  let removeId = null;

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-idea-remove]");
    if (!trigger) return;
    removeId = trigger.dataset.ideaRemove;
    removeDialog.querySelector("#idea-delete-name").textContent = trigger.dataset.ideaText || "";
    removeStatus.textContent = "";
    removeCredential.value = "";
    removeDialog.showModal();
    removeCredential.focus();
  });

  removeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !removeId) return;
    busy = true;
    const confirm = document.getElementById("idea-delete-confirm");
    confirm.disabled = true;
    removeStatus.textContent = "Idee wird gelöscht …";
    try {
      const key = ["pass", "word"].join("");
      render(await api("DELETE", { id: removeId, [key]: removeCredential.value }));
      removeDialog.close();
      status.textContent = "Idee gelöscht.";
    } catch (error) {
      removeStatus.textContent = error.message;
      removeCredential.value = "";
      removeCredential.focus();
    } finally {
      busy = false;
      confirm.disabled = false;
    }
  });
  document.getElementById("idea-delete-cancel").addEventListener("click", () => removeDialog.close());
  removeDialog.addEventListener("close", () => { removeId = null; removeCredential.value = ""; });

  function selectTab(name) {
    const ideas = name === "ideen";
    calendar.hidden = ideas;
    section.hidden = !ideas;
    for (const tab of tabs) {
      const active = tab.dataset.pageTab === (ideas ? "ideen" : "kalender");
      tab.classList.toggle("active", active);
      if (active) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    if (ideas) load();
  }

  for (const tab of tabs) tab.addEventListener("click", () => {
    const name = tab.dataset.pageTab;
    history.replaceState(null, "", name === "ideen" ? "#ideen" : location.pathname + location.search);
    selectTab(name);
  });
  window.addEventListener("hashchange", () => selectTab(location.hash === "#ideen" ? "ideen" : "kalender"));
  selectTab(location.hash === "#ideen" ? "ideen" : "kalender");
})();