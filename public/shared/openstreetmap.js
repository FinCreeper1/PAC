/* Shared, token-free maps. Tiles are loaded only for the visible map. */
window.PortalMaps = (() => {
  let settings, leaflet;
  async function isOSM() {
    settings ??= fetch('/data/trip.json').then(r => { if (!r.ok) throw Error('Reisekonfiguration fehlt'); return r.json(); }).catch(error => { settings = null; throw error; });
    return (await settings).mapProvider === 'openstreetmap';
  }
  async function load() {
    leaflet ??= new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.append(css);
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => resolve(window.L); script.onerror = () => reject(Error('OpenStreetMap konnte nicht geladen werden.'));
      document.head.append(script);
    }).catch(error => { leaflet = null; throw error; });
    return leaflet;
  }
  async function render(container, points, geometry) {
    const L = await load();
    if (!container.isConnected) return;
    container._osmMap?.remove();
    container.replaceChildren();
    const map = L.map(container).setView([points[0].latitude, points[0].longitude], 14);
    container._osmMap = map;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    const layers = points.map(point => {
      const label = document.createElement('span'); label.textContent = point.name || 'Standort';
      return L.marker([point.latitude, point.longitude]).bindPopup(label).addTo(map);
    });
    if (geometry?.length > 1) layers.push(L.polyline(geometry, {color: '#c81d25', weight: 4}).addTo(map));
    if (layers.length > 1) map.fitBounds(L.featureGroup(layers).getBounds(), {padding: [32, 32]});
  }
  return {isOSM, render};
})();
