(() => {
  const section = document.getElementById("offline-day-files");
  const title = document.getElementById("offline-day-title");
  const copy = document.getElementById("offline-day-copy");
  const action = document.getElementById("offline-day-action");
  if (!section || !title || !copy || !action || !("serviceWorker" in navigator)) return;

  // Scope is a visible two-option switch; the stored choice lives on the group.
  const scope = document.getElementById("offline-scope");
  const progressTrack = document.getElementById("offline-progress");
  const progressBar = document.getElementById("offline-progress-bar");
  const scopeDay = document.getElementById("offline-scope-day");
  const scopeWeek = document.getElementById("offline-scope-week");
  const MANIFEST_KEY = "profilreise-offline-file-manifest-v1";
  const management = document.getElementById("offline-management");
  const managementSummary = document.getElementById("offline-management-summary");
  const managementDays = document.getElementById("offline-management-days");
  const managementStatus = document.getElementById("offline-management-status");
  const removeAll = document.getElementById("offline-remove-all");
  let manifestFiles = [];
  let manifestDays = [];
  let manifestUnavailable = false;
  let managing = false;
  let saving = false;
  let targetDay = null;
  let targetFiles = [];
  let statusRevision = 0;
  let manifestLoading = null;
  if (scope) scope.value = "day";

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

  function shortDayLabel(isoDate) {
    return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
      .format(new Date(`${isoDate}T12:00:00Z`));
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
    return scope?.value === "week" ? "die ganze Reise" : dayLabel(targetDay);
  }
  function count(n) { return `${n} ${n === 1 ? "Datei" : "Dateien"}`; }
  function setState(state) { section.dataset.state = state; }
  function setProgress(percent) {
    if (!progressTrack) return;
    progressTrack.hidden = percent == null;
    if (progressBar && percent != null) progressBar.style.width = `${percent}%`;
  }
  async function updateStatus() {
    const revision = ++statusRevision;
    if (!targetDay && scope?.value !== "week") { action.hidden = true; return; }
    const files = selectedFiles();
    title.textContent = "Unterlagen offline";
    syncScopeChoices();
    action.hidden = false;
    section.hidden = false;
    if (files.length === 0) {
      setState("empty");
      copy.textContent = manifestUnavailable ? "Dateiliste derzeit nicht erreichbar." : "Für diese Auswahl gibt es noch keine Dateien.";
      action.disabled = true;
      action.textContent = "Keine Dateien";
      return;
    }
    action.disabled = saving;
    const status = await messageWorker("STATUS_DAY_FILES", files, targetDay).catch(() => ({ cached: 0, total: files.length }));
    if (revision !== statusRevision) return;
    const size = fileSize(totalSize(files));
    if (status.cached === status.total && status.total > 0) {
      setState("complete");
      copy.textContent = `Offline verfügbar · ${count(status.total)} · ${size}`;
      action.textContent = "Aktualisieren";
    } else if (status.cached > 0) {
      setState("partial");
      copy.textContent = `${status.cached} von ${count(status.total)} gespeichert · ${size}`;
      action.textContent = "Vervollständigen";
    } else {
      setState("missing");
      copy.textContent = `${count(status.total)} · ${size}`;
      action.textContent = "Herunterladen";
    }
    if (manifestUnavailable) copy.textContent += " · letzter bekannter Stand";
  }

  function loadManifest() {
    if (!window.portalCalendarReady) return Promise.resolve();
    if (!manifestLoading) {
      manifestLoading = readManifest().finally(() => { manifestLoading = null; });
    }
    return manifestLoading;
  }

  async function readManifest() {
    if (saving || managing) return;
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
      if (management) await refreshManagement();
      return;
    }
    if (saving || managing) return;
    manifestFiles = manifest.files || [];
    manifestDays = [...new Set((manifest.days || []).map((day) => day.isoDate)
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
    targetDay = chooseDay(manifest);
    if (scope) {
      scope.disabled = false;
      scopeDay.textContent = targetDay ? shortDayLabel(targetDay) : "Kein Reisetag mehr";
      scopeDay.disabled = !targetDay;
      scopeDay.hidden = !targetDay;
      if (!targetDay) scope.value = "week";
      syncScopeChoices();
    }
    targetFiles = (manifest.files || []).filter((file) => file.isoDate === targetDay);
    await updateStatus();
    if (management) await refreshManagement();
    refreshEvents();
  }

  action.addEventListener("click", () => saveFiles(selectedFiles(), selectedLabel()));
  async function saveFiles(files, label, eventSave = false, report = () => {}) {
    let saved = false;
    if (managing || saving || files.length === 0) {
      report("Bitte warten, bis der laufende Offline-Vorgang abgeschlossen ist.");
      return;
    }
    if (!navigator.onLine) {
      copy.textContent = "Zum Herunterladen bitte eine Internetverbindung herstellen.";
      report(copy.textContent);
      return;
    }
    // Size and count are visible before the click, so saving starts without a dialog.
    const bytes = totalSize(files);
    ++statusRevision;
    saving = true;
    setState("saving");
    setProgress(0);
    action.disabled = true;
    if (scope) scope.disabled = true;
    action.textContent = "Wird geladen …";
    copy.textContent = `${count(files.length)} für ${label} werden auf diesem Gerät gespeichert …`;
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
          setProgress(percent);
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
      saving = false;
      setProgress(null);
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
      if (managementSummary) {
        const bytes = days.reduce((sum, day) => sum + Number(day.bytes || 0), 0);
        managementSummary.textContent = days.length
          ? `Auf diesem Gerät: ${days.length} ${days.length === 1 ? "Tag" : "Tage"} · ${fileSize(bytes)}`
          : "Noch nichts auf diesem Gerät gespeichert";
      }
      management.dataset.empty = String(days.length === 0 && orphanFiles === 0);
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
        button.textContent = "Entfernen";
        button.setAttribute("aria-label", `Unterlagen für ${dayLabel(day.isoDate)} entfernen`);
        button.disabled = managing || saving;
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
    if (management) await refreshManagement();
    // File dialogs listen for cache changes instead of keeping a stale offline badge.
    if (typeof CustomEvent !== "undefined") window.dispatchEvent(new CustomEvent("offline-files-changed"));
  }
  async function remove(type, isoDate) {
    if (managing || saving) return;
    if (!window.confirm(type === "REMOVE_ALL_DAY_FILES" ? "Alle offline gespeicherten Reiseunterlagen auf diesem Gerät entfernen?" : `Unterlagen für ${dayLabel(isoDate)} auf diesem Gerät entfernen?`)) return;
    managing = true;
    removeAll.disabled = true;
    saving = true;
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
      saving = false;
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
    if (!buttons.length || saving || managing) return;
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
    if (scopeDay) scopeDay.tabIndex = scope.value === "day" ? 0 : -1;
    if (scopeWeek) scopeWeek.tabIndex = scope.value === "week" ? 0 : -1;
  }
  async function chooseScope(value) {
    if (!scope || saving || managing || (value === "day" && scopeDay.disabled)) return;
    scope.value = value;
    syncScopeChoices();
    (value === "day" ? scopeDay : scopeWeek)?.focus?.();
    await updateStatus();
  }
  // Choosing a scope only previews size and status; only the action button downloads.
  scopeDay?.addEventListener("click", () => chooseScope("day"));
  scopeWeek?.addEventListener("click", () => chooseScope("week"));
  scope?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    chooseScope(scope.value === "day" ? "week" : "day");
  });
  management?.addEventListener("toggle", () => { if (management.open) refreshManagement(); });
  removeAll?.addEventListener("click", () => remove("REMOVE_ALL_DAY_FILES"));
  if (management) { management.hidden = false; section.hidden = false; action.hidden = true; }
  section.dataset.state = "loading";
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
