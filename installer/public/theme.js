(() => {
  function updatePageTop() {
    const root = document.documentElement;
    const wasTop = root.dataset.pageTop !== 'false';
    root.dataset.pageTop = String(window.scrollY <= (wasTop ? 32 : 8));
  }
  updatePageTop();
  window.addEventListener('scroll', updatePageTop, { passive: true });
  window.addEventListener('pageshow', updatePageTop);
  const key = 'profilreise-theme';
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { preference = localStorage.getItem(key); } catch { /* Storage may be unavailable. */ }
  if (preference !== 'light' && preference !== 'dark') preference = null;
  function apply() {
    const dark = preference ? preference === 'dark' : system.matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelectorAll('.theme-toggle').forEach((button) => {
      if (!button.querySelector('.theme-icon-moon')) button.innerHTML = '<svg class="theme-icon-moon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/></svg><svg class="theme-icon-sun" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>';
      button.setAttribute('aria-label', 'Dunkles Design');
      button.hidden = false;
      button.setAttribute('aria-pressed', String(dark));
      button.title = dark ? 'Zum hellen Design wechseln' : 'Zum dunklen Design wechseln';
    });
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#181b18' : '#fbfcfa');
  }
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('.home-header');
    if (header) {
      const wordmark = header.querySelector('.wordmark');
      const actions = header.querySelector('.header-actions');
      function fitWordmark() {
        if (!window.matchMedia('(max-width:760px)').matches) return;
        const probe = wordmark.cloneNode(true);
        probe.removeAttribute('href');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;font-size:24px;letter-spacing:-.04em;width:max-content';
        probe.querySelectorAll('.pac-expand').forEach(span => { span.style.maxWidth = 'none'; });
        probe.querySelector('.pac-a').style.textTransform = 'lowercase';
        header.append(probe);
        const naturalWidth = probe.getBoundingClientRect().width;
        probe.remove();
        const style = getComputedStyle(header);
        const available = header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - actions.getBoundingClientRect().width - parseFloat(style.columnGap);
        header.style.setProperty('--mobile-wordmark-size', Math.min(24, 24 * Math.max(0, available - 2) / naturalWidth) + 'px');
      }
      apply();
      fitWordmark();
      new ResizeObserver(fitWordmark).observe(header);
      window.addEventListener('resize', fitWordmark);
      document.fonts.ready.then(fitWordmark);
    }

    document.querySelectorAll('.theme-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(key, preference); } catch { /* Keep the choice for this page. */ }
        apply();
      });
    });
    apply();
  });
  system.addEventListener('change', apply);
  window.addEventListener('storage', (event) => {
    if (event.key !== key && event.key !== null) return;
    preference = event.newValue === 'dark' || event.newValue === 'light' ? event.newValue : null;
    apply();
  });
})();
