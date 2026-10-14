(() => {
  const tabs = [...document.querySelectorAll("[data-page-tab]")];
  const calendar = document.getElementById("kalender");
  const section = document.getElementById("ideen");
  const form = document.getElementById("idea-form");
  const input = document.getElementById("idea-text");
  const list = document.getElementById("ideas-list");
  const status = document.getElementById("ideas-status");
  const deleteDialog = document.getElementById("idea-delete-dialog");
  const deleteForm = document.getElementById("idea-delete-form");
  const deletePassword = document.getElementById("idea-delete-password");
  const deleteStatus = document.getElementById("idea-delete-status");
  let deleteId = null;
  let loaded = false;
  let busy = false;

  function mapsLink(location) {
    const query = new URLSearchParams();
    if (location.name) query.set("q", location.name);
    if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude))
      query.set("ll", `${location.latitude},${location.longitude}`);
    return `https://maps.apple.com/?${query}`;
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
      if (!coordinate || !container.isConnected) throw new Error("Standort nicht gefunden.");
      container.replaceChildren();
      const map = new mapkit.Map(container, { center: coordinate, cameraDistance: 3500 });
      map.addAnnotation(new mapkit.MarkerAnnotation(coordinate, {
        title: location.name || "Ideenstandort", color: "#c81d25",
      }));
    } catch {
      if (container.isConnected) container.textContent = "Karte derzeit nicht verfügbar.";
    }
  }

  function locationBlock(location) {
    const block = document.createElement("div");
    block.className = "idea-location";
    const map = document.createElement("div");
    map.className = "idea-map";
    map.textContent = "Apple Maps wird geladen …";
    map.setAttribute("aria-label", `Karte: ${location.name || "Ideenstandort"}`);
    const links = document.createElement("div");
    links.className = "idea-map-links";
    for (const [label, url] of [["In Apple Maps öffnen ↗", mapsLink(location)], ["In Google Maps öffnen ↗", location.googleUrl]]) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = label;
      links.append(anchor);
    }
    block.append(map, links);
    if (!location.name && !Number.isFinite(location.latitude)) {
      map.textContent = "Standort aus diesem Google-Maps-Link nicht verfügbar. Bitte Link prüfen.";
    } else if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        renderMap(map, location);
      }, { rootMargin: "250px" });
      observer.observe(map);
    } else renderMap(map, location);
    return block;
  }

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
    if (ideas && !loaded) load();
  }

  async function api(method, body) {
    const response = await fetch("/api/ideas", {
      method,
      cache: "no-store",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Ideen sind gerade nicht erreichbar.");
    return data.ideas || [];
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
    for (const idea of ideas) {
      const article = document.createElement("article");
      article.className = "idea-row";
      const votes = document.createElement("div");
      votes.className = "idea-votes";
      const up = voteButton("▲", "Upvote", idea, 1);
      const score = document.createElement("span");
      score.textContent = String(idea.score);
      score.setAttribute("aria-label", `${idea.score} Stimmen`);
      const down = voteButton("▼", "Downvote", idea, -1);
      votes.append(up, score, down);
      const content = document.createElement("div");
      content.className = "idea-content";
      const text = document.createElement("p");
      text.textContent = idea.text;
      content.append(text);
      if (idea.location?.googleUrl) content.append(locationBlock(idea.location));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "idea-delete-trigger";
      remove.textContent = "Löschen";
      remove.setAttribute("aria-label", `Idee löschen: ${idea.text}`);
      remove.addEventListener("click", () => {
        deleteId = idea.id;
        deleteDialog.querySelector("#idea-delete-name").textContent = idea.text;
        deleteStatus.textContent = "";
        deletePassword.value = "";
        deleteDialog.showModal();
        deletePassword.focus();
      });
      content.append(remove);
      article.append(votes, content);
      list.append(article);
    }
  }

  function voteButton(symbol, label, idea, direction) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = symbol;
    button.setAttribute("aria-label", `${label} für: ${idea.text}`);
    button.setAttribute("aria-pressed", String(idea.vote === direction));
    button.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      status.textContent = "Stimme wird gespeichert …";
      try {
        render(await api("PUT", { id: idea.id, vote: idea.vote === direction ? 0 : direction }));
        status.textContent = "Stimme gespeichert.";
      } catch (error) { status.textContent = error.message; }
      finally { busy = false; }
    });
    return button;
  }

  async function load() {
    status.textContent = "Ideen werden geladen …";
    try {
      render(await api("GET"));
      loaded = true;
      status.textContent = "";
    } catch (error) { status.textContent = error.message; }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !input.value.trim()) return;
    busy = true;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.textContent = "Idee wird gespeichert …";
    try {
      render(await api("POST", { text: input.value.trim() }));
      input.value = "";
      status.textContent = "Idee eingetragen.";
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; submit.disabled = false; }
  });
  deleteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !deleteId) return;
    busy = true;
    const confirm = document.getElementById("idea-delete-confirm");
    confirm.disabled = true;
    deleteStatus.textContent = "Idee wird gelöscht …";
    try {
      render(await api("DELETE", { id: deleteId, password: deletePassword.value }));
      deleteDialog.close();
      status.textContent = "Idee gelöscht.";
    } catch (error) {
      deleteStatus.textContent = error.message;
      deletePassword.value = "";
      deletePassword.focus();
    } finally { busy = false; confirm.disabled = false; }
  });
  document.getElementById("idea-delete-cancel").addEventListener("click", () => deleteDialog.close());
  deleteDialog.addEventListener("close", () => { deleteId = null; deletePassword.value = ""; });
  for (const tab of tabs) tab.addEventListener("click", () => {
    const name = tab.dataset.pageTab;
    history.replaceState(null, "", name === "ideen" ? "#ideen" : location.pathname + location.search);
    selectTab(name);
  });
  window.addEventListener("hashchange", () => selectTab(location.hash === "#ideen" ? "ideen" : "kalender"));
  selectTab(location.hash === "#ideen" ? "ideen" : "kalender");
})();
