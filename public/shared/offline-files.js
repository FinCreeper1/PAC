(() => {
  const section = document.getElementById("offline-day-files");
  const title = document.getElementById("offline-day-title");
  const copy = document.getElementById("offline-day-copy");
  const action = document.getElementById("offline-day-action");
  if (!section || !title || !copy || !action || !("serviceWorker" in navigator)) return;

  const scope = document.getElementById("offline-save-scope");
  const scopeMenu = document.getElementById("offline-scope-menu");
  const scopeDay = document.getElementById("offline-scope-day");
  const scopeWeek = document.getElementById("offline-scope-week");
  const MANIFEST_KEY = "profilreise-offline-file-manifest-v1";
  const management = document.getElementById("offline-management");
  const managementDays = document.getElementById("offline-management-days");
  const managementStatus = document.getElementById("offline-management-status");
  const removeAll = document.getElementById("offline-remove-all");
  let manifestFiles = [];
  let manifestDays = [];
  let manifestUnavailable = false;
  let managing = false;
  let targetDay = null;
  let targetFiles = [];
  let statusRevision = 0;
  let manifestLoading = null;

  function berlinDate() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  function dayLabel(isoDate) {
    return new Intl.DateTimeFormat("de-DE", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(new Date(`${isoDate}T12:00:00Z`));
  }

  function fileSize(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  }

  function totalSize(files) {
    return files.reduce((sum, file) => sum + Number(file.size || 0), 0);
  }

  function chooseDay(manifest) {
    const today = berlinDate();
    const days = (manifest.days || [])
      .map((day) => day.isoDate)
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort();
    return days.find((date) => date >= today) || null;
  }

  function messageWorker(type, files, isoDate, onProgress) {
    return navigator.serviceWorker.ready.then((registration) =>
      new Promise((resolve, reject) => {
        const worker = registration.active;
        if (!worker) return reject(new Error("Offline-Speicherung ist noch nicht bereit."));
        const channel = new MessageChannel();
        const disconnected = () => {
          clearTimeout(timer);
          channel.port1.close();
          window.removeEventListener("offline", disconnected);
          reject(new Error("Verbindung unterbrochen. Bereits gespeicherte Dateien bleiben erhalten. Bitte online erneut versuchen."));
        };
        const timer = setTimeout(() => {
          window.removeEventListener("offline", disconnected);
          channel.port1.close();
          reject(new Error("Offline-Speicherung hat zu lange gedauert. Bitte erneut versuchen."));
        }, ["CACHE_DAY_FILES", "CACHE_EVENT_FILES"].includes(type) ? 1800000 : 15000);
        if (["CACHE_DAY_FILES", "CACHE_EVENT_FILES"].includes(type)) window.addEventListener("offline", disconnected, {once: true});
        channel.port1.onmessage = (event) => {
          if (event.data?.type === "CACHE_PROGRESS") {
            onProgress?.(event.data);
            return;
          }
          clearTimeout(timer);
          window.removeEventListener("offline", disconnected);
          channel.port1.close();
          if (event.data?.ok) resolve(event.data);
          else reject(new Error(event.data?.error || "Offline-Speicherung fehlgeschlagen."));
        };
        worker.postMessage({ type, files, isoDate }, [channel.port2]);
      }),
    );
  }

  function selectedFiles() {
    return scope?.value === "week"
      ? manifestFiles.filter((file) => manifestDays.includes(file.isoDate)) : targetFiles;
  }
  function selectedLabel() {
    return scope?.value === "week" ? "die gesamte Woche" : dayLabel(targetDay);
  }
  async function updateStatus() {
    const revision = ++statusRevision;
    if (!targetDay && scope?.value !== "week") { action.hidden = true; return; }
    const files = selectedFiles();
    title.textContent = `Unterlagen für ${selectedLabel()}`;
    if (files.length === 0) {
      copy.textContent = manifestUnavailable ? "Dateiliste derzeit nicht erreichbar. Gespeicherte Unterlagen lassen sich unten verwalten." : "Für diese Auswahl sind noch keine Dateien hinterlegt.";
      action.hidden = true;
      section.hidden = false;
      return;
    }
    action.hidden = false;
    const status = await messageWorker("STATUS_DAY_FILES", files, targetDay).catch(() => ({ cached: 0, total: files.length }));
    if (revision !== statusRevision) return;
    const bytes = totalSize(files);
    if (status.cached === status.total && status.total > 0) {
      copy.textContent = `✓ ${status.total} ${status.total === 1 ? "Datei" : "Dateien"} · ${fileSize(bytes)} offline verfügbar`;
      action.textContent = "Aktualisieren";
    } else if (status.cached > 0) {
      copy.textContent = `${status.cached} von ${status.total} Dateien offline · ${fileSize(bytes)} insgesamt`;
      action.textContent = "Vervollständigen";
    } else {
      copy.textContent = `${status.total} ${status.total === 1 ? "Datei" : "Dateien"} · ${fileSize(bytes)}`;
      action.textContent = "Offline speichern";
    }
    if (manifestUnavailable) copy.textContent += " · Gespeicherter Stand; Dateiliste derzeit nicht erreichbar.";
    section.hidden = false;
  }

  function loadManifest() {
    if (!window.portalCalendarReady) return Promise.resolve();
    if (!manifestLoading) {
      manifestLoading = readManifest().finally(() => { manifestLoading = null; });
    }
    return manifestLoading;
  }

  async function readManifest() {
    if (action.disabled || managing) return;
    let manifest = null;
    try {
      const response = await fetch("/api/offline-manifest", { cache: "no-store" });
      if (!response.ok) throw new Error();
      manifest = await response.json();
      if (!Array.isArray(manifest.days) || !Array.isArray(manifest.files)) throw new Error();
      manifestUnavailable = false;
      try { localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest)); } catch {}
    } catch {
      manifestUnavailable = true;
      try {
        manifest = JSON.parse(localStorage.getItem(MANIFEST_KEY) || "null");
      } catch {}
    }
    if (!manifest) {
      copy.textContent = navigator.onLine ? "Dateispeicher derzeit nicht erreichbar. Bereits offline gespeicherte Dateien sind weiterhin verfügbar." : "Offline. Bereits gespeicherte Reiseunterlagen lassen sich unten verwalten.";
      if (management?.open) await refreshManagement();
      return;
    }
    if (action.disabled || managing) return;
    manifestFiles = manifest.files || [];
    manifestDays = [...new Set((manifest.days || []).map((day) => day.isoDate)
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
    targetDay = chooseDay(manifest);
    if (scope) {
      scope.disabled = false;
      scopeDay.textContent = targetDay ? dayLabel(targetDay) : "Kein nächster Reisetag";
      scopeDay.disabled = !targetDay;
      if (!targetDay) scope.value = "week";
      syncScopeChoices();
    }
    targetFiles = (manifest.files || []).filter((file) => file.isoDate === targetDay);
    await updateStatus();
    if (management?.open) await refreshManagement();
    refreshEvents();
  }

  action.addEventListener("click", () => saveFiles(selectedFiles(), selectedLabel()));
  async function saveFiles(files, label, eventSave = false, report = () => {}) {
    let saved = false;
    if (managing || action.disabled || files.length === 0) {
      report("Bitte warten, bis der laufende Offline-Vorgang abgeschlossen ist.");
      return;
    }
    if (!navigator.onLine) {
      copy.textContent = "Zum Herunterladen bitte eine Internetverbindung herstellen.";
      report(copy.textContent);
      return;
    }
    const bytes = totalSize(files);
    const approved = window.confirm(
      `${files.length} ${files.length === 1 ? "Datei" : "Dateien"} für ${label} (${fileSize(bytes)}) jetzt auf diesem Gerät offline speichern?`,
    );
    if (!approved) return;
    ++statusRevision;
    closeScopeMenu();
    action.disabled = true;
    if (scope) scope.disabled = true;
    action.textContent = "Wird gespeichert …";
    copy.textContent = "Die Dateien werden nur auf diesem Gerät für die Offline-Nutzung gespeichert.";
    try {
      // Save each day with the existing worker action, preserving day ownership and
      // partial packages. Progress combines all selected days into one download.
      const dates = [...new Set(files.map((file) => file.isoDate))].sort();
      let completedBytes = 0, completedFiles = 0;
      for (const date of dates) {
        const dayFiles = files.filter((file) => file.isoDate === date);
        await messageWorker(eventSave ? "CACHE_EVENT_FILES" : "CACHE_DAY_FILES", dayFiles, date, (progress) => {
          const fileIndex = completedFiles + progress.fileIndex;
          if (progress.phase === "preparing") {
            action.textContent = "Wird vorbereitet …";
            copy.textContent = `${progress.file} · Datei ${fileIndex} von ${files.length} wird vom Server bereitgestellt.`;
            report(copy.textContent);
            return;
          }
          const loaded = completedBytes + progress.loaded;
          const percent = bytes > 0 ? Math.min(100, Math.round(loaded / bytes * 100)) : progress.percent;
          action.textContent = `${percent} %`;
          copy.textContent = `${progress.file} · Datei ${fileIndex} von ${files.length} · ${fileSize(loaded)} von ${fileSize(bytes)}`;
          report(copy.textContent);
        });
        completedBytes += totalSize(dayFiles);
        completedFiles += dayFiles.length;
      }
      saved = true;
      await updateStatus();
    } catch (error) {
      await updateStatus();
      copy.textContent = error.message || "Die Unterlagen konnten nicht vollständig gespeichert werden.";
      report(copy.textContent);
    } finally {
      action.disabled = false;
      if (scope) scope.disabled = false;
      await changed();
    }
    return saved;
  }

  async function refreshManagement() {
    if (!managementDays) return;
    try {
      const { days, orphanFiles = 0 } = await messageWorker("LIST_DAY_FILES", manifestFiles);
      managementDays.replaceChildren();
      removeAll.hidden = days.length === 0 && orphanFiles === 0;
      for (const day of days) {
        const row = document.createElement("div");
        row.className = "offline-management-row";
        const description = document.createElement("div");
        const date = document.createElement("strong");
        date.textContent = dayLabel(day.isoDate);
        const detail = document.createElement("p");
        const size = day.bytes ? `ca. ${fileSize(day.bytes)}${day.unknownSizes ? " + unbekannte Größen" : ""}` : "Größe unbekannt";
        detail.textContent = `${day.complete ? `${day.cached} ${day.cached === 1 ? "Datei" : "Dateien"}` : `${day.cached} von ${day.total} Dateien`} · ${size}${day.complete ? "" : " · teilweise"}`;
        description.append(date, detail);
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Löschen";
        button.setAttribute("aria-label", `Unterlagen für ${dayLabel(day.isoDate)} entfernen`);
        button.disabled = managing || action.disabled;
        button.addEventListener("click", () => remove("REMOVE_DAY_FILES", day.isoDate));
        row.append(description, button);
        managementDays.append(row);
      }
      if (orphanFiles) managementStatus.textContent = `${orphanFiles} weitere gespeicherte Dateien ohne Tageszuordnung. Über „Alle Reiseunterlagen entfernen“ löschbar.`;
      else if (!days.length) managementStatus.textContent = "Keine Reiseunterlagen offline gespeichert.";
      else if (!managing) managementStatus.textContent = "";
    } catch (error) { managementStatus.textContent = error.message; }
  }
  async function changed() {
    await refreshEventButtons();
    if (management?.open) await refreshManagement();
    // File dialogs listen for cache changes instead of keeping a stale offline badge.
    if (typeof CustomEvent !== "undefined") window.dispatchEvent(new CustomEvent("offline-files-changed"));
  }
  async function remove(type, isoDate) {
    if (managing || action.disabled) return;
    if (!window.confirm(type === "REMOVE_ALL_DAY_FILES" ? "Alle offline gespeicherten Reiseunterlagen auf diesem Gerät entfernen?" : `Unterlagen für ${dayLabel(isoDate)} auf diesem Gerät entfernen?`)) return;
    managing = true;
    removeAll.disabled = true;
    action.disabled = true;
    if (scope) scope.disabled = true;
    managementStatus.textContent = "Wird entfernt …";
    try {
      await messageWorker(type, manifestFiles, isoDate);
      await updateStatus();
      managementStatus.textContent = "Reiseunterlagen entfernt.";
    } catch (error) { managementStatus.textContent = error.message; }
    finally {
      managing = false;
      action.disabled = false;
      if (scope) scope.disabled = false;
      removeAll.disabled = false;
      await changed();
    }
  }
  // Small shared status interface for the existing event file dialog.
  let eventRefreshScheduled = false;
  function refreshEvents() {
    if (eventRefreshScheduled) return;
    eventRefreshScheduled = true;
    Promise.resolve().then(() => { eventRefreshScheduled = false; return refreshEventButtons(); }).catch(()=>{});
  }
  async function refreshEventButtons() {
    const buttons = [...(document.querySelectorAll?.("[data-offline-event]") || [])];
    if (!buttons.length || action.disabled || managing) return;
    const status = await messageWorker("STATUS_DAY_FILES", manifestFiles).catch(()=>({urls:[]}));
    const cached = new Set(status.urls || []);
    for (const button of buttons) {
      const files = manifestFiles.filter(file => file.event === button.dataset.offlineEvent);
      button.hidden = !files.length;
      button.parentElement?.classList.toggle("has-offline-files", files.length > 0);
      if (!files.length) continue;
      const count = files.filter(file => cached.has(file.url)).length;
      const complete = count === files.length;
      // Familiar single/double ticks communicate partial/complete device storage.
      button.dataset.offlineState = complete ? "complete" : count ? "partial" : "missing";
      button.textContent = "";
      button.innerHTML = count
        ? '<svg viewBox="0 0 28 20" aria-hidden="true"><path d="M2 10l5 5L19 3"/><path class="offline-second-tick" d="M13 13l2 2L27 3"/></svg>'
        : '<svg viewBox="0 0 28 20" aria-hidden="true"><path d="M14 2v11m-5-5 5 5 5-5M5 13v5h18v-5M3 2l22 17"/></svg>';
      button.dataset.saved = String(complete);
      const state = complete ? "Offline verfügbar" : count ? "Teilweise offline verfügbar" : "Nicht offline gespeichert";
      button.title = `${state}: ${button.dataset.eventTitle} (${count} von ${files.length} Dateien offline)`;
      button.setAttribute("aria-label", button.title);
    }
  }
  window.OfflineFiles = { status: (files) => messageWorker("STATUS_DAY_FILES", files),
    // Event saves merge with the day package, preserving documents of other events.
    saveEvent: (files, label, report) => saveFiles(files, label, true, report), refreshEvents, reloadManifest: loadManifest };
  function syncScopeChoices() {
    scopeDay?.setAttribute("aria-checked", String(scope.value === "day"));
    scopeWeek?.setAttribute("aria-checked", String(scope.value === "week"));
  }
  function closeScopeMenu(returnFocus = false) {
    if (!scopeMenu) return;
    scopeMenu.hidden = true;
    scope.setAttribute("aria-expanded", "false");
    if (returnFocus) scope.focus();
  }
  function openScopeMenu() {
    if (!scopeMenu || scope.disabled || action.disabled || managing) return;
    scopeMenu.hidden = false;
    scope.setAttribute("aria-expanded", "true");
    (scope.value === "day" && !scopeDay.disabled ? scopeDay : scopeWeek).focus();
  }
  async function chooseScope(value) {
    if (scope.disabled || action.disabled || managing || (value === "day" && scopeDay.disabled)) return;
    scope.value = value;
    syncScopeChoices();
    closeScopeMenu(true);
    await updateStatus();
  }
  // Menu navigation stays separate from downloading: only the left button starts a save.
  scope?.addEventListener("click", () => scopeMenu.hidden ? openScopeMenu() : closeScopeMenu());
  scope?.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); openScopeMenu(); }
  });
  scopeDay?.addEventListener("click", () => chooseScope("day"));
  scopeWeek?.addEventListener("click", () => chooseScope("week"));
  scopeMenu?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); closeScopeMenu(true); return; }
    if (event.key === "Tab") { closeScopeMenu(true); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const options = [scopeDay, scopeWeek].filter((option) => !option.disabled);
    const index = options.indexOf(document.activeElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
      : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next].focus();
  });
  document.addEventListener?.("click", (event) => {
    if (scopeMenu && !scopeMenu.hidden && !scopeMenu.contains(event.target) && !scope.contains(event.target)) closeScopeMenu();
  });
  management?.addEventListener("toggle", () => { if (management.open) refreshManagement(); });
  removeAll?.addEventListener("click", () => remove("REMOVE_ALL_DAY_FILES"));
  if (management) { management.hidden = false; section.hidden = false; action.hidden = true; }
  navigator.serviceWorker.addEventListener?.("controllerchange", loadManifest);
  window.addEventListener("online", loadManifest);
  function scheduleManifest() {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(loadManifest, { timeout: 1500 });
    } else if (window.requestAnimationFrame) {
      window.requestAnimationFrame(() => setTimeout(loadManifest, 0));
    } else {
      loadManifest();
    }
  }
  if (window.portalCalendarReady) scheduleManifest();
  else window.addEventListener("portal-calendar-ready", scheduleManifest, { once: true });
})();
