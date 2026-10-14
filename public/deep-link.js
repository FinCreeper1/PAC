(() => {
  const requestedEvent = new URLSearchParams(window.location.search).get("event");
  if (!requestedEvent) return;

  let opened = false;
  const openRequestedEvent = () => {
    if (opened) return true;
    const target = [...document.querySelectorAll("[data-event-id]")].find(
      (button) => button.dataset.eventId === requestedEvent,
    );
    if (!target) return false;
    opened = true;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.click();
    return true;
  };

  if (openRequestedEvent()) return;
  const observer = new MutationObserver(() => {
    if (openRequestedEvent()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 15000);
})();
