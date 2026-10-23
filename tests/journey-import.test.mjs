import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linkSearch, textSearch, textJourney, prepareSearch, searchInstant, parseItinerary, importJourney as rawImportJourney, SearchDetailsRequired, transitousClient, reserveTransitousSearch} from '../src/journey-import.js';
const config={TRANSITOUS_USAGE_CONFIRMED:'true',TRANSITOUS_CONTACT:'https://contact.example.org'};
const importJourney=(value,fetcher,search,timeZone)=>rawImportJourney(value,fetcher,search,timeZone,config);
const short='https://www.bahn.de/buchung/start?vbid=d88803ad-f665-4c22-89a3-1d9762c83654';
const search={origin:'Hamburg-Altona',destination:'Aachen Hbf',date:'2026-10-17',time:'08:00'};
const leg=(from,to,start,end)=>({mode:'HIGHSPEED_RAIL',displayName:'ICE 107',tripId:'transitous-trip',scheduledStartTime:`2026-10-17T${start}:00Z`,scheduledEndTime:`2026-10-17T${end}:00Z`,
 from:{name:from,lat:53.552696,lon:9.935175,scheduledTrack:'4',stopId:'provider:stop-not-eva'},to:{name:to,scheduledTrack:'6'}});
const fixture=()=>({legs:[leg('Hamburg-Altona','Köln Hbf','06:25','10:47'),{mode:'WALK'},leg('Köln Hbf','Aachen Hbf','11:14','12:06')]});
function mockTransitous() {
 const calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url:new URL(url),options});
  if(url.includes('/geocode?')) {
   const name=new URL(url).searchParams.get('text');
   return Response.json([{type:'STOP',id:'stop:'+name,name}]);
  }
  return Response.json({itineraries:[fixture()]});
 };
 return {calls,fetcher};
}
test('extracts routing data from long Bahn links including fragment links',()=>{
 const params='so=Hamburg-Altona&zo=Aachen+Hbf&hd=2026-10-17T08%3A00%3A00';
 assert.deepEqual(linkSearch('https://www.bahn.de/buchung/start#?'+params),search);
 assert.equal(linkSearch(short).origin,'');
 assert.equal(linkSearch('https://www.bahn.de/?date=17.10.2026').date,'2026-10-17');
 for(const url of ['https://evil.example/','http://www.bahn.de/','https://user@www.bahn.de/']) assert.throws(()=>linkSearch(url));
});
test('short Bahn IDs require routing details and make no DB or Transitous calls',async()=>{
 let calls=0;
 await assert.rejects(importJourney(short,async()=>{calls++;}),SearchDetailsRequired);
 assert.equal(calls,0);
});
test('uses timezone-aware departure instants and rejects invalid dates/DST gaps',()=>{
 assert.equal(searchInstant('2026-10-17','08:00','Europe/Berlin'),'2026-10-17T06:00:00.000Z');
 assert.equal(searchInstant('2026-01-17','08:00','Europe/Berlin'),'2026-01-17T07:00:00.000Z');
 assert.throws(()=>searchInstant('2026-02-30','08:00','Europe/Berlin'));
 assert.throws(()=>searchInstant('2026-03-29','02:30','Europe/Berlin'));
});
test('imports planned rail times, coordinates and tracks without using Transitous IDs as EVA',()=>{
 const data=fixture();data.legs[0].startTime='2026-10-17T06:35:00Z';
 const result=parseItinerary(data);
 assert.equal(result.legs.length,2);assert.equal(result.startTime,'08:25');assert.equal(result.endTime,'14:06');
 assert.equal(result.legs[0].platform,'Gleis 4');assert.equal(result.latitude,53.552696);
 assert.equal(result.legs[0].station,'');assert.equal(result.legs[0].number,'');assert.equal(result.source,'transitous');
});
test('accepts overnight dates and rejects overlapping, cancelled and non-rail journeys',()=>{
 const overnight=fixture();overnight.legs[2].scheduledEndTime='2026-10-18T01:00:00Z';const night=parseItinerary(overnight);assert.equal(night.endDate,'2026-10-18');assert.equal(night.legs.at(-1).arrivalDate,'2026-10-18');assert.equal(night.legs[0].departureDate,'2026-10-17');
 const overlap=fixture();overlap.legs[2].scheduledStartTime='2026-10-17T10:00:00Z';assert.throws(()=>parseItinerary(overlap),/Fahrzeiten/);
 const cancelled=fixture();cancelled.legs[0].cancelled=true;assert.throws(()=>parseItinerary(cancelled));
 assert.throws(()=>parseItinerary({legs:[{mode:'BUS'}]}));
});
test('uses only Transitous, identifies the client and returns choices for explicit selection',async()=>{
 const {calls,fetcher}=mockTransitous();
 const data=await importJourney(short,fetcher,search);
 assert.equal(data.choices.length,1);assert.equal(calls.length,3);
 assert.ok(calls.every(c=>c.url.origin==='https://api.transitous.org' && c.options.redirect==='manual' && c.options.headers['User-Agent'].includes('PAC/1.0 (https://contact.example.org)')));
 const plan=calls[2].url;
 assert.equal(plan.pathname,'/api/v6/plan');assert.equal(plan.searchParams.get('time'),'2026-10-17T06:00:00.000Z');
 assert.equal(plan.searchParams.get('transitModes'),'RAIL');assert.equal(plan.searchParams.get('maxItineraries'),'3');
});
test('long links work without manually entered search data',async()=>{
 const {fetcher}=mockTransitous();
 const result=await importJourney('https://www.bahn.de/?so=Hamburg-Altona&zo=Aachen+Hbf&hd=2026-10-17T08:00:00',fetcher);
 assert.equal(result.choices[0].startTime,'08:25');
});
test('ambiguous stations are not silently substituted',async()=>{
 await assert.rejects(importJourney('',async()=>Response.json([{type:'STOP',id:'wrong',name:'Other station'}]),search),/zuordnen/);
});
test('redirects, limits and missing timetable data produce actionable errors',async()=>{
 await assert.rejects(importJourney('',async()=>new Response(null,{status:302,headers:{location:'https://evil.example'}}),search),/nicht erreichbar/);
 await assert.rejects(importJourney('',async()=>new Response('',{status:429}),search),/ausgelastet/);
 const {fetcher}=mockTransitous();
 await assert.rejects(importJourney('',async(url,options)=>url.includes('/plan?')?Response.json({itineraries:[]}):fetcher(url,options),search),/keine Zugverbindung/);
});

test('requires explicit policy confirmation and a real operator contact before any request',async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;throw Error('unexpected network call');};
 for(const settings of [{},{...config,TRANSITOUS_USAGE_CONFIRMED:'false'},{...config,TRANSITOUS_CONTACT:''},{...config,TRANSITOUS_CONTACT:'https://example.org/\r\nInjected: yes'},{...config,TRANSITOUS_CONTACT:'http://example.org'},{...config,TRANSITOUS_CONTACT:'https://user:pass@example.org'}]) {
  await assert.rejects(rawImportJourney('',fetcher,search,'Europe/Berlin',settings));
 }
 assert.equal(calls,0);
 assert.equal(transitousClient(config),'PAC/1.0 (https://contact.example.org)');
 assert.match(transitousClient({...config,TRANSITOUS_CONTACT:'operator@example.org'}),/operator@example.org/);
});
test('search budget is shared across sessions and persists across limiter calls',async()=>{
 const rows=new Map();
 const storage={get:async key=>rows.get(key),put:async(key,value)=>rows.set(key,value)};
 await assert.rejects(reserveTransitousSearch(storage,{},1000));
 assert.equal(rows.size,0);
 await reserveTransitousSearch(storage,config,1000);
 await assert.rejects(reserveTransitousSearch(storage,config,2000),error=>error.status===429);
 await assert.rejects(reserveTransitousSearch(storage,config,60999),error=>error.status===429);
 await reserveTransitousSearch(storage,config,61000);
 assert.equal(rows.get('transitous:next-search:v1'),121000);
});

test('extracts stations, date, departure and trains from pasted share texts',()=>{
 assert.deepEqual(textSearch('Meine Verbindung\nHamburg-Altona → Aachen Hbf\nSa., 17.10.2026, 08:25 – 12:06\nICE 107, RE 1\n'+short),
  {origin:'Hamburg-Altona',destination:'Aachen Hbf',date:'2026-10-17',time:'08:25',services:['ICE 107','RE 1']});
 const mail=textSearch('Hinfahrt am 17. Oktober 2026\nab Hamburg Hbf 08:12 Gleis 7 ICE 517\nan Köln Hbf 12:10\nab Köln Hbf 12:30\nan Aachen Hbf 13:05');
 assert.deepEqual([mail.origin,mail.destination,mail.date,mail.time],['Hamburg Hbf','Aachen Hbf','2026-10-17','08:12']);
 const share=textSearch('Verbindung am Mo. 26.10.2026\n• von Hamburg-Altona, Abfahrt 11:26 Uhr Gl. 9 mit ICE 611\n• nach Aachen Hbf, Ankunft 16:51 Uhr Gl. 1 mit 26854\nVerbindung ansehen: https://www.bahn.de/buchung/start?vbid=1dcb863d');
 assert.deepEqual(share,{origin:'Hamburg-Altona',destination:'Aachen Hbf',date:'2026-10-26',time:'11:26',services:['ICE 611']});
 const route=textSearch('von Frankfurt am Main Hbf nach München Hbf am 2026-11-02 um 7:30');
 assert.deepEqual([route.origin,route.destination,route.date,route.time],['Frankfurt am Main Hbf','München Hbf','2026-11-02','07:30']);
});
test('missing details are reported with what was recognised, before any network call',()=>{
 assert.throws(()=>prepareSearch(short),error=>error instanceof SearchDetailsRequired&&error.detected.shortLink&&/Start, Ziel/.test(error.message));
 assert.throws(()=>prepareSearch('Hamburg-Altona → Aachen Hbf'),error=>error.detected.origin==='Hamburg-Altona'&&/Reisetag, Abfahrt/.test(error.message));
 assert.equal(prepareSearch('Hamburg-Altona → Aachen Hbf',{date:'2026-10-17',time:'08:00'}).instant,'2026-10-17T06:00:00.000Z');
 assert.throws(()=>prepareSearch('https://evil.example/'));
});
test('pasted text alone finds and recommends the exact matching connection',async()=>{
 const {fetcher}=mockTransitous();
 const result=await importJourney('Hamburg-Altona → Aachen Hbf\n17.10.2026 08:25\nICE 107',fetcher);
 assert.equal(result.recommended,0);assert.equal(result.detected.origin,'Hamburg-Altona');
 const loose=await importJourney('Hamburg-Altona → Aachen Hbf 17.10.2026 08:00',mockTransitous().fetcher);
 assert.equal(loose.recommended,null);
});

test('share texts become a journey without any timetable API',()=>{
 const journey=textJourney('Verbindung am Mo. 26.10.2026\n• von Hamburg-Altona, Abfahrt 11:54 Uhr Gl. 11 mit ICE 1123\n• nach Aachen Hbf, Ankunft 17:07 Uhr Gl. 2 mit 26822\nVerbindung ansehen: https://www.bahn.de/buchung/start?vbid=d93ff310');
 assert.deepEqual(journey.legs,[{origin:'Hamburg-Altona',destination:'Aachen Hbf · Gleis 2',service:'ICE 1123 → 26822',departure:'11:54',arrival:'17:07',platform:'Gleis 11',number:'',station:'',arrivalStation:''}]);
 assert.deepEqual([journey.date,journey.startTime,journey.endTime,journey.source],['2026-10-26','11:54','17:07','text']);
 assert.equal(textJourney('Hamburg-Altona → Aachen Hbf 26.10.2026 11:54'),null);
});

test('detailed pasted sections preserve trains and reject broken connections',()=>{
 const text='26.10.2026\nvon Hamburg Hbf, Abfahrt 08:00 mit ICE 123\nnach Köln Hbf, Ankunft 12:00 mit ICE 123\nvon Köln Hbf, Abfahrt 12:15 mit RE 1\nnach Aachen Hbf, Ankunft 13:10 mit RE 1';
 const result=textJourney(text);
 assert.equal(result.legs.length,2);
 assert.equal(result.legs[0].service,'ICE 123');
 assert.equal(result.legs[1].service,'RE 1');
 assert.equal(result.endTime,'13:10');
 assert.equal(result.incomplete,false);
 assert.throws(()=>textJourney(text.replace('Abfahrt 12:15','Abfahrt 11:15')),/schließen/);
 assert.throws(()=>textJourney(text.replace('von Köln','von Bonn')),/schließen/);
 assert.throws(()=>textJourney(text.replace('26.10.2026','31.02.2026')),/ungültig/);
});

test('Transitous accepts Hbf aliases but rejects different matching station IDs',async()=>{
 const {fetcher}=mockTransitous();
 const aliased=async(url,options)=>url.includes('/geocode?')?Response.json([{type:'STOP',id:'station',name:new URL(url).searchParams.get('text').replace('Hbf','Hauptbahnhof')}]):fetcher(url,options);
 assert.equal((await importJourney('',aliased,search)).choices.length,1);
 await assert.rejects(importJourney('',async()=>Response.json([{type:'STOP',id:'1',name:search.origin},{type:'STOP',id:'2',name:search.origin}]),search),/mehrere unterschiedliche/);
 assert.equal(transitousClient({...config,PAC_VERSION:'v1.0.12'}),'PAC/1.0.12 (https://contact.example.org)');
});


test('resolves Aachen West across colocated provider IDs and the Bf alias',async()=>{
 const {fetcher}=mockTransitous();
 const candidates=[
  {type:'STOP',id:'delfi',name:'Aachen, West Bf',lat:50.78036,lon:6.070715,country:'DE'},
  {type:'STOP',id:'openov',name:'Aachen West',lat:50.780327,lon:6.07072,country:'DE'},
  {type:'STOP',id:'sncb',name:'Aachen West',lat:50.78078,lon:6.07055,country:'DE'},
  {type:'STOP',id:'hbf',name:'Aachen Hbf',lat:50.76776,lon:6.09139,country:'DE'},
 ];
 const calls=[];
 const query=async(url,options)=>{
  calls.push(new URL(url));
  return url.includes('/geocode?') && new URL(url).searchParams.get('text')==='Aachen West'
   ? Response.json(candidates):fetcher(url,options);
 };
 await importJourney('',query,{...search,origin:'Aachen West'});
 assert.equal(calls.at(-1).searchParams.get('fromPlace'),'delfi');
 for(const second of [
  {...candidates[1],lat:51},
  {...candidates[1],lat:undefined},
  {...candidates[1],country:'BE'},
 ]) {
  await assert.rejects(importJourney('',async()=>Response.json([candidates[0],second]),{...search,origin:'Aachen West'}),/mehrere unterschiedliche/);
 }
});


test('resolves city-qualified Sülldorf names using area metadata and space-separated queries',async()=>{
 const {fetcher}=mockTransitous();
 for(const name of ['Hamburg-Sülldorf','Hamburg Sülldorf','Sülldorf, Hamburg']) {
  const calls=[];
  const query=async(url,options)=>{
   const parsed=new URL(url); calls.push(parsed);
   return parsed.pathname.endsWith('/geocode') && parsed.searchParams.get('text').includes('Sülldorf')
    ? Response.json([{type:'STOP',id:'suelldorf',name:'Sülldorf',areas:[{name:'Hamburg'}]}])
    : fetcher(url,options);
  };
  await importJourney('',query,{...search,destination:name});
  assert.equal(calls.at(-1).searchParams.get('toPlace'),'suelldorf');
  assert.ok(!calls.find(c=>c.searchParams.get('text')?.includes('Sülldorf')).searchParams.get('text').includes('-'));
 }
 for(const areas of [[],[{name:'Berlin'}]]) {
  await assert.rejects(importJourney('',async()=>Response.json([{type:'STOP',id:'wrong',name:'Sülldorf',areas}]),{...search,origin:'Hamburg Sülldorf'}),/nicht zuordnen/);
 }
});
