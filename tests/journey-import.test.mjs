import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linkSearch, searchInstant, parseItinerary, importJourney, SearchDetailsRequired} from '../src/journey-import.js';
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
test('rejects overnight, overlapping, cancelled and non-rail journeys',()=>{
 const overnight=fixture();overnight.legs[2].scheduledEndTime='2026-10-18T01:00:00Z';assert.throws(()=>parseItinerary(overnight),/Mitternacht/);
 const overlap=fixture();overlap.legs[2].scheduledStartTime='2026-10-17T10:00:00Z';assert.throws(()=>parseItinerary(overlap),/Fahrzeiten/);
 const cancelled=fixture();cancelled.legs[0].cancelled=true;assert.throws(()=>parseItinerary(cancelled));
 assert.throws(()=>parseItinerary({legs:[{mode:'BUS'}]}));
});
test('uses only Transitous, identifies the client and returns choices for explicit selection',async()=>{
 const {calls,fetcher}=mockTransitous();
 const data=await importJourney(short,fetcher,search);
 assert.equal(data.choices.length,1);assert.equal(calls.length,3);
 assert.ok(calls.every(c=>c.url.origin==='https://api.transitous.org' && c.options.redirect==='manual' && c.options.headers['User-Agent'].includes('https://github.com/FinCreeper1/PAC')));
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
 await assert.rejects(importJourney('',async()=>Response.json([{type:'STOP',id:'wrong',name:'Other station'}]),search),/genauer/);
});
test('redirects, limits and missing timetable data produce actionable errors',async()=>{
 await assert.rejects(importJourney('',async()=>new Response(null,{status:302,headers:{location:'https://evil.example'}}),search),/nicht erreichbar/);
 await assert.rejects(importJourney('',async()=>new Response('',{status:429}),search),/ausgelastet/);
 const {fetcher}=mockTransitous();
 await assert.rejects(importJourney('',async(url,options)=>url.includes('/plan?')?Response.json({itineraries:[]}):fetcher(url,options),search),/keine Zugverbindung/);
});
