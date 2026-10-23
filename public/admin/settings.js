"use strict";
// Settings are saved independently, preserving any unsaved calendar draft.
let mapSettingsRevision;
async function loadMapSettings() {
  const status = $("#map-settings-status");
  $("#map-settings-fields").disabled = true;
  try {
    const response = await adminFetch("/api/admin/settings", {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    const fields = $("#map-settings-form").elements;
    for (const [key, value] of Object.entries({
      TRIP_TITLE: "title",
      TRIP_START: "startDate",
      TRIP_END: "endDate",
      TRIP_ORIGIN: "origin",
      TRIP_DESTINATION: "destination",
      TRIP_TIMEZONE: "timeZone",
    }))
      fields[key].value = data.trip[value] || "";
    window.ParticipantEditor.set(data.trip.participants || []);
    fields.TRIP_DAY_START.value = data.dayHours.start;
    fields.TRIP_DAY_END.value = data.dayHours.end;
    loadConfigurationSettings();
    csrf = data.csrf;
    mapSettingsRevision = data.revision;
    $("#map-settings-form").elements.mapProvider.value = data.mapProvider;
    status.textContent = data.appleMapsConfigured
      ? "Der Kartenanbieter gilt für Reiseplan und Verwaltung. Apple MapKit und OpenStreetMap sind verfügbar."
      : "Der Kartenanbieter gilt für Reiseplan und Verwaltung. Für Apple MapKit muss APPLE_MAPS_TOKEN im eigenen Worker hinterlegt sein.";
    $("#map-settings-fields").disabled = false;
    renderUpdateState(data.version);
    $("#revoke-sessions").disabled = data.version === "demo";
    $("#sessions-status").textContent =
      data.version === "demo"
        ? "In der Demo werden keine echten Sitzungen verwaltet."
        : "";
  } catch (error) {
    status.textContent = error.message;
  }
}

// Updates run through the installer, which signs in to Cloudflare and replaces only this worker's code.
const installerUrl = "https://pac-install.linusleupold.workers.dev";
async function renderUpdateState(installed) {
  const card = $(".update-card"),
    status = $("#pac-update-status"),
    link = $("#pac-update");
  const host = location.hostname.match(
    /^(pac-[a-z0-9]+(?:-[a-z0-9]+)*)\.[a-z0-9-]+\.workers\.dev$/,
  );
  link.href =
    installerUrl +
    "/" +
    (host && host[1] !== "pac-install"
      ? "?update=" + encodeURIComponent(host[1])
      : "");
  $("#pac-version").textContent =
    installed === "demo" ? "Demo" : installed || "älter als Update-Funktion";
  card.classList.remove("available", "current");
  let latest = null,
    release = {};
  try {
    const response = await fetch(installerUrl + "/api/version", {
      cache: "no-store",
      credentials: "omit",
    });
    if (response.ok) {
      release = await response.json();
      latest = release.version;
    }
  } catch {}
  $("#pac-latest").textContent = latest || "nicht abrufbar";
  if (installed === "demo") {
    status.textContent = "Du verwendest die PAC-Demo.";
    link.textContent = "PAC aktualisieren";
    link.removeAttribute("href");
    link.setAttribute("role", "button");
    link.setAttribute("aria-disabled", "true");
    link.tabIndex = -1;
    $("#pac-release").hidden = true;
    card.querySelector(".settings-hint").textContent =
      "Updates sind in der Demo nicht verfügbar.";
    return;
  }
  // Release notes come from the installer as plain text and are only shown when an update is pending.
  const notes =
    typeof release.notes === "string" && latest && installed !== latest
      ? release.notes
      : "";
  $("#pac-release").hidden = !notes;
  $("#pac-release-title").textContent = "Neu in " + latest;
  $("#pac-release-notes").textContent = notes
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/^#+\s*/gm, "");
  const releaseLink = $("#pac-release-link");
  releaseLink.hidden = !(
    typeof release.releaseUrl === "string" &&
    release.releaseUrl.startsWith("https://github.com/FinCreeper1/PAC/")
  );
  if (!releaseLink.hidden) releaseLink.href = release.releaseUrl;
  if (latest && installed === latest) {
    card.classList.add("current");
    status.textContent = "Dein PAC ist auf dem neuesten Stand.";
    link.textContent = "Erneut installieren";
  } else {
    if (latest) card.classList.add("available");
    status.textContent = latest
      ? "Eine neue PAC-Version ist verfügbar."
      : "Die neueste Version konnte nicht geprüft werden. Ein Update ist trotzdem möglich.";
    link.textContent = "PAC aktualisieren";
  }
  if (!host)
    status.textContent +=
      " Bei eigener Domain wählst du dein PAC nach der Anmeldung aus der Liste.";
}
for (const name of ["calendar", "settings", "invoices"]) {
  $("#tab-" + name).addEventListener("click", () => {
    for (const panel of ["calendar", "settings", "invoices"]) {
      $("#" + panel + "-panel").hidden = panel !== name;
      $("#tab-" + panel).setAttribute("aria-pressed", String(panel === name));
    }
    if (name === "settings") loadMapSettings();
    if (name === "invoices") loadInvoices();
  });
}
$("#map-settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!window.ParticipantEditor.commit()) return;
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const provider = values.mapProvider;
  $("#map-settings-fields").disabled = true;
  $("#map-settings-status").textContent = "Wird gespeichert …";
  try {
    const response = await adminFetch("/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify({
        mapProvider: provider,
        trip: values,
        revision: mapSettingsRevision,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    mapSettingsRevision = data.revision;
    if (trip) Object.assign(trip, data.trip);
    window.PortalMaps?.setProvider(data.mapProvider);
    $("#map-settings-status").textContent =
      "Reiseeinstellungen gespeichert. Bitte die Seite vor weiteren Kalenderänderungen neu laden.";
  } catch (error) {
    $("#map-settings-status").textContent = error.message;
  } finally {
    $("#map-settings-fields").disabled = sessionExpired;
  }
});

let configurationRevision;
async function loadConfigurationSettings() {
  try {
    const response = await adminFetch("/api/admin/configuration", {
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    configurationRevision = data.revision;
    for (const [key, value] of Object.entries(data.values))
      $("#configuration-form").elements[key].value = value;
    $("#installation-domain").value = data.domain;
    $("#configuration-fields").disabled = !data.editable;
    $("#configuration-status").textContent = data.editable
      ? ""
      : "Zugangsdaten dieser Installation werden in Cloudflare Variables and Secrets verwaltet.";
  } catch (error) {
    $("#configuration-status").textContent = error.message;
  }
}
$("#configuration-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    ...Object.fromEntries(new FormData(event.currentTarget)),
    revision: configurationRevision,
  };
  $("#configuration-fields").disabled = true;
  $("#configuration-status").textContent = "Wolke wird geprüft …";
  try {
    const response = await adminFetch("/api/admin/configuration", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-csrf-token": csrf },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    if (data.reauthenticate) {
      location.assign("/admin");
      return;
    }
    configurationRevision = data.revision;
    for (const input of $("#configuration-form").querySelectorAll(
      "input[type=password]",
    ))
      input.value = "";
    $("#configuration-status").textContent = "Zugänge gespeichert.";
  } catch (error) {
    $("#configuration-status").textContent = error.message;
  } finally {
    $("#configuration-fields").disabled = sessionExpired;
  }
});

$("#revoke-sessions").addEventListener("click", async (event) => {
  if (
    !window.confirm(
      "Alle Teilnehmenden und die Reiseleitung auf allen Geräten abmelden? Auch du musst dich danach erneut anmelden.",
    )
  )
    return;
  const button = event.currentTarget,
    status = $("#sessions-status");
  button.disabled = true;
  status.textContent = "Geräte werden abgemeldet …";
  try {
    const response = await adminFetch("/api/admin/sessions/revoke", {
      method: "POST",
      headers: { "x-csrf-token": csrf },
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    location.assign("/__logout");
  } catch (error) {
    status.textContent = error.message;
    button.disabled = sessionExpired;
  }
});
