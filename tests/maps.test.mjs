import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('OSM tile requests identify the portal origin without disclosing private URLs', async () => {
 let options, url;
 const map = {};
 const leaflet = {
  map: () => ({setView: () => map}),
  tileLayer: (target, settings) => {url=target;options=settings;return {addTo: () => {}};},
  marker: () => ({bindPopup: () => ({addTo: () => ({})})}),
 };
 const context = {window: {L:leaflet}, document: {
  createElement: () => ({}),
  head: {append: element => {if(element.onload)element.onload();}},
 }};
 vm.runInNewContext(await readFile(new URL('../public/shared/openstreetmap.js',import.meta.url),'utf8'),context);
 await context.window.PortalMaps.render({isConnected:true,replaceChildren(){}},[{latitude:53.55,longitude:9.99}]);
 assert.equal(url,'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
 assert.equal(options.referrerPolicy,'origin');
 assert.match(options.attribution,/OpenStreetMap/);
});
