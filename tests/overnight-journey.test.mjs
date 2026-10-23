import test from 'node:test';
import assert from 'node:assert/strict';
import {parseItinerary,textJourney} from '../src/journey-import.js';
import {validateCalendar} from '../src/validation.js';
const trip={startDate:'2026-10-31'};
const seed={schemaVersion:2,days:[{isoDate:'2026-10-31'}],timeSlots:['08:00','09:00','10:00'],events:[]};
const night=()=>parseItinerary({legs:[{mode:'NIGHT_RAIL',displayName:'NJ 404',from:{name:'Hamburg'},to:{name:'Wien'},startTime:'2026-10-31T22:30:00+01:00',endTime:'2026-11-01T07:15:00+01:00'}]});
function calendarFor(data) {
 const parts=CalendarModel.journeyDays(data);
 let calendar=structuredClone(seed);
 for(const part of parts) calendar=CalendarModel.extend(calendar,part.date);
 calendar.events=parts.map((part,i)=>({id:`night-${i}`,title:data.title,day:calendar.days.findIndex(d=>d.isoDate===part.date)+1,startTime:part.startTime,endTime:part.endTime,journeyDate:part.journeyDate,journeyEndDate:part.journeyEndDate,type:'travel',timing:'scheduled',status:'confirmed',display:'normal',journeyId:`night-${i}`,journey:{heading:data.title,dialog:`night-${i}-dialog`,statusId:`night-${i}-status`,buttonId:`night-${i}-button`,url:'https://www.bahn.de/',legs:data.legs.map((l,n)=>({...l,timeId:`t-${i}-${n}`,platformId:`p-${i}-${n}`,delayId:`d-${i}-${n}`}))}}));
 return calendar;
}
test('night train crosses month boundary, survives publish validation and reopening without losing real train times',()=>{
 const data=night(),calendar=calendarFor(data);
 assert.equal(data.date,'2026-10-31');assert.equal(data.endDate,'2026-11-01');
 assert.deepEqual(calendar.events.map(e=>[e.startTime,e.endTime]),[['22:30','23:59'],['00:00','07:15']]);
 validateCalendar(calendar,seed,trip,{});
 for(const event of calendar.events) {
  const details=CalendarModel.journey(event,event.journey);
  assert.equal(details.legs[0].departure,'22:30');assert.equal(details.legs[0].arrival,'07:15');
  const [layout]=CalendarModel.layout([event],calendar);
  assert.ok(layout.top>=0 && layout.height>0 && layout.top+layout.height<=CalendarModel.bounds(calendar).duration);
 }
 const journeys=Object.fromEntries(calendar.events.map(e=>[e.id,e.journey]));
 for(const e of calendar.events) delete e.journey;
 validateCalendar(JSON.parse(JSON.stringify(calendar)),seed,trip,journeys);
});
test('dated journey validation rejects reversed, overlapping, missing or out-of-range dates',()=>{
 for(const mutate of [e=>e.journey.legs[0].arrivalDate='2026-10-30',e=>delete e.journey.legs[0].departureDate,e=>e.journeyEndDate='2026-10-31',e=>e.journey.legs.push({...e.journey.legs[0]})]) {
  const calendar=calendarFor(night());mutate(calendar.events[0]);
  assert.throws(()=>validateCalendar(calendar,seed,trip,{}));
 }
 assert.throws(()=>CalendarModel.journeyDays({...night(),endDate:'2027-01-01'}));
});
test('pasted overnight train and a transfer after midnight retain the next day',()=>{
 const text='31.10.2026\nvon Hamburg, Abfahrt 22:30 mit NJ 404\nnach Wien, Ankunft 07:15 mit NJ 404';
 const direct=textJourney(text);assert.equal(direct.endDate,'2026-11-01');
 const transfer=textJourney(text+'\nvon Wien, Abfahrt 08:00 mit RE 1\nnach Graz, Ankunft 10:30 mit RE 1');
 assert.equal(transfer.legs[1].departureDate,'2026-11-01');assert.equal(transfer.endDate,'2026-11-01');
 assert.equal(CalendarModel.journeyDays(transfer).length,2);
 const midnight=textJourney('31.10.2026\nvon Aalen, Abfahrt 22:30 mit RE 1\nnach Ulm, Ankunft 23:50 mit RE 1\nvon Ulm, Abfahrt 00:10 mit RE 2\nnach München, Ankunft 02:00 mit RE 2');
 assert.equal(midnight.legs[1].departureDate,'2026-11-01');
});

test('editor applies the overnight choice and creates valid continuation events on save',async()=>{
 const {readFile}=await import('node:fs/promises'),vm=await import('node:vm');
 const source=await readFile(new URL('../public/admin/journey-editor.js',import.meta.url),'utf8');
 const elements=Object.fromEntries(['title','location','startTime','endTime','day','latitude','longitude','type','timing','isJourney','time','journeyUrl'].map(key=>[key,{value:'',checked:false}]));
 const nodes=new Map();
 const context=vm.createContext({CalendarModel,structuredClone,crypto,form:{elements},calendar:structuredClone(seed),draft:{id:'new-night',day:1},journeyFormState:()=>'',bounds:()=>CalendarModel.bounds(seed),minutes:CalendarModel.minutes,
  $:selector=>{if(!nodes.has(selector))nodes.set(selector,{replaceChildren(){},textContent:''});return nodes.get(selector);},checkpoint(){},refreshDayOptions(){},render(){},syncJourneySection(){},syncTimeFields(){},renderJourneyLegs(){},mapLink(){},updateSaveState(){},window:{},editorError(message){throw Error(message);}});
 vm.runInContext(source.slice(source.indexOf('function applyImportedJourney('),source.indexOf('$("#import-journey").onclick')),context);
 context.data=night();
 vm.runInContext('applyImportedJourney(data,draft,"")',context);
 assert.equal(elements.startTime.value,'22:30');assert.equal(elements.endTime.value,'23:59');
 assert.equal(context.draft.journeyParts.length,2);assert.equal(context.calendar.days.length,2);
 vm.runInContext(source.slice(source.indexOf('window.applyJourneyDraft ='),source.indexOf('let importingJourney')),context);
 assert.equal(context.window.applyJourneyDraft(),true);
 assert.equal(context.draft.journey.legs[0].arrival,'07:15');
 const admin=await readFile(new URL('../public/admin/admin.js',import.meta.url),'utf8');
 context.stored={...structuredClone(context.draft),title:elements.title.value,startTime:elements.startTime.value,endTime:elements.endTime.value,day:1,type:'travel',timing:'scheduled',display:'normal',status:'confirmed'};
 context.journeyParts=context.stored.journeyParts;delete context.stored.journeyParts;
 context.calendar.events.push(context.stored);
 vm.runInContext(admin.slice(admin.indexOf('  if (journeyParts) {'),admin.indexOf('  controls();',admin.indexOf('  if (journeyParts) {'))),context);
 assert.equal(context.calendar.events.length,2);
 validateCalendar(context.calendar,seed,trip,{});
 assert.notEqual(context.calendar.events[0].journey.legs[0].timeId,context.calendar.events[1].journey.legs[0].timeId);
});
