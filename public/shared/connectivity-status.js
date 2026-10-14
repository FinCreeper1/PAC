(() => {
  const bar = document.getElementById("connection-status-bar");
  const text = document.getElementById("connection-status-text");
  if (!bar || !text) return;

  let state = null;
  let hideTimer = null;
  let checking = false;

  function show(kind, message, autoHide = false) {
    clearTimeout(hideTimer);
    bar.classList.remove("is-offline", "is-online");
    bar.classList.add(kind === "offline" ? "is-offline" : "is-online", "is-visible");
    bar.hidden = false;
    text.textContent = message;
    if (autoHide) {
      hideTimer = setTimeout(() => {
        bar.classList.remove("is-visible");
        setTimeout(() => {
          if (!bar.classList.contains("is-visible")) bar.hidden = true;
        }, 220);
      }, 3000);
    }
  }

  function apply(online) {
    if (online) {
      if (state === false) show("online", "Wieder online", true);
      else if (state === null) {
        bar.hidden = true;
        bar.classList.remove("is-visible", "is-offline", "is-online");
      }
      state = true;
      return;
    }
    state = false;
    show(
      "offline",
      "Offline · nur offline gespeicherte Inhalte und Dateien sind verfügbar",
    );
  }

  async function checkConnection() {
    if (checking) return;
    if (!navigator.onLine) {
      apply(false);
      return;
    }
    checking = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(`/icon.svg?connectivity=${Date.now()}`, {
        cache: "no-store",
        credentials: "omit",
        signal: controller.signal,
      });
      apply(response.ok);
    } catch {
      apply(false);
    } finally {
      clearTimeout(timeout);
      checking = false;
    }
  }

  window.addEventListener("offline", () => apply(false));
  window.addEventListener("online", checkConnection);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkConnection();
  });

  checkConnection();
  setInterval(checkConnection, 20000);
})();
