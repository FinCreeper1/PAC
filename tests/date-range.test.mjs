import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../public/shared/calendar-model.js';
import {validateCalendar} from '../src/validation.js';
const trip={startDate:'2026-10-20',endDate:'2026-10-21',timeZone:'Europe/Berlin'};
const seed={schemaVersion:2,days:[{isoDate:'2026-10-20'},{isoDate:'2026-10-21'}],timeSlots:['08:00','09:00','10:00'],events:[{id:'existing',title:'Bestehender Termin',location:'Hamburg',day:2,startTime:'09:00',endTime:'10:00',type:'program',status:'confirmed',display:'normal',timing:'scheduled',latitude:53,longitude:10}]};
test('prepending days keeps existing events on their absolute dates without changing input',()=>{
 const original=structuredClone(seed),extended=CalendarModel.extend(seed,'2026-10-16');
 assert.deepEqual(seed,original);
 assert.equal(extended.days[0].isoDate,'2026-10-16');
 assert.equal(extended.days[extended.events[0].day-1].isoDate,'2026-10-21');
 validateCalendar(extended,seed,trip,{});
});
test('appending days and crossing month boundaries preserves existing dates',()=>{
 const extended=CalendarModel.extend(seed,'2026-11-02');
 assert.equal(extended.days.at(-1).isoDate,'2026-11-02');
 assert.equal(extended.events[0].day,2);
 validateCalendar(extended,seed,trip,{});
});
test('range validation rejects removing existing days and impossible dates',()=>{
 const shrunk=structuredClone(seed);shrunk.days.pop();assert.throws(()=>validateCalendar(shrunk,seed,trip,{}));
 const hole=CalendarModel.extend(seed,'2026-10-16');hole.days.splice(1,1);assert.throws(()=>validateCalendar(hole,seed,trip,{}));
 assert.throws(()=>CalendarModel.extend(seed,'2026-02-30'));

});

test('distant imported days are allowed without generating years of empty calendar days',()=>{
 const extended=CalendarModel.extend(seed,'2030-05-06');
 assert.equal(extended.days.length,3);
 assert.equal(extended.days.at(-1).isoDate,'2030-05-06');
 assert.equal(extended.days[extended.events[0].day-1].isoDate,'2026-10-21');
 validateCalendar(extended,seed,trip,{});
 const earlier=CalendarModel.extend(extended,'2020-01-01');
 assert.equal(earlier.days.length,4);
 assert.equal(earlier.days[earlier.events[0].day-1].isoDate,'2026-10-21');
 validateCalendar(earlier,extended,trip,{});
 assert.equal(CalendarModel.extend(earlier,'2020-01-01').days.length,4);
});
test('persisted sparse calendars accept additional days between existing dates',()=>{
 const sparse=CalendarModel.extend(seed,'2030-05-06');
 const next=CalendarModel.extend(sparse,'2028-03-01');
 assert.equal(next.days.length,4);
 validateCalendar(next,sparse,trip,{});
 const invalid=structuredClone(next);invalid.days.reverse();
 assert.throws(()=>validateCalendar(invalid,sparse,trip,{}));
});
