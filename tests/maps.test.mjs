import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('OSM tile requests identify the portal origin without disclosing private URLs', async () => {
 let options, url;
 const container = {isConnected:true,style:{position:'absolute'},replaceChildren(){}};
 const map = {};
 const leaflet = {
  map: target => {assert.equal(target.style.isolation,'isolate');assert.equal(target.style.zIndex,'0');return {setView: () => map};},
  tileLayer: (target, settings) => {url=target;options=settings;return {addTo: () => {}};},
  marker: () => ({bindPopup: () => ({addTo: () => ({})})}),
 };
 const context = {window: {L:leaflet}, document: {
  createElement: () => ({}),
  head: {append: element => {if(element.onload)element.onload();}},
 }};
 vm.runInNewContext(await readFile(new URL('../public/shared/openstreetmap.js',import.meta.url),'utf8'),context);
 await context.window.PortalMaps.render(container,[{latitude:53.55,longitude:9.99}]);
 assert.equal(container.style.position,'absolute');
 assert.equal(url,'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
 assert.equal(options.referrerPolicy,'origin');
 assert.match(options.attribution,/OpenStreetMap/);
});

test('a newly configured OSM trip searches places without requesting an Apple token', async () => {
 const calls=[];
 const context={window:{},fetch:async url=>{
  calls.push(url);
  if(url==='/data/trip.json')return {ok:true,json:async()=>({mapProvider:'openstreetmap'})};
  assert.equal(url,'/api/admin/place-search?q=K%C3%B6ln');
  return {ok:true,json:async()=>({places:[{name:'Köln'}]})};
 },$:()=>({})};
 vm.createContext(context);
 vm.runInContext(await readFile(new URL('../public/shared/openstreetmap.js',import.meta.url),'utf8'),context);
 context.PortalMaps=context.window.PortalMaps;
 vm.runInContext(await readFile(new URL('../public/admin/route-editor.js',import.meta.url),'utf8'),context);
 const places=await vm.runInContext("searchPlaces('Köln')",context);
 assert.equal(places[0].name,'Köln');
 assert.equal(calls.length,2);
});
