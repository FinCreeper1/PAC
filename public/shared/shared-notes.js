globalThis.SharedNotes = (() => {
  function createSection(item, createTextElement) {
    const section = createTextElement("section", "");
    section.className = "event-note shared-note";
    const title = createTextElement("strong", "Gemeinsame Notizen");
    const form = document.createElement("form");
    const textarea = document.createElement("textarea");
    textarea.placeholder = "Gemeinsame Notiz für diesen Termin …";
    textarea.maxLength = 10000;
    const controls = createTextElement("div", "");
    const status = createTextElement("span", "Wird geladen …");
    status.className = "note-status";
    const save = createTextElement("button", "Speichern");
    save.type = "submit";
    save.disabled = true;
    controls.append(status, save);
    form.append(textarea, controls);
    section.append(title, form);

    let baseText = "";
    let revision = 0;
    let dirty = false;
    let pollTimer;
    const draftKey = `profilreise-shared-note-draft:${item.id}`;

    const applyRemote = (data, preserveDraft = true) => {
      baseText = data.text || "";
      revision = Number(data.revision || 0);
      if (!dirty || !preserveDraft) {
        textarea.value = baseText;
        dirty = false;
        localStorage.removeItem(draftKey);
      }
      status.textContent = data.updatedAt
        ? `Stand ${new Date(data.updatedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
        : "Noch keine gemeinsame Notiz";
      save.disabled = false;
    };

    const load = async (silent = false) => {
      try {
        const response = await fetch(`/api/shared-note?event=${encodeURIComponent(item.id)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Laden fehlgeschlagen");
        const data = await response.json();
        if (dirty) {
          if (Number(data.revision || 0) !== revision) {
            status.textContent = "Neuere Version vorhanden · wird beim Speichern zusammengeführt";
          }
        } else {
          applyRemote(data);
          const draft = localStorage.getItem(draftKey);
          if (draft && draft !== baseText) {
            textarea.value = draft;
            dirty = true;
            status.textContent = "Lokaler Entwurf wiederhergestellt";
          }
        }
      } catch {
        if (!silent) status.textContent = "Gemeinsame Notiz derzeit nicht erreichbar";
      }
    };

    textarea.addEventListener("input", () => {
      dirty = textarea.value !== baseText;
      if (dirty) {
        localStorage.setItem(draftKey, textarea.value);
        status.textContent = "Ungespeicherte Änderungen";
      } else {
        localStorage.removeItem(draftKey);
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      status.textContent = "Wird gespeichert …";
      try {
        const response = await fetch("/api/shared-note", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            event: item.id,
            text: textarea.value,
            baseText,
            baseRevision: revision,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.status === 409 && data.conflict) {
          const loadRemote = window.confirm(
            "Die gemeinsame Notiz wurde an derselben Stelle gleichzeitig geändert.\n\nOK = aktuelle Version laden\nAbbrechen = deine Version behalten und manuell zusammenführen",
          );
          if (loadRemote) {
            applyRemote(data, false);
          } else {
            const localText = textarea.value;
            baseText = data.text || "";
            revision = Number(data.revision || 0);
            textarea.value = `${baseText}\n\n--- Deine Änderungen ---\n${localText}`;
            dirty = true;
            localStorage.setItem(draftKey, textarea.value);
            status.textContent = "Beide Fassungen stehen im Textfeld · bitte zusammenführen und erneut speichern";
          }
          return;
        }
        if (!response.ok) throw new Error(data.error || "Speichern fehlgeschlagen");
        textarea.value = data.text || "";
        baseText = textarea.value;
        revision = Number(data.revision || 0);
        dirty = false;
        localStorage.removeItem(draftKey);
        status.textContent = data.merged
          ? "Gespeichert · gleichzeitige Änderungen automatisch zusammengeführt"
          : "Gespeichert";
      } catch (error) {
        status.textContent = error.message || "Speichern fehlgeschlagen";
      } finally {
        save.disabled = false;
      }
    });

    load();
    pollTimer = setInterval(() => {
      if (section.isConnected && !document.hidden) load(true);
      else if (!section.isConnected) clearInterval(pollTimer);
    }, 20000);

    return section;
  }

  function install() {
    let requestedEventId = null;
    document.addEventListener(
      "click",
      (event) => {
        const trigger = event.target.closest?.("[data-event-id]");
        if (!trigger) return;
        requestedEventId = trigger.dataset.eventId || null;
        if (!requestedEventId) return;
        window.setTimeout(() => {
          const dialog = [...document.querySelectorAll("dialog[open]")].find((candidate) =>
            candidate.querySelector(".event-extras"),
          );
          const extras = dialog?.querySelector(".event-extras");
          if (!extras || extras.querySelector(".shared-note")) return;
          const officialTitle = extras.querySelector(".event-note:not(.shared-note) > strong");
          if (officialTitle) officialTitle.textContent = "Organisatorische Notiz";
          extras.append(createSection({ id: requestedEventId }, (tag, value) => {
            const element = document.createElement(tag);
            element.textContent = value;
            return element;
          }));
        }, 0);
      },
      true,
    );
  }

  return { createSection, install };
})();
SharedNotes.install();
