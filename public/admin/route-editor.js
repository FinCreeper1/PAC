"use strict";
// Apple Maps address search for the event and route stops.
let mapKitReady;
async function loadAdminMapKit() {
  if (!mapKitReady)
    mapKitReady = (async () => {
      const response = await fetch("/api/apple-maps-token");
      const data = await response.json();
      if (!response.ok)
        throw Error(data.error || "Apple Maps ist nicht verfügbar.");
      await new Promise((resolve, reject) => {
        window.adminMapKitLoaded = resolve;
        const script = document.createElement("script");
        script.src = "https://cdn.apple-mapkit.com/mk/6/mapkit.core.js";
        script.crossOrigin = "anonymous";
        script.dataset.callback = "adminMapKitLoaded";
        script.dataset.libraries = "services,map,annotations";
        script.dataset.token = data.token;
        script.onerror = () =>
          reject(Error("Apple Maps konnte nicht geladen werden."));
        document.head.append(script);
      });
    })().catch((error) => {
      mapKitReady = null;
      throw error;
    });
  await mapKitReady;
}
async function searchPlaces(query) {
  if (window.PortalMaps && await PortalMaps.isOSM()) {
    const response = await fetch(`/api/admin/place-search?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Die Ortssuche ist gerade nicht erreichbar.");
    return data.places;
  }
  await loadAdminMapKit();
  return new Promise((resolve, reject) =>
    new mapkit.Search({ language: "de" }).search(query, (error, data) =>
      error
        ? reject(
            Error(
              "Die Ortssuche ist gerade nicht erreichbar. Bitte prüfe die Internetverbindung und versuche es noch einmal.",
            ),
          )
        : resolve(data.places),
    ),
  );
}
$("#search-place").onclick = async () => {
  const id = selected,
    currentDraft = draft,
    query = form.elements.location.value.trim(),
    button = $("#search-place"),
    results = $("#search-results");
  if (!query) {
    results.textContent = "Gib zuerst einen Ortsnamen oder eine Adresse ein.";
    form.elements.location.focus();
    return;
  }
  button.disabled = true;
  results.textContent = "Suche läuft …";
  try {
    const places = await searchPlaces(query);
    if (id !== selected || draft !== currentDraft || form.elements.location.value.trim() !== query) return;
    results.replaceChildren();
    if (!places.length) results.textContent = "Keinen passenden Ort gefunden. Versuche es mit Straße, Hausnummer und Stadt.";
    for (const place of places.slice(0, 6)) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = place.formattedAddress || place.name;
      b.onclick = () => {
        if (draft !== currentDraft) return;
        form.elements.location.value = place.formattedAddress || place.name;
        form.elements.latitude.value = place.coordinate.latitude;
        form.elements.longitude.value = place.coordinate.longitude;
        editing = true;
        updateSaveState();
        mapLink();
        results.textContent = "Ort ausgewählt. Du kannst den Termin jetzt speichern.";
        advanceEditorTo("#editor-extras-heading");
      };
      results.append(b);
    }
  } catch (error) {
    if (draft === currentDraft) results.textContent = error.message;
  } finally {
    button.disabled = false;
  }
};

// Reuse one map; stale loads must never restore a previous event's location.
let placePreviewMap, placePreviewKey = "", placePreviewRequest = 0;
window.updateAdminPlacePreview = async () => {
  const container = $("#place-preview"), status = $("#place-preview-status");
  const latitude = Number(form.elements.latitude.value), longitude = Number(form.elements.longitude.value);
  const valid = form.elements.latitude.value !== "" && form.elements.longitude.value !== "" &&
    Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
  const title = form.elements.location.value;
  const key = valid ? JSON.stringify([latitude, longitude, title]) : "";
  if (key === placePreviewKey) return;
  placePreviewKey = key;
  const request = ++placePreviewRequest;
  container.hidden = !valid;
  status.hidden = !valid;
  if (!valid) return;
  status.textContent = "Karte wird geladen …";
  try {
    if (window.PortalMaps && await PortalMaps.isOSM()) {
      if (request !== placePreviewRequest) return;
      await PortalMaps.render(container, [{latitude, longitude, name: title}]);
      if (request === placePreviewRequest) status.hidden = true;
      return;
    }
    await loadAdminMapKit();
    if (request !== placePreviewRequest) return;
    const coordinate = new mapkit.Coordinate(latitude, longitude);
    placePreviewMap ??= new mapkit.Map(container, {
      center: coordinate, cameraDistance: 1800,
      showsCompass: mapkit.FeatureVisibility.Hidden,
    });
    placePreviewMap.removeAnnotations(placePreviewMap.annotations);
    placePreviewMap.addAnnotation(new mapkit.MarkerAnnotation(coordinate, { title }));
    placePreviewMap.center = coordinate;
    placePreviewMap.cameraDistance = 1800;
    status.hidden = true;
  } catch {
    if (request !== placePreviewRequest) return;
    container.hidden = true;
    status.textContent = "Die Kartenvorschau ist gerade nicht verfügbar. Du kannst den Ort über den Kartenlink prüfen.";
    placePreviewKey = "";
  }
};
