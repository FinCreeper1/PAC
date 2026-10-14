(() => {
  const summary = document.getElementById("today-summary");
  if (!summary) return;

  function updateCopy() {
    const heading = summary.querySelector("h2");
    if (heading?.textContent === "Die nächste Profilreise") {
      heading.textContent = "Nächstes Event";
    }
  }

  new MutationObserver(updateCopy).observe(summary, {
    childList: true,
    subtree: true,
  });
  updateCopy();
})();
